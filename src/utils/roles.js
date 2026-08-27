'use strict';

/**
 * Los roles son niveles acumulativos, no tipos excluyentes:
 * Authenticated (comensal) ⊂ BusinessOwner. Ascender nunca quita permisos,
 * así que es seguro llamar esto de forma idempotente.
 *
 * Devuelve true solo si hubo un ascenso real.
 */
async function promoteToBusinessOwner(strapi, userId) {
  if (!userId || !Number.isInteger(Number(userId))) return false;

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: Number(userId) },
    populate: { role: true },
  });
  if (!user) return false;
  if (user.role?.type === 'businessowner') return false;

  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'businessowner' },
  });
  if (!role) {
    strapi.log.warn('[roles] Rol BusinessOwner no existe; no se pudo ascender al usuario');
    return false;
  }

  await strapi.db.query('plugin::users-permissions.user').update({
    where: { id: user.id },
    data: { role: role.id },
  });
  strapi.log.info(`[roles] usuario ${user.id} ascendido de "${user.role?.type ?? '—'}" a BusinessOwner`);
  return true;
}

module.exports = { promoteToBusinessOwner };
