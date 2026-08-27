'use strict';

// Rate limit por IP para endpoints públicos (sin sesión).
// Ventana deslizante en memoria — no persiste entre reinicios y no comparte
// estado entre procesos. Para producción con múltiples instancias, migrar a
// Redis (koa-ratelimit soporta Redis nativamente).
//
// Los contadores se agrupan por `bucket`: cada ruta que lo use debe declarar el
// suyo. Con un solo Map global, una ruta con max:3 se bloqueaba contando también
// los hits de las demás rutas protegidas, y el límite más estricto acababa
// aplicándose a todas.

const buckets = new Map(); // Map<bucketName, Map<ip, number[]>>

const WINDOW_MS = 60 * 60 * 1000;   // 1 hora
const MAX_REQUESTS = 5;             // máx solicitudes por IP por ventana
const PRUNE_PROBABILITY = 0.02;     // limpia entradas vencidas ~1 de cada 50 hits

function getClientIp(ctx) {
  const forwarded = ctx.request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return ctx.request.ip || 'unknown';
}

function bucketFor(name) {
  let bucket = buckets.get(name);
  if (!bucket) {
    bucket = new Map();
    buckets.set(name, bucket);
  }
  return bucket;
}

function prune(now, windowMs) {
  for (const [name, bucket] of buckets) {
    for (const [ip, times] of bucket) {
      const kept = times.filter((t) => now - t < windowMs);
      if (kept.length === 0) bucket.delete(ip);
      else bucket.set(ip, kept);
    }
    if (bucket.size === 0) buckets.delete(name);
  }
}

module.exports = (config, { strapi }) => {
  const max = Number(config?.max ?? MAX_REQUESTS);
  const windowMs = Number(config?.windowMs ?? WINDOW_MS);
  const name = String(config?.bucket ?? 'default');

  return async (ctx, next) => {
    const ip = getClientIp(ctx);
    const now = Date.now();

    if (Math.random() < PRUNE_PROBABILITY) prune(now, windowMs);

    const bucket = bucketFor(name);
    const times = (bucket.get(ip) || []).filter((t) => now - t < windowMs);

    if (times.length >= max) {
      strapi.log.warn(`[rate-limit:${name}] IP ${ip} bloqueada (${times.length} req / ${windowMs}ms)`);
      ctx.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return ctx.tooManyRequests('Demasiadas solicitudes desde esta dirección. Intenta de nuevo más tarde.');
    }

    times.push(now);
    bucket.set(ip, times);

    await next();
  };
};

// Exportado solo para pruebas: permite reiniciar el estado entre casos.
module.exports._reset = () => buckets.clear();
