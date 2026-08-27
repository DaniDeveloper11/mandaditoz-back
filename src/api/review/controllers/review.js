'use strict';
const { factories } = require('@strapi/strapi');

function extractRelationId(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    if (raw.id) return raw.id;
    if (raw.documentId) return raw.documentId;
    if (Array.isArray(raw.set) && raw.set[0]) return raw.set[0].id ?? raw.set[0].documentId ?? null;
    if (Array.isArray(raw.connect) && raw.connect[0]) return raw.connect[0].id ?? raw.connect[0].documentId ?? null;
  }
  return null;
}

function getClientIp(ctx) {
  const forwarded = ctx.request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return ctx.request.ip || 'unknown';
}

// Whitelist de campos escalares que salen por GET /reviews. El find de abajo
// no pasa por sanitizeOutput (ver nota ahi), asi que `private: true` en el
// schema no basta: guestEmail, sourceIp y userAgent solo quedan fuera porque
// no estan en esta lista. Agregar campos nuevos aqui solo si son publicos.
// Unicos campos del user que pueden salir junto a una resena. El id se expone
// a proposito: el frontend lo usa para saber si la resena es del usuario actual.
const AUTHOR_PUBLIC_FIELDS = ['id', 'username', 'displayName'];

const PUBLIC_REVIEW_FIELDS = [
  'id',
  'documentId',
  'rating',
  'title',
  'comment',
  'visitDate',
  'helpfulCount',
  'editedAt',
  'createdAt',
  'reviewStatus',
  'guestName',
];

async function resolveBusinessRow(raw) {
  const id = extractRelationId(raw);
  if (!id) return null;
  if (typeof id === 'number' || /^\d+$/.test(String(id))) {
    return strapi.db.query('api::business.business').findOne({
      where: { id: Number(id) },
      populate: ['owner'],
    });
  }
  return strapi.db.query('api::business.business').findOne({
    where: { documentId: id },
    populate: ['owner'],
  });
}

