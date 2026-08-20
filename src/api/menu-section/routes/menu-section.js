'use strict';

const { factories } = require('@strapi/strapi');

module.exports = factories.createCoreRouter('api::menu-section.menu-section', {
  config: {
    update: {
      policies: ['api::menu-section.is-business-owner'],
    },
    delete: {
      policies: ['api::menu-section.is-business-owner'],
    },
  },
});
