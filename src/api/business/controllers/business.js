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
}));
