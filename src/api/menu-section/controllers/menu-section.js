'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { extractRelationRef, ownerIdOfBusiness } = require('../../../utils/menu-ownership');

module.exports = createCoreController('api::menu-section.menu-section', ({ strapi }) => ({
  /**
   * Una policy no puede proteger `create`: no hay entidad todavía y el negocio
   * destino llega en el body. Sin esta verificación, cualquier dueño registrado
   * podría agregarle secciones al menú de otro negocio.
   */
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const data = ctx.request.body?.data ?? {};
    const businessRef = extractRelationRef(data.business);

    if (businessRef == null) {
      return ctx.badRequest('Falta el negocio al que pertenece la sección.');
    }

    const ownerId = await ownerIdOfBusiness(strapi, businessRef);
    if (ownerId == null || ownerId !== user.id) {
      return ctx.forbidden('No puedes editar el menú de este negocio.');
    }

    return super.create(ctx);
  },

  /**
   * La policy ya validó que la sección actual es del usuario. Falta impedir que
   * el body la mueva al negocio de alguien más: mover de negocio no es un caso
   * de uso real, así que simplemente se ignora el campo.
   */
  async update(ctx) {
    if (ctx.request.body?.data) {
      delete ctx.request.body.data.business;
    }
    return super.update(ctx);
  },
}));
