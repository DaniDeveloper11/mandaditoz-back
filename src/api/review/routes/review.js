'use strict';
const { factories } = require('@strapi/strapi');

module.exports = factories.createCoreRouter('api::review.review', {
  config: {
    update: {
      policies: ['api::review.is-author'],
    },
    delete: {
      policies: ['api::review.is-author'],
    },
  },
});
