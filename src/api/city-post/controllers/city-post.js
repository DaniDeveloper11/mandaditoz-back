'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::city-post.city-post', ({ strapi }) => ({
  async find(ctx) {
    // El filtro de publicado va SIN condicion, a diferencia de business.find
    // (que solo lo fuerza para anonimos porque un dueno necesita ver sus
    // propias fichas en borrador). Un city-post no tiene dueno y nadie lo
    // edita por la API: la captura es exclusivamente del panel admin, que no
    // pasa por este controller. Sin este forzado,
    // ?filters[postStatus][$eq]=draft expone los borradores del municipio.
    ctx.query = {
      ...ctx.query,
      filters: {
        ...(ctx.query?.filters ?? {}),
        postStatus: 'published',
      },
    };
    return super.find(ctx);
  },

  async findOne(ctx) {
    const response = await super.findOne(ctx);
    if (response?.data?.postStatus !== 'published') {
      return ctx.notFound();
    }
    return response;
  },
}));
