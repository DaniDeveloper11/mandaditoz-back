'use strict';

module.exports = async (policyContext, config, { strapi }) => {
  const { state, params } = policyContext;
  const user = state.user;

  if (!user) return false;

  const business = await strapi.documents('api::business.business').findOne({
    documentId: params.id,
    populate: ['owner'],
  });

  if (!business) return false;

  return business.owner?.id === user.id;
};
