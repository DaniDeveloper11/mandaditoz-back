'use strict';

/**
 * ¿Está abierto el negocio AHORA?
 *
 * Existe una función equivalente en el frontend (`app/utils/strapi.js`
 * → `computeIsOpen`), pero **no se puede reusar aquí**: aquella usa el reloj
 * del navegador y por eso está guardada con `import.meta.client`. Railway corre
 * en UTC, así que copiarla al backend rechazaría pedidos ~6 horas al día —
 * justo la franja de la cena, que es cuando más se pide.
 *
 * De ahí que la zona horaria sea explícita y no dependa de `TZ` del proceso.
 */

const TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Mexico_City';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Descompone `now` en la zona horaria del negocio.
 * Se usa Intl en vez de aritmética de offsets porque el horario de verano
 * cambió en México en 2022 y volver a hardcodear -6 es pedir el mismo bug.
 */
function localParts(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  );

  // 'Mon' → 'mon'. Intl devuelve el weekday en inglés porque el locale es en-US.
  const weekday = String(parts.weekday || '').slice(0, 3).toLowerCase();

  return {
    dayKey: weekday,
    dayIndex: DAY_KEYS.indexOf(weekday),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** '18:30:00.000' | '18:30' → 1110 minutos. null si no se puede leer. */
function timeToMinutes(value) {
  if (!value) return null;
  const [h, m] = String(value).split(':');
  const hours = Number(h);
  const mins = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  return hours * 60 + mins;
}

/**
 * ¿`nowMinutes` cae dentro de la franja?
 * Soporta 24 h y franjas que cruzan la medianoche (22:00 → 03:00).
 */
function isWithinRange(row, nowMinutes) {
  if (row.isClosed) return false;
  if (row.is24Hours) return true;

  const open = timeToMinutes(row.openTime);
  const close = timeToMinutes(row.closeTime);
  if (open == null || close == null) return false;

  if (row.crossesMidnight || close <= open) {
    // 22:00 → 03:00: abierto si es tarde-noche O si es madrugada.
    return nowMinutes >= open || nowMinutes < close;
  }
  return nowMinutes >= open && nowMinutes < close;
}

/**
 * @returns {true|false|null} null = no hay datos suficientes para decidir.
 *
 * Reglas (mismas que el frontend, para que no se contradigan):
 *  - Una excepción para hoy manda sobre el horario regular.
 *  - Sin filas para hoy → null (desconocido), no false.
 *  - Todas las filas de hoy con isClosed → false.
 */
function isBusinessOpenNow(hours = [], hourExceptions = [], now = new Date()) {
  const local = localParts(now, TIMEZONE);

  const exception = (hourExceptions || []).find((e) => {
    if (!e?.date) return false;
    // El campo `date` de Strapi llega como 'YYYY-MM-DD' o como Date.
    const iso = e.date instanceof Date
      ? e.date.toISOString().slice(0, 10)
      : String(e.date).slice(0, 10);
    return iso === local.isoDate;
  });

  if (exception) return isWithinRange(exception, local.minutes);

  const today = (hours || []).filter((h) => h?.dayOfWeek === local.dayKey);
  if (!today.length) return null;
  if (today.every((h) => h.isClosed)) return false;
  return today.some((h) => isWithinRange(h, local.minutes));
}

/**
 * Lee los horarios del negocio y responde si está abierto.
 * Devuelve null si el negocio no tiene horarios cargados — el llamador decide
 * qué hacer con "no sé" (para pedidos, dejar pasar: es más caro perder una
 * venta real que aceptar un pedido fuera de horario que el negocio puede rechazar).
 */
async function isBusinessOpenById(strapi, businessId, now = new Date()) {
  const [hours, exceptions] = await Promise.all([
    strapi.db.query('api::business-hour.business-hour').findMany({
      where: { business: businessId },
      select: ['dayOfWeek', 'openTime', 'closeTime', 'isClosed', 'is24Hours', 'crossesMidnight'],
      limit: 100,
    }),
    strapi.db.query('api::business-hour-exception.business-hour-exception').findMany({
      where: { business: businessId },
      select: ['date', 'openTime', 'closeTime', 'isClosed', 'crossesMidnight'],
      limit: 100,
    }),
  ]);

  return isBusinessOpenNow(hours, exceptions, now);
}

module.exports = {
  TIMEZONE,
  isBusinessOpenNow,
  isBusinessOpenById,
  // exportados para pruebas
  timeToMinutes,
  isWithinRange,
  localParts,
};
