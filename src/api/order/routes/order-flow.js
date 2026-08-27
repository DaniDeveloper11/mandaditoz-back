'use strict';

// El link mágico va sin sesión: el token ES la credencial. El rate limit no
// está para frenar al dueño (32 bytes de entropía no se adivinan), sino para
// que nadie use el endpoint como sonda a ciegas.
const tokenRateLimit = {
  name: 'global::rate-limit-submit',
  config: { bucket: 'order-token', max: 60, windowMs: 10 * 60 * 1000 },
};

module.exports = {
  routes: [
    // ── Con sesión ────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/orders/business/:documentId',
      handler: 'order.findForBusiness',
    },
    {
      method: 'POST',
      path: '/orders/:id/cancel',
      handler: 'order.cancel',
    },
    {
      method: 'POST',
      path: '/orders/:id/status',
      handler: 'order.statusAsOwner',
    },

    // ── Link mágico, sin sesión ───────────────────────────────────────────
    {
      method: 'GET',
      path: '/orders/token/:token',
      handler: 'order.findByToken',
      config: { auth: false, policies: [], middlewares: [tokenRateLimit] },
    },
    {
      method: 'POST',
      path: '/orders/token/:token/status',
      handler: 'order.statusByToken',
      config: { auth: false, policies: [], middlewares: [tokenRateLimit] },
    },
  ],
};
