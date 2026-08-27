'use strict';

const { factories } = require('@strapi/strapi');

// `only` deja fuera update y delete a propósito.
//
// Un PUT genérico sobre /orders/:id dejaría al comensal cambiarse el total, el
// estado o el negocio. Todo cambio de estado pasa por las rutas de order-flow,
// que validan la transición y quién la pide. Y un pedido no se borra: se cancela.
module.exports = factories.createCoreRouter('api::order.order', {
  only: ['find', 'findOne', 'create'],
});
