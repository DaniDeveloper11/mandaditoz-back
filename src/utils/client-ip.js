'use strict';

/**
 * IP del cliente para rate limits y límites por IP.
 *
 * Antes se tomaba la PRIMERA entrada de `X-Forwarded-For`, que es justo la que
 * escribe el cliente: con `X-Forwarded-For: 1.2.3.4` cualquiera se saltaba el
 * rate limit de /reviews/submit y el "una reseña por IP cada 24 h".
 *
 * Cada proxy de confianza AÑADE una entrada al final, así que la fiable es la
 * que puso el último de ellos: contando `TRUSTED_PROXY_COUNT` desde el final.
 * - Railway (un proxy delante del contenedor): 1, el default en producción.
 * - Si algún día el API pasa también por Cloudflare: 2.
 * - Sin proxy (local): 0 → se usa la IP del socket e `X-Forwarded-For` se ignora.
 */
const DEFAULT_COUNT = process.env.NODE_ENV === 'production' ? 1 : 0;
const parsed = parseInt(process.env.TRUSTED_PROXY_COUNT ?? '', 10);
const TRUSTED_PROXY_COUNT = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_COUNT;

function getClientIp(ctx) {
  const socketIp = ctx.request.socket?.remoteAddress || ctx.request.ip || 'unknown';
  if (TRUSTED_PROXY_COUNT === 0) return socketIp;

  const forwarded = ctx.request.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string' || !forwarded.length) return socketIp;

  const chain = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
  // Menos entradas que proxies: la cadena no viene de ellos; se usa el socket.
  if (chain.length < TRUSTED_PROXY_COUNT) return socketIp;
  return chain[chain.length - TRUSTED_PROXY_COUNT];
}

module.exports = { getClientIp, TRUSTED_PROXY_COUNT };
