'use strict';

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/reviews/:id/respond',
      handler: 'review.respond',
    },
  ],
};
