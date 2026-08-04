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

    const populate = query.populate ?? {
      author: { fields: ['id', 'username', 'displayName'], populate: { avatar: true } },
      photos: true,
      response: { populate: { respondedBy: { fields: ['id', 'displayName'] } } },
      business: { fields: ['id', 'documentId'] },
    };

    const pagination = query.pagination ?? { page: 1, pageSize: 10 };
    const sort = query.sort ?? 'createdAt:desc';

    const [entries, total] = await Promise.all([
      strapi.documents('api::review.review').findMany({
        filters,
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