module.exports = factories.createCoreController('api::review.review', ({ strapi }) => ({
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const data = ctx.request.body?.data ?? {};
    // Nunca dejar que el cliente escriba estos campos — se inyectan en el
    // beforeCreate del lifecycle (author) o se fuerzan a un valor seguro.
    delete data.author;
    delete data.reviewStatus;
    delete data.helpfulCount;
    delete data.isReported;
    delete data.reportCount;
    delete data.response;
    delete data.editedAt;

    const business = await resolveBusinessRow(data.business);
    if (!business) return ctx.badRequest('Negocio no encontrado');
    if (business.businessStatus !== 'published') {
      return ctx.badRequest('No puedes reseñar un negocio no publicado');
    }
    if (business.owner?.id === user.id) {
      return ctx.forbidden('No puedes reseñar tu propio negocio');
    }

    const existing = await strapi.db.query('api::review.review').findOne({
      where: { author: user.id, business: business.id },
    });
    if (existing) {
      return ctx.conflict('Ya reseñaste este negocio', {
        existingDocumentId: existing.documentId,
      });
    }

    ctx.request.body.data = { ...data, business: business.id };
    return super.create(ctx);
  },

  async update(ctx) {
    const data = ctx.request.body?.data ?? {};
    delete data.author;
    delete data.business;
    delete data.reviewStatus;
    delete data.helpfulCount;
    delete data.isReported;
    delete data.reportCount;
    delete data.response;
    ctx.request.body.data = data;
    return super.update(ctx);
  },

  async delete(ctx) {
    return super.delete(ctx);
  },

  async find(ctx) {
    const query = ctx.query ?? {};
    const filters = { ...(query.filters ?? {}) };
    if (!ctx.state.user) {
      filters.reviewStatus = { $eq: 'published' };
    } else {
      filters.reviewStatus = { $ne: 'removed' };
    }

    // El populate NO se toma del query string. Antes se hacia
    // `query.populate ?? {...}` y bastaba con pedir `populate[author]=true`
    // para que la API devolviera el user completo — email, phone,
    // confirmationToken y el hash de password — porque este find no pasa por
    // sanitizeOutput. Se fuerza siempre esta forma segura.
    const populate = {
      author: { fields: AUTHOR_PUBLIC_FIELDS, populate: { avatar: true } },
      photos: true,
      response: { populate: { respondedBy: { fields: AUTHOR_PUBLIC_FIELDS } } },
      business: { fields: ['id', 'documentId'] },
    };

    const pagination = query.pagination ?? { page: 1, pageSize: 10 };
    const sort = query.sort ?? 'createdAt:desc';

    const [entries, total] = await Promise.all([
      strapi.documents('api::review.review').findMany({
        filters,
        fields: PUBLIC_REVIEW_FIELDS,
        populate,
        sort,
        pagination,
      }),
      strapi.db.query('api::review.review').count({ where: filters }),
    ]);

    // No pasamos por sanitizeOutput para preservar los campos públicos del
    // autor (id, username, displayName, avatar). El id del user es público
    // porque lo usamos en el frontend para determinar autoría de la reseña.
    return {
      data: entries,
      meta: {
        pagination: {
          page: Number(pagination.page ?? 1),
          pageSize: Number(pagination.pageSize ?? 10),
          pageCount: Math.ceil(total / Number(pagination.pageSize ?? 10)),
          total,
        },
      },
    };
  },

  // POST /api/reviews/submit — publico, sin cuenta.
  // Siempre entra como reviewStatus='pending': no cuenta para el rating del
  // negocio hasta que un admin la apruebe desde Strapi (recalcBusinessRating
  // solo promedia reviews con review_status='published').
  async submit(ctx) {
    const body = ctx.request.body?.data ?? {};

    // Honeypot: campo invisible en el form. Si viene lleno es un bot —
    // respondemos ok para no darle señal de que lo detectamos.
    if (String(body.website ?? '').trim() !== '') {
      strapi.log.warn(`[review.submit] honeypot activado desde ${getClientIp(ctx)}`);
      return (ctx.body = { ok: true, pending: true });
    }

    const rating = Number(body.rating);
    const guestName = String(body.guestName ?? '').trim();
    const guestEmail = String(body.guestEmail ?? '').trim().toLowerCase();
    const title = String(body.title ?? '').trim();
    const comment = String(body.comment ?? '').trim();
    const visitDate = String(body.visitDate ?? '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return ctx.badRequest('Calificación inválida');
    }
    if (guestName.length < 2 || guestName.length > 60) {
      return ctx.badRequest('Nombre inválido');
    }
    if (guestEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail)) {
      return ctx.badRequest('Email inválido');
    }
    if (comment.length < 10) return ctx.badRequest('La reseña es demasiado corta');
    if (comment.length > 1500) return ctx.badRequest('La reseña es demasiado larga');
    if (title.length > 100) return ctx.badRequest('El título es demasiado largo');
    if (visitDate && !/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
      return ctx.badRequest('Fecha de visita inválida');
    }

    const photos = Array.isArray(body.photos)
      ? body.photos.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 6)
      : [];

    const business = await resolveBusinessRow(body.business);
    if (!business) return ctx.badRequest('Negocio no encontrado');
    if (business.businessStatus !== 'published') {
      return ctx.badRequest('No puedes reseñar un negocio no publicado');
    }

    // Sin cuenta no hay identidad estable: lo mas cercano es la IP. Una reseña
    // por negocio por IP cada 24h, además del rate limit global de la ruta.
    const sourceIp = getClientIp(ctx);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await strapi.db.query('api::review.review').findOne({
      where: { sourceIp, business: business.id, createdAt: { $gt: since } },
    });
    if (recent) {
      return ctx.conflict('Ya enviaste una reseña para este negocio hace poco');
    }

    const created = await strapi.documents('api::review.review').create({
      data: {
        business: business.id,
        author: null,
        guestName,
        guestEmail: guestEmail || null,
        rating,
        title: title || null,
        comment,
        visitDate: visitDate || null,
        photos: photos.length ? photos : undefined,
        reviewStatus: 'pending',
        sourceIp,
        userAgent: String(ctx.request.headers['user-agent'] ?? '').slice(0, 300),
      },
    });

    // Mismo canal que las altas de negocios y los claims: el aviso de
    // moderacion va a ADMIN_NOTIFICATION_EMAIL, sin buzones de respaldo —
    // si no esta configurada se avisa en el log y no se manda a nadie mas.
    const to = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (!to) {
      strapi.log.warn(
        '[review.submit] ADMIN_NOTIFICATION_EMAIL no configurado; se omite el aviso de moderación'
      );
    } else {
      const adminBase = process.env.PUBLIC_ADMIN_URL || 'http://localhost:1337/admin';
      const adminUrl = `${adminBase}/content-manager/collection-types/api::review.review/${created.documentId}`;
      try {
        await strapi.plugin('email').service('email').send({
          to,
          ...(guestEmail ? { replyTo: guestEmail } : {}),
          subject: `[Mandaditoz] Reseña por aprobar — ${business.name}`,
          text:
            `Negocio: ${business.name}\n` +
            `Autor: ${guestName}${guestEmail ? ` <${guestEmail}>` : ' (sin email)'}\n` +
            `Calificación: ${rating}/5\n` +
            `IP: ${sourceIp}\n\n` +
            `${title ? `Título: ${title}\n\n` : ''}` +
            `${comment}\n\n` +
            `Aprobar o descartar aquí:\n${adminUrl}\n\n` +
            `(cambia reviewStatus a "published" para publicarla)\n`,
        });
      } catch (err) {
        strapi.log.warn(`[review.submit] no se pudo enviar el aviso de moderación: ${err.message}`);
      }
    }

    ctx.body = { ok: true, pending: true, documentId: created.documentId };
  },

  async respond(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const { id: documentId } = ctx.params;
    const message = String(ctx.request.body?.data?.message ?? '').trim();
    if (message.length < 2) return ctx.badRequest('Mensaje requerido');
    if (message.length > 500) return ctx.badRequest('Mensaje demasiado largo (máx 500)');

    const review = await strapi.documents('api::review.review').findOne({
      documentId,
      populate: { business: { populate: ['owner'] } },
    });
    if (!review) return ctx.notFound();
    if (review.business?.owner?.id !== user.id) {
      return ctx.forbidden('Solo el dueño del negocio puede responder');
    }

    const updated = await strapi.documents('api::review.review').update({
      documentId,
      data: {
        response: {
          text: message,
          respondedAt: new Date(),
          respondedBy: user.id,
        },
      },
      populate: { author: true, photos: true, response: { populate: ['respondedBy'] } },
    });
    return { data: updated };
  },
}));
