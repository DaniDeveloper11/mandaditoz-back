'use strict';

const { extractRelationRef, refToWhere } = require('../../../../utils/menu-ownership');

/**
 * El `business` de un platillo NO se setea a mano: se deriva siempre de
 * `section.business`. Así el denormalizado no puede desincronizarse y la
 * validación "todos los platillos son de este negocio" (una sola query en el
 * flujo de pedidos) es confiable.
 *
 * Mismo espíritu que business/lifecycles.js, que inyecta `owner` desde el
 * request context e ignora lo que mande el cliente.
 */

/** Busca la sección por id numérico o documentId y devuelve su business.id. */
async function resolveBusinessIdFromSection(sectionRef) {
  if (sectionRef == null) return null;

  const section = await strapi.db.query('api::menu-section.menu-section').findOne({
    where: refToWhere(sectionRef),
    select: ['id'],
    populate: { business: { select: ['id'] } },
  });

  return section?.business?.id ?? null;
}

async function getCurrentSectionRef(where) {
  if (!where) return null;
  const current = await strapi.db.query('api::menu-item.menu-item').findOne({
    where,
    select: ['id'],
    populate: { section: { select: ['id'] } },
  });
  return current?.section?.id ?? null;
}

async function syncBusinessFromSection(event, { lookupCurrentSection = false } = {}) {
  const { data } = event.params;
  if (!data) return;

  let sectionRef = extractRelationRef(data.section);

  if (sectionRef === undefined) {
    if (!lookupCurrentSection) {
      delete data.business;
      return;
    }
    sectionRef = await getCurrentSectionRef(event.params.where);
  }

  data.business = await resolveBusinessIdFromSection(sectionRef);
}

module.exports = {
  async beforeCreate(event) {
    await syncBusinessFromSection(event);
  },

  async beforeUpdate(event) {
    await syncBusinessFromSection(event, { lookupCurrentSection: true });
  },
};
