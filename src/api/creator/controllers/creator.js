'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

/**
 * Directorio de voces del municipio. Solo lectura por la API.
 *
 * Mismo criterio que city-post y por el mismo motivo: una voz no tiene dueno y
 * nadie la edita desde el sitio — la captura es exclusivamente del panel admin,
 * que no pasa por este controller. El filtro de publicado va SIN condicion (a
 * diferencia de business.find, que solo lo fuerza para anonimos porque un dueno
 * necesita ver sus propias fichas en borrador). Sin este forzado,
 * ?filters[creatorStatus][$eq]=draft expone las fichas a medio capturar, que
 * ademas son datos de personas reales todavia sin su consentimiento registrado.
 */
module.exports = createCoreController('api::creator.creator', ({ strapi }) => ({
  async find(ctx) {
    ctx.query = {
      ...ctx.query,
      filters: {
        ...(ctx.query?.filters ?? {}),
        creatorStatus: 'published',
      },
    };
    return super.find(ctx);
  },

  async findOne(ctx) {
    const response = await super.findOne(ctx);
    if (response?.data?.creatorStatus !== 'published') {
      return ctx.notFound();
    }
    return response;
  },
}));
