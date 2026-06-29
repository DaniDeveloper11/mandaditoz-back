'use strict';

module.exports = async (policyContext, config, { strapi }) => {
  const { state, params } = policyContext;
  const user = state.user;

  console.log('[is-owner] policy ejecutada, params.id=', params.id, 'user=', user?.id);

  if (!user) {
    console.log('[is-owner] sin usuario → 403');
    return false;
  }

  const business = await strapi.documents('api::business.business').findOne({
    documentId: params.id,
    populate: ['owner'],
  });

  console.log('[is-owner] business.owner=', JSON.stringify(business?.owner));

  if (!business) return false;

  const result = business.owner?.id === user.id;
  console.log(`[is-owner] owner.id=${business.owner?.id} === user.id=${user.id} → ${result}`);
  return result;
};
