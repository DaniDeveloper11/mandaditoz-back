'use strict';

/**
 * Cupo de negocios publicados por dueño.
 *
 * El default aplica a todo el mundo; el admin puede ampliarlo caso por caso
 * desde Content Manager → User → `publishedBusinessLimit`. Los borradores no
 * cuentan: un dueño puede tener los que quiera y publicar hasta su cupo.
 */
const DEFAULT_PUBLISHED_LIMIT = 3;

/**
 * Normaliza el `owner` tal como llega en los lifecycles: puede venir como id
 * numérico, string, objeto de relación populada o el `{ connect: [...] }` que
 * manda el admin panel.
 */
function normalizeOwnerId(owner) {
  if (owner == null) return null;
  if (typeof owner === 'number' || typeof owner === 'string') {
    const id = Number(owner);
    return Number.isInteger(id) ? id : null;
  }
  if (Array.isArray(owner)) return normalizeOwnerId(owner[0]);
  if (typeof owner === 'object') {
    if (owner.id != null) return normalizeOwnerId(owner.id);
    if (Array.isArray(owner.connect)) return normalizeOwnerId(owner.connect[0]);
    if (Array.isArray(owner.set)) return normalizeOwnerId(owner.set[0]);
  }
  return null;
}

/**
 * Cuántos negocios puede tener publicados este dueño. Un valor inválido o
 * ausente en el usuario cae al default.
 */
async function getPublishedLimit(ownerId) {
  const id = normalizeOwnerId(ownerId);
  if (!id) return DEFAULT_PUBLISHED_LIMIT;

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id },
    select: ['id', 'publishedBusinessLimit'],
  });

  const limit = Number(user?.publishedBusinessLimit);
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_PUBLISHED_LIMIT;
}

module.exports = { DEFAULT_PUBLISHED_LIMIT, normalizeOwnerId, getPublishedLimit };
