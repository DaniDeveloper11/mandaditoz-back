'use strict';
const { factories } = require('@strapi/strapi');
const { getPublishedLimit } = require('../../../utils/publish-limit');

module.exports = factories.createCoreController('api::business.business', ({ strapi }) => ({
  async create(ctx) {
    // Prevención de suplantación: cualquier "owner" enviado por el cliente
    // se descarta. El owner real se inyecta en el lifecycle beforeCreate
    // usando ctx.state.user desde el requestContext.
    if (ctx.request.body?.data && 'owner' in ctx.request.body.data) {
      delete ctx.request.body.data.owner;
    }
    return super.create(ctx);
  },

  async find(ctx) {
    // Usuarios no autenticados solo ven negocios publicados
    if (!ctx.state.user) {
      ctx.query.filters = {
        ...ctx.query.filters,
        businessStatus: 'published',
      };
    }
    return super.find(ctx);
  },

  async update(ctx) {
    // Destacar es curaduría editorial, no una opción del dueño: estos tres
    // campos solo se tocan desde el panel admin. Mismo criterio que con
    // "owner" en create.
    const data = ctx.request.body?.data;
    if (data) {
      delete data.isFeatured;
      delete data.featuredUntil;
      delete data.featuredOrder;
      // Los campos de outreach son maquinaria interna del embudo de reclamo:
      // el token es la credencial que permite adueñarse de la ficha, así que
      // nadie lo escribe desde fuera. Se generan en scripts/generate-claim-links.js.
      delete data.outreachToken;
      delete data.outreachTokenExpiresAt;
      delete data.outreachPhone;
      delete data.lastOutreachAt;
      delete data.outreachCount;
      delete data.outreachOptOut;
    }
    return super.update(ctx);
  },

  async findOne(ctx) {
    const response = await super.findOne(ctx);
    // Usuarios no autenticados no pueden ver negocios no publicados
    if (!ctx.state.user && response?.data?.businessStatus !== 'published') {
      return ctx.notFound();
    }
    return response;
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

    const { query } = ctx;
    const results = await strapi.documents('api::business.business').findMany({
      filters: {
        owner: { id: user.id },
        archivedAt: { $null: true },
      },
      populate: query.populate ?? {
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
      data: results,
      meta: {
        publishedCount,
        publishedLimit,
      },
    };
  },
}));
