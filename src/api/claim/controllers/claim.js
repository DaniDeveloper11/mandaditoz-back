'use strict';
const { factories } = require('@strapi/strapi');

module.exports = factories.createCoreController('api::claim.claim', ({ strapi }) => ({
  async create(ctx) {
    await this.validateQuery(ctx);
    const sanitizedData = await this.sanitizeInput(ctx.request.body.data, ctx);

    const entity = await strapi.documents('api::claim.claim').create({
      data: {
        ...sanitizedData,
        user: ctx.state.user.id,
      },
      populate: ctx.query?.populate,
    });

    const sanitizedResult = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedResult);
  },
}));
