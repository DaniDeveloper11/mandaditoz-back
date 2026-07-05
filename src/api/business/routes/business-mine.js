'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/businesses/mine',
      handler: 'business.mine',
      config: {
        auth: {},
      },
    },
  ],
};
