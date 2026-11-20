'use strict';
const { factories } = require('@strapi/strapi');
const { getPublishedLimit } = require('../../../utils/publish-limit');
const { findBusinessIdsByText, orderBusinessIdsByName } = require('../../../utils/business-search');

// Campos que solo se tocan desde el panel admin (o los escribe el sistema), ni
// al crear ni al editar por la API:
// - destacar y verificar es curaduría editorial;
// - outreach* es la maquinaria del embudo de reclamo: el token es la credencial
//   que permite adueñarse de la ficha (se generan en scripts/generate-claim-links.js);
// - ownershipStatus lo mueven los lifecycles de business y claim;
// - los contadores los recalculan las reseñas y la analítica.
const ADMIN_ONLY_FIELDS = [
  'owner',
  'isFeatured', 'featuredUntil', 'featuredOrder',
  'isVerified', 'verifiedAt',
  'createdByAdmin', 'ownershipStatus',
  'viewCount', 'ratingAverage', 'ratingCount', 'reviewCount',
  'submitterName', 'submitterEmail', 'submitterPhone', 'termsAcceptedAt',
  'outreachToken', 'outreachTokenExpiresAt', 'outreachPhone',
  'lastOutreachAt', 'outreachCount', 'outreachOptOut',
];

// El dueño solo alterna entre borrador y publicado. `pending_review` y
// `suspended` son estados de moderación: entrar o salir de ellos es del admin.
const OWNER_STATUSES = ['draft', 'published'];

function stripAdminOnly(data) {
  if (!data) return;
  for (const field of ADMIN_ONLY_FIELDS) delete data[field];
}

// Ids de los negocios no publicados del usuario: los únicos fuera de
// `published` que puede leer por la API. Se resuelve a ids y no a un filtro
// por `owner` porque sanitizeQuery borra los filtros sobre users (el rol no
// puede leer esa colección) y el filtro desaparecería en silencio.
async function ownUnpublishedIds(userId) {
  const rows = await strapi.db.query('api::business.business').findMany({
    where: { owner: userId, businessStatus: { $ne: 'published' } },
    select: ['id'],
  });
  return rows.map((r) => r.id);
}

async function isOwnedBy(businessId, userId) {
  if (!businessId || !userId) return false;
  const count = await strapi.db.query('api::business.business').count({
    where: { id: businessId, owner: userId },
  });
  return count > 0;
}

