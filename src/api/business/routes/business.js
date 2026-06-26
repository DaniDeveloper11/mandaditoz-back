'use strict';
const { factories } = require('@strapi/strapi');

module.exports = factories.createCoreRouter('api::business.business', {
  config: {
    update: {
      policies: ['api::business.is-owner'],
    },
    delete: {
      policies: ['api::business.is-owner'],
    },
  },
});
