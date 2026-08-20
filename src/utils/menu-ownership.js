'use strict';

/**
 * Helpers de propiedad para el menú.
 *
 * La cadena es de dos o tres saltos:
 *   menu-item → section → business → owner
 *   menu-section → business → owner
 *
 * Se usan tanto desde las policies (update/delete, donde ya existe la entidad)
 * como desde los controllers (create/update, donde el destino viene en el body
 * y una policy no alcanza a verlo).
 */

/** Normaliza las formas en que puede llegar una relación: id, documentId, {connect:[…]}, entidad. */
function extractRelationRef(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;

  if (Array.isArray(value)) return extractRelationRef(value[0] ?? null);

  if (typeof value === 'object') {
    if ('connect' in value || 'set' in value || 'disconnect' in value) {
      const next = value.set ?? value.connect;
      if (Array.isArray(next)) return next.length ? extractRelationRef(next[0]) : null;
      return next != null ? extractRelationRef(next) : null;
    }
    if (value.id != null) return value.id;
    if (value.documentId != null) return value.documentId;
    return null;
  }

  return value;
}

/** Construye un `where` que acepta id numérico o documentId. */
function refToWhere(ref) {
  const asNumber = Number(ref);
  return Number.isInteger(asNumber) && String(asNumber) === String(ref)
    ? { id: asNumber }
    : { documentId: String(ref) };
}

/** Devuelve el id del dueño de un negocio, o null. */
async function ownerIdOfBusiness(strapi, businessRef) {
  if (businessRef == null) return null;
  const business = await strapi.db.query('api::business.business').findOne({
    where: refToWhere(businessRef),
    select: ['id'],
    populate: { owner: { select: ['id'] } },
  });
  return business?.owner?.id ?? null;
}

/** Devuelve el id del dueño del negocio al que pertenece una sección, o null. */
async function ownerIdOfSection(strapi, sectionRef) {
  if (sectionRef == null) return null;
  const section = await strapi.db.query('api::menu-section.menu-section').findOne({
    where: refToWhere(sectionRef),
    select: ['id'],
    populate: { business: { select: ['id'], populate: { owner: { select: ['id'] } } } },
  });
  return section?.business?.owner?.id ?? null;
}

/** Devuelve el id del dueño del negocio al que pertenece un platillo, o null. */
async function ownerIdOfItem(strapi, itemRef) {
  if (itemRef == null) return null;
  const item = await strapi.db.query('api::menu-item.menu-item').findOne({
    where: refToWhere(itemRef),
    select: ['id'],
    populate: { business: { select: ['id'], populate: { owner: { select: ['id'] } } } },
  });
  return item?.business?.owner?.id ?? null;
}

module.exports = {
  extractRelationRef,
  refToWhere,
  ownerIdOfBusiness,
  ownerIdOfSection,
  ownerIdOfItem,
};
