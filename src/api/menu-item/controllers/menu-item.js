'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { extractRelationRef, ownerIdOfSection } = require('../../../utils/menu-ownership');

module.exports = createCoreController('api::menu-item.menu-item', ({ strapi }) => ({
  /**
   * Ver la nota en menu-section.create: `create` no es protegible por policy.
   * Aquí la propiedad se verifica subiendo section → business → owner.
   */
  async create(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const data = ctx.request.body?.data ?? {};
    const sectionRef = extractRelationRef(data.section);

    if (sectionRef == null) {
      return ctx.badRequest('Falta la sección a la que pertenece el platillo.');
    }

    const ownerId = await ownerIdOfSection(strapi, sectionRef);
    if (ownerId == null || ownerId !== user.id) {
      return ctx.forbidden('No puedes editar el menú de este negocio.');
    }

    // `business` lo deriva el lifecycle desde la sección; nunca del cliente.
    delete ctx.request.body.data.business;

    return super.create(ctx);
  },

  /**
   * La policy ya validó que el platillo actual es del usuario. Si el body lo
   * mueve a otra sección, hay que validar TAMBIÉN esa sección destino: si no,
   * se puede empujar un platillo al menú ajeno con un update.
   */
  async update(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const data = ctx.request.body?.data;
    if (data) {
      const sectionRef = extractRelationRef(data.section);
      if (sectionRef != null) {
        const ownerId = await ownerIdOfSection(strapi, sectionRef);
        if (ownerId == null || ownerId !== user.id) {
          return ctx.forbidden('No puedes mover el platillo a ese menú.');
        }
      }
      delete data.business;
    }

    return super.update(ctx);
  },
}));
