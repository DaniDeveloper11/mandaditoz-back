'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/reviews/:id/respond',
      handler: 'review.respond',
    },
    {
      method: 'POST',
      path: '/reviews/submit',
      handler: 'review.submit',
      config: {
        auth: false,
        middlewares: [
          { name: 'global::rate-limit-submit', config: { max: 3 } },
        ],
      },
    },
  ],
};
