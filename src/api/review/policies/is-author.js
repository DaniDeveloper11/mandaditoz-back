'use strict';

module.exports = async (policyContext, config, { strapi }) => {
  const { state, params } = policyContext;
  const user = state.user;
  if (!user) return false;

  const review = await strapi.documents('api::review.review').findOne({
    documentId: params.id,
    populate: ['author'],
  });
  if (!review) return false;

  return review.author?.id === user.id;
};
