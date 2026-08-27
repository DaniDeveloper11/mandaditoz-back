'use strict';

const { errors } = require('@strapi/utils');

const MAX_LINES = 40;
const MAX_QTY_PER_LINE = 99;

/**
 * REGLA CENTRAL DE LA FASE: el precio nunca viene del cliente.
 *
 * El navegador manda QUÉ platillos y CUÁNTOS. Los precios se releen de la base
 * y el total se arma aquí. Sin esto, cualquiera con las herramientas de
 * desarrollador abiertas pide tacos a un peso.
 *
 * Todo el dinero se maneja en CENTAVOS ENTEROS. El tipo `decimal` de Strapi es
 * `double precision` en Postgres: 89.90 * 3 en flotante da 269.70000000000005.
 */

function badRequest(message, details) {
  return new errors.ApplicationError(message, details);
}

/** Pesos (decimal de la base) → centavos enteros. */
function toCents(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Normaliza lo que llegó del carrito y junta líneas repetidas.
 * Dos veces el mismo platillo con la misma indicación es una línea de dos, no
 * dos líneas de uno — así lo espera ver el cocinero en el ticket.
 */
function normalizeRequestedLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw badRequest('El pedido no tiene platillos.');
  }
  if (rawLines.length > MAX_LINES) {
    throw badRequest(`Un pedido no puede tener más de ${MAX_LINES} platillos distintos.`);
  }

  const merged = new Map();

  for (const raw of rawLines) {
    const documentId = String(raw?.menuItemDocumentId ?? raw?.menuItem ?? '').trim();
    if (!documentId) throw badRequest('Hay un platillo sin identificar en el pedido.');

    const quantity = Number(raw?.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw badRequest('La cantidad de cada platillo debe ser un número entero mayor a cero.');
    }

    const notes = String(raw?.notes ?? '').trim().slice(0, 200);
    const key = `${documentId}::${notes}`;
    const existing = merged.get(key);

    const nextQty = (existing?.quantity ?? 0) + quantity;
    if (nextQty > MAX_QTY_PER_LINE) {
      throw badRequest(`No se pueden pedir más de ${MAX_QTY_PER_LINE} piezas del mismo platillo.`);
    }

    merged.set(key, { documentId, notes, quantity: nextQty });
  }

  return [...merged.values()];
}

/**
 * Construye las líneas definitivas del pedido a partir del carrito.
 *
 * @param {object} business  negocio ya cargado (necesita `id` y `name`)
 * @returns {{ lines: Array, subtotalCents: number }}
 * @throws  ApplicationError con mensaje en español si algo no procede
 */
async function priceCart(strapi, business, rawLines) {
  const requested = normalizeRequestedLines(rawLines);
  const documentIds = [...new Set(requested.map((l) => l.documentId))];

  const items = await strapi.db.query('api::menu-item.menu-item').findMany({
    where: { documentId: { $in: documentIds } },
    select: ['id', 'documentId', 'name', 'price', 'isAvailable', 'archivedAt'],
    populate: {
      // El `business` denormalizado en menu-item (Fase 1) es lo que permite
      // validar la pertenencia en UNA query en vez de N.
      business: { select: ['id'] },
      section: { select: ['id', 'isActive', 'archivedAt'] },
    },
    limit: MAX_LINES,
  });

  const byDocumentId = new Map(items.map((i) => [i.documentId, i]));

  const lines = [];
  let subtotalCents = 0;

  for (const req of requested) {
    const item = byDocumentId.get(req.documentId);

    if (!item || item.archivedAt) {
      throw badRequest('Uno de los platillos de tu pedido ya no existe. Actualiza el menú y vuelve a intentar.');
    }

    // AQUÍ SE CIERRA LA INYECCIÓN ENTRE NEGOCIOS: mandar el documentId de un
    // platillo de otro restaurante (más barato) para pagarlo en éste.
    if (item.business?.id !== business.id) {
      strapi.log.warn(
        `[order] intento de pedir el platillo ${item.documentId} (negocio ${item.business?.id}) en el negocio ${business.id}`
      );
      throw badRequest('Uno de los platillos no pertenece a este negocio.');
    }

    if (item.isAvailable === false) {
      throw badRequest(`"${item.name}" está agotado en este momento.`);
    }

    if (item.section && (item.section.isActive === false || item.section.archivedAt)) {
      throw badRequest(`"${item.name}" ya no está en el menú.`);
    }

    const unitPriceCents = toCents(item.price);
    if (unitPriceCents == null) {
      throw badRequest(`"${item.name}" no tiene un precio válido. Avísale al negocio.`);
    }

    const lineTotalCents = unitPriceCents * req.quantity;
    subtotalCents += lineTotalCents;

    lines.push({
      menuItemDocumentId: item.documentId,
      name: item.name,
      unitPriceCents,
      quantity: req.quantity,
      notes: req.notes || null,
      lineTotalCents,
    });
  }

  return { lines, subtotalCents };
}

module.exports = {
  MAX_LINES,
  MAX_QTY_PER_LINE,
  toCents,
  normalizeRequestedLines,
  priceCart,
};
