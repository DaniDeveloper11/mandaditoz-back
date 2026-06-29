'use strict';
const { factories } = require('@strapi/strapi');

module.exports = factories.createCoreController('api::business.business', ({ strapi }) => ({
  async create(ctx) {
    ctx.request.body.data = {
      ...ctx.request.body.data,
      owner: ctx.state.user.id,
    };
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
}));
