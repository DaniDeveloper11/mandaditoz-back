'use strict';

const { factories } = require('@strapi/strapi');

module.exports = factories.createCoreRouter('api::menu-item.menu-item', {
  config: {
    update: {
      policies: ['api::menu-item.is-business-owner'],
    },
    delete: {
      policies: ['api::menu-item.is-business-owner'],
    },
  },
});
