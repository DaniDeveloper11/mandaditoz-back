'use strict';

/**
 * El `business` de un platillo NO se setea a mano: se deriva siempre de
 * `section.business`. Así el denormalizado no puede desincronizarse y la
 * validación "todos los platillos son de este negocio" (una sola query en el
 * flujo de pedidos) es confiable.
 *
 * Mismo espíritu que business/lifecycles.js, que inyecta `owner` desde el
 * request context e ignora lo que mande el cliente.
 */

/**
 * Normaliza las formas en que puede llegar una relación en `data`:
 * id numérico, documentId string, `{ connect: [...] }` (admin panel),
 * `{ set: [...] }`, o un objeto entidad.
 * Devuelve `undefined` si no viene, `null` si se está desconectando.
 */
function extractRelationRef(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  if (Array.isArray(value)) return extractRelationRef(value[0] ?? null);

  if (typeof value === 'object') {
    if ('connect' in value || 'set' in value || 'disconnect' in value) {
      const next = value.set ?? value.connect;
      if (Array.isArray(next)) {
        if (next.length === 0) return null;
        return extractRelationRef(next[0]);
      }
      if (next != null) return extractRelationRef(next);
      return null;
    }
    if (value.id != null) return value.id;
    if (value.documentId != null) return value.documentId;
    return null;
  }

  return value;
}

/** Busca la sección por id numérico o por documentId, y devuelve su business.id. */
async function resolveBusinessIdFromSection(sectionRef) {
  if (sectionRef == null) return null;

  const asNumber = Number(sectionRef);
  const where = Number.isInteger(asNumber) && String(asNumber) === String(sectionRef)
    ? { id: asNumber }
    : { documentId: String(sectionRef) };

  const section = await strapi.db.query('api::menu-section.menu-section').findOne({
    where,
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

  const businessId = await resolveBusinessIdFromSection(sectionRef);

  if (businessId) {
    data.business = businessId;
  } else {
    data.business = null;
  }
}

module.exports = {
  async beforeCreate(event) {
    await syncBusinessFromSection(event);
  },

  async beforeUpdate(event) {
    await syncBusinessFromSection(event, { lookupCurrentSection: true });
  },
};
