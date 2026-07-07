'use strict';

// Rate limit por IP para el endpoint público POST /api/businesses/submit.
// Ventana deslizante en memoria — no persiste entre reinicios y no comparte
// estado entre procesos. Para producción con múltiples instancias, migrar a
// Redis (koa-ratelimit soporta Redis nativamente).

const buckets = new Map();
const WINDOW_MS = 60 * 60 * 1000;   // 1 hora
const MAX_REQUESTS = 5;             // máx solicitudes por IP por ventana
const PRUNE_PROBABILITY = 0.02;     // limpia buckets vencidos ~1 de cada 50 hits

function getClientIp(ctx) {
  const forwarded = ctx.request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return ctx.request.ip || 'unknown';
}

function prune(now) {
  for (const [ip, times] of buckets) {
    const kept = times.filter((t) => now - t < WINDOW_MS);
    if (kept.length === 0) buckets.delete(ip);
    else buckets.set(ip, kept);
  }
}

module.exports = (config, { strapi }) => {
  const max = Number(config?.max ?? MAX_REQUESTS);
  const windowMs = Number(config?.windowMs ?? WINDOW_MS);

  return async (ctx, next) => {
    const ip = getClientIp(ctx);
    const now = Date.now();

    if (Math.random() < PRUNE_PROBABILITY) prune(now);

    const times = (buckets.get(ip) || []).filter((t) => now - t < windowMs);

    if (times.length >= max) {
      strapi.log.warn(`[rate-limit-submit] IP ${ip} bloqueada (${times.length} req / ${windowMs}ms)`);
      ctx.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return ctx.tooManyRequests('Demasiadas solicitudes desde esta dirección. Intenta de nuevo más tarde.');
    }

    times.push(now);
    buckets.set(ip, times);

    await next();
  };
};
