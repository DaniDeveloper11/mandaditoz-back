'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/businesses/submit',
      handler: 'business.submit',
      config: {
        auth: false,
        middlewares: [{ name: 'global::rate-limit-submit', config: { bucket: 'business-submit' } }],
      },
    },
  ],
};
