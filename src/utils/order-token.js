'use strict';

const crypto = require('crypto');

/**
 * Alfabeto sin caracteres ambiguos: nada de 0/O ni 1/I/L.
 * El folio se dicta por teléfono ("es el eme zeta guion ocho efe tres...") y
 * confundir un cero con una O cuesta una llamada extra en plena hora pico.
 */
const FOLIO_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const FOLIO_LENGTH = 5;

/** Vigencia del link mágico. Ver también: se invalida al cerrar el pedido. */
const OWNER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Folio legible y ALEATORIO: `MZ-8F3K2`.
 *
 * Nada de MAX+1: tiene condición de carrera con dos pedidos simultáneos y
 * además le revela a cualquiera cuántos pedidos lleva la plataforma — el
 * clásico truco de pedir el primero y el último del mes para estimar volumen.
 */
function generateOrderNumber() {
  const bytes = crypto.randomBytes(FOLIO_LENGTH);
  let out = '';
  for (let i = 0; i < FOLIO_LENGTH; i++) {
    out += FOLIO_ALPHABET[bytes[i] % FOLIO_ALPHABET.length];
  }
  return `MZ-${out}`;
}

/**
 * Folio único, reintentando ante colisión.
 *
 * El espacio es 31^5 ≈ 28.6 millones. Con pocos miles de pedidos la
 * probabilidad de choque es mínima, pero el índice unique de la base es la
 * verdad: si choca, se reintenta en vez de reventar el pedido de alguien.
 */
async function generateUniqueOrderNumber(strapi, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const candidate = generateOrderNumber();
    const existing = await strapi.db.query('api::order.order').findOne({
      where: { orderNumber: candidate },
      select: ['id'],
    });
    if (!existing) return candidate;
    strapi.log.warn(`[order] folio repetido (${candidate}), reintentando`);
  }
  throw new Error('No se pudo generar un folio único para el pedido');
}

/**
 * Credencial del link mágico: 32 bytes de entropía real.
 *
 * El token identifica UN pedido, no una sesión. Quien lo tenga solo puede
 * operar ese pedido concreto — ese es justamente el punto: el dueño acepta de
 * un toque desde su celular sin escribir una contraseña a las 8 de la noche.
 */
function generateOwnerToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function ownerTokenExpiryFrom(now = new Date()) {
  return new Date(now.getTime() + OWNER_TOKEN_TTL_MS);
}

function isOwnerTokenExpired(order, now = new Date()) {
  if (!order?.ownerTokenExpiresAt) return true;
  return new Date(order.ownerTokenExpiresAt).getTime() <= now.getTime();
}

module.exports = {
  FOLIO_ALPHABET,
  OWNER_TOKEN_TTL_MS,
  generateOrderNumber,
  generateUniqueOrderNumber,
  generateOwnerToken,
  ownerTokenExpiryFrom,
  isOwnerTokenExpired,
};
