'use strict';

/**
 * Al borrar una sección hay que borrar sus platillos primero. Si no, quedan
 * huérfanos: con `section` en null el lifecycle de menu-item les pone
 * `business` en null y desaparecen del menú sin que nadie los pueda ver ni
 * borrar desde el panel del dueño.
 */
module.exports = {
  async beforeDelete(event) {
    const { where } = event.params;
    if (!where) return;

    const section = await strapi.db.query('api::menu-section.menu-section').findOne({
      where,
      select: ['id'],
    });
    if (!section) return;

    const deleted = await strapi.db.query('api::menu-item.menu-item').deleteMany({
      where: { section: section.id },
    });

    if (deleted?.count) {
      strapi.log.info(`[menu-section] borrados ${deleted.count} platillos de la sección ${section.id}`);
    }
  },
};
