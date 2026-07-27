'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/business-events',
      handler: 'business-event.track',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/business-events/stats/:documentId',
      handler: 'business-event.statsForBusiness',
    },
  ],
};
