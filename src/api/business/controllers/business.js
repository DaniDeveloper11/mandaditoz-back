'use strict';
const { factories } = require('@strapi/strapi');

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
    console.log('[controller] update llamado, user:', ctx.state.user?.id, 'documentId:', ctx.params.id);
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

    const publishedCount = await strapi.db.query('api::business.business').count({
      where: {
        owner: user.id,
        businessStatus: 'published',
        archivedAt: null,
      },
    });

    return {
      data: results,
      meta: {
        publishedCount,
        publishedLimit: 3,
      },
    };
  },
}));
