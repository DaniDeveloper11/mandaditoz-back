'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/businesses/submit',
      handler: 'business.submit',
      config: {
        auth: false,
        middlewares: ['global::rate-limit-submit'],
      },
    },
  ],
};
