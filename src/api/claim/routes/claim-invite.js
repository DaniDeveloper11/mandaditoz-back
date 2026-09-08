'use strict';

// Rutas del reclamo por invitación. Van en un archivo aparte del core router
// (mismo patrón que usa la API de business con submit y mine).
//
// Las dos son públicas a propósito: quien llega aquí todavía no tiene cuenta —
// crearla es justo lo que viene a hacer. La credencial es el token del enlace,
// que se mandó al teléfono ya publicado en la ficha.
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/claims/invite/:token',
      handler: 'claim.invite',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/claims/invite/:token/redeem',
      handler: 'claim.redeemInvite',
      config: {
        auth: false,
        policies: [],
        // Adivinar un token de 32 hex es inviable, pero el canje crea usuarios:
        // sin freno, es una fábrica de cuentas para quien tenga un enlace.
        middlewares: [{ name: 'global::rate-limit-submit', config: { bucket: 'claim-redeem', max: 10 } }],
      },
    },
  ],
};
