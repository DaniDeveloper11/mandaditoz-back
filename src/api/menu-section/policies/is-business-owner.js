'use strict';

const { ownerIdOfSection } = require('../../../utils/menu-ownership');

/**
 * Protege update/delete de una sección: solo el dueño del negocio al que
 * pertenece. No cubre `create` — ahí no existe la entidad todavía y el negocio
 * destino viene en el body, así que esa verificación vive en el controller.
 */
module.exports = async (policyContext, config, { strapi }) => {
  const { state, params } = policyContext;
  if (!state.user) return false;

  const ownerId = await ownerIdOfSection(strapi, params.id);
  return ownerId != null && ownerId === state.user.id;
};
