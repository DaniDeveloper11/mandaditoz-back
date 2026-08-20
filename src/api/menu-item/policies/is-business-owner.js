'use strict';

const { ownerIdOfItem } = require('../../../utils/menu-ownership');

/**
 * Protege update/delete de un platillo: solo el dueño del negocio al que
 * pertenece. `create` se verifica en el controller (ver la nota en la policy
 * de menu-section).
 */
module.exports = async (policyContext, config, { strapi }) => {
  const { state, params } = policyContext;
  if (!state.user) return false;

  const ownerId = await ownerIdOfItem(strapi, params.id);
  return ownerId != null && ownerId === state.user.id;
};