module.exports = factories.createCoreController('api::business.business', ({ strapi }) => ({
  async create(ctx) {
    // Prevención de suplantación: cualquier "owner" enviado por el cliente
    // se descarta. El owner real se inyecta en el lifecycle beforeCreate
    // usando ctx.state.user desde el requestContext.
    const data = ctx.request.body?.data;
    stripAdminOnly(data);
    if (data?.businessStatus && !OWNER_STATUSES.includes(data.businessStatus)) {
      return ctx.badRequest('Estado inválido');
    }
    return super.create(ctx);
  },

  async find(ctx) {
    // Sin sesión: solo publicados. Con sesión: publicados + los borradores
    // propios (antes cualquier autenticado veía los de todos). Va dentro de un
    // $and para que ningún filtro del cliente pueda ampliarlo. Los archivados
    // no salen para nadie: el dueño los ve por /businesses/mine.
    const userId = ctx.state.user?.id;
    const ownIds = userId ? await ownUnpublishedIds(userId) : [];
    const visibility = ownIds.length
      ? { $or: [{ businessStatus: 'published' }, { id: { $in: ownIds } }] }
      : { businessStatus: 'published' };
    ctx.query.filters = {
      $and: [ctx.query.filters ?? {}, visibility, { archivedAt: { $null: true } }],
    };

    // Búsqueda de texto sin acentos (ver utils/business-search.js). `q` no es
    // un parámetro de Strapi: se resuelve aquí a un filtro por id y se quita
    // antes de que el core valide la query.
    //
    // `sort=relevance` tampoco existe en Strapi: con `q` ordena por la
    // puntuación de la búsqueda; sin `q` se ignora y queda el orden default.
    const byRelevance = ctx.query.sort === 'relevance';
    if (byRelevance) delete ctx.query.sort;

    // `sort=name` se ordena sin acentos (ver orderBusinessIdsByName) y se
    // pagina por la misma vía que la relevancia.
    const byName = typeof ctx.query.sort === 'string' && /^name(:(asc|desc))?$/i.test(ctx.query.sort);
    const nameDir = byName && /:desc$/i.test(ctx.query.sort) ? 'desc' : 'asc';
    if (byName) delete ctx.query.sort;

    let textIds = null;
    if (ctx.query.q !== undefined) {
      textIds = await findBusinessIdsByText(ctx.query.q);
      delete ctx.query.q;
      if (textIds) {
        ctx.query.filters = {
          ...ctx.query.filters,
          // Un $in vacío no es fiable en todas las versiones; -1 no existe.
          id: { $in: textIds.length ? textIds : [-1] },
        };
        if (byRelevance && textIds.length) return this.findByRelevance(ctx, textIds);
      }
    }
    if (byName) {
      if (textIds && !textIds.length) return super.find(ctx);
      return this.findByRelevance(ctx, await orderBusinessIdsByName(nameDir, textIds));
    }
    return super.find(ctx);
  },

  // El orden de `ids` (relevancia) no se puede expresar como `sort` de Strapi,
  // así que la paginación se hace aquí: primero se averigua cuáles de esos ids
  // pasan el resto de filtros (ciudad, categoría, destacados…), se corta la
  // página en orden de relevancia, y solo esa página pasa por el find core
  // para que populate y sanitizado sean los de siempre.
  async findByRelevance(ctx, ids) {
    const { filters } = await this.sanitizeQuery(ctx);
    const matching = await strapi.documents('api::business.business').findMany({
      filters,
      fields: ['id'],
      limit: ids.length,
    });
    const allowed = new Set(matching.map((b) => b.id));
    const ordered = ids.filter((id) => allowed.has(id));

    const { page: rawPage, pageSize: rawPageSize } = ctx.query.pagination ?? {};
    const maxLimit = strapi.config.get('api.rest.maxLimit', 100);
    const pageSize = Math.min(Math.max(parseInt(rawPageSize, 10) || 25, 1), maxLimit);
    const page = Math.max(parseInt(rawPage, 10) || 1, 1);
    const pageIds = ordered.slice((page - 1) * pageSize, page * pageSize);

    ctx.query.filters = { ...ctx.query.filters, id: { $in: pageIds.length ? pageIds : [-1] } };
    ctx.query.pagination = { page: 1, pageSize: Math.max(pageIds.length, 1) };
    const response = await super.find(ctx);

    const pos = new Map(pageIds.map((id, i) => [id, i]));
    response.data.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    response.meta.pagination = {
      page,
      pageSize,
      pageCount: Math.ceil(ordered.length / pageSize),
      total: ordered.length,
    };
    return response;
  },

  async update(ctx) {
    // Mismo criterio que con "owner" en create (ver ADMIN_ONLY_FIELDS).
    const data = ctx.request.body?.data;
    stripAdminOnly(data);
    if (data?.businessStatus !== undefined) {
      if (!OWNER_STATUSES.includes(data.businessStatus)) {
        return ctx.badRequest('Estado inválido');
      }
      // Un negocio suspendido o en revisión no se republica solo: eso
      // deshacía la suspensión del admin con un PUT.
      const current = await strapi.db.query('api::business.business').findOne({
        where: { documentId: ctx.params.id },
        select: ['businessStatus'],
      });
      if (current && !OWNER_STATUSES.includes(current.businessStatus)) {
        delete data.businessStatus;
      }
    }
    return super.update(ctx);
  },

  async findOne(ctx) {
    const response = await super.findOne(ctx);
    const entity = response?.data;
    if (!entity) return response;
    // Publicado y no archivado: público. Lo demás solo lo ve su dueño.
    if (entity.businessStatus === 'published' && !entity.archivedAt) return response;
    if (await isOwnedBy(entity.id, ctx.state.user?.id)) return response;
    return ctx.notFound();
  },

  async submit(ctx) {
    // Endpoint público para que cualquier persona (sin cuenta) envíe una
    // solicitud de publicación. El admin revisa manualmente en el panel.
    // TODO: agregar throttling por IP cuando aparezca abuso real (koa-ratelimit).
    const body = ctx.request.body?.data ?? {};

    const name = String(body.name ?? '').trim();
    const categoryId = body.category ?? body.categoryId ?? null;
    const cityId = body.city ?? body.cityDocumentId ?? null;
    const phones = Array.isArray(body.phones) ? body.phones : [];
    const isMobile = !!body.isMobile;
    const visibleInAllCities = !!body.visibleInAllCities;
    const address = isMobile ? null : (body.address ?? null);
    const submitterName = String(body.submitterName ?? '').trim();
    const submitterEmail = String(body.submitterEmail ?? '').trim();
    const submitterPhone = String(body.submitterPhone ?? '').trim();

    if (name.length < 2) return ctx.badRequest('Nombre inválido');
    if (!categoryId) return ctx.badRequest('Categoría requerida');
    if (!cityId) return ctx.badRequest('Municipio requerido');
    if (!phones.length || !phones[0]?.number) return ctx.badRequest('Teléfono requerido');
    if (!submitterName) return ctx.badRequest('Nombre del contacto requerido');
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(submitterEmail)) return ctx.badRequest('Email del contacto inválido');
    if (body.email && !/^[^@]+@[^@]+\.[^@]+$/.test(body.email)) return ctx.badRequest('Email del negocio inválido');
    if (body.termsAccepted !== true) return ctx.badRequest('Debes aceptar los Términos y la Política de privacidad');

    const socialLinks = Array.isArray(body.socialLinks)
      ? body.socialLinks
          .filter(s => s?.platform && s?.url && /^https?:\/\/.+$/.test(s.url))
          .map(s => ({ platform: s.platform, url: s.url }))
      : [];

    const slugify = (str) =>
      String(str ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);

    const data = {
      name,
      slug: `${slugify(name)}-${Date.now().toString(36)}`,
      shortDescription: body.shortDescription || null,
      description: body.description || null,
      email: body.email || null,
      socialLinks: socialLinks.length ? socialLinks : undefined,
      category: categoryId,
      city: cityId,
      phones,
      address,
      isMobile,
      visibleInAllCities,
      paymentMethods: Array.isArray(body.paymentMethods) && body.paymentMethods.length ? body.paymentMethods : null,
      logo: body.logo ?? null,
      menuPdf: body.menuPdf ?? null,
      menuImages: Array.isArray(body.menuImages) && body.menuImages.length ? body.menuImages : null,
      submitterName,
      submitterEmail,
      submitterPhone: submitterPhone || null,
      termsAcceptedAt: new Date(),
      businessStatus: 'pending_review',
      ownershipStatus: 'unclaimed',
      createdByAdmin: false,
    };

    const created = await strapi.documents('api::business.business').create({ data });

    const hours = Array.isArray(body.hours) ? body.hours : [];
    for (const h of hours) {
      if (!h?.dayOfWeek) continue;
      await strapi.documents('api::business-hour.business-hour').create({
        data: {
          business: created.documentId,
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime ?? null,
          closeTime: h.closeTime ?? null,
          isClosed: !!h.isClosed,
          is24Hours: !!h.is24Hours,
        },
      });
    }

    ctx.body = { ok: true, documentId: created.documentId };
  },

  async mine(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    // El populate NO se toma del query string: con `populate[owner]=true` (o
    // anidando por city.businesses.owner, claims.user…) esta ruta devolvía el
    // user completo con el hash de password y los tokens de reset, y el
    // outreachToken de cualquier negocio. Mismo criterio que review.find.
    await this.validateQuery(ctx);
    const query = await this.sanitizeQuery(ctx);
    const results = await strapi.documents('api::business.business').findMany({
      filters: {
        owner: { id: user.id },
        archivedAt: { $null: true },
      },
      populate: {
        category: true,
        city: true,
        logo: true,
        coverPhoto: true,
        phones: true,
        address: true,
      },
      sort: query.sort ?? 'updatedAt:desc',
      pagination: query.pagination ?? { pageSize: 100 },
    });
    // Quita los campos private (outreach*, submitter*) del propio negocio.
    const sanitizedResults = await this.sanitizeOutput(results, ctx);

    const [publishedCount, publishedLimit] = await Promise.all([
      strapi.db.query('api::business.business').count({
        where: {
          owner: user.id,
          businessStatus: 'published',
          archivedAt: null,
        },
      }),
      // Cupo del dueño: default 3, ampliable por usuario desde el admin.
      getPublishedLimit(user.id),
    ]);

    return {
      data: sanitizedResults,
      meta: {
        publishedCount,
        publishedLimit,
      },
    };
  },
}));
