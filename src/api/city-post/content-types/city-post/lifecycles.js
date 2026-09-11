'use strict';

const { errors } = require('@strapi/utils');

/**
 * Vigencia de un post de cartelera.
 *
 * Toda la UI filtra por UNA sola condicion (`endAt >= now`) para que el indice
 * parcial idx_city_posts_cartelera sirva y para no repartir la logica de
 * vigencia en cada pagina. Eso exige que `endAt` nunca quede nulo, asi que si
 * el admin lo deja vacio se rellena aqui.
 *
 * La zona horaria es explicita y no depende de `TZ` del proceso, por la misma
 * razon que en src/utils/is-open.js: Railway corre en UTC, y un evento de un
 * dia calculado en UTC desaparece de la cartelera ~6 horas antes de que el dia
 * termine en Jalisco.
 */

const TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Mexico_City';
const AVISO_DIAS_POR_DEFECTO = 30;

/** Offset de la zona respecto a UTC, en ms, en ese instante concreto. */
function tzOffsetMs(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  // Intl con hour12:false devuelve "24" para la medianoche.
  // Los milisegundos se reponen a mano (Intl no los expone en formatToParts):
  // sin ellos el offset sale desfasado por los ms de `date` y el endAt de un
  // evento se iba ~1 segundo dentro del dia siguiente.
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
    date.getUTCMilliseconds()
  );
  return asIfUtc - date.getTime();
}

/**
 * 23:59:59.999 del dia local de `date`.
 * Se calcula con Intl en vez de restar 6 horas porque el horario de verano
 * cambio en Mexico en 2022 y hardcodear el offset es pedir el mismo bug.
 */
function endOfLocalDay(date, timeZone = TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const localMidnightEnd = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    23, 59, 59, 999
  );

  let ms = localMidnightEnd - tzOffsetMs(date, timeZone);
  // Si el dia cruza un cambio de horario, el offset del instante candidato no
  // es el mismo que el del inicio: se recalcula una vez con el candidato.
  const offsetEnElCandidato = tzOffsetMs(new Date(ms), timeZone);
  const corregido = localMidnightEnd - offsetEnElCandidato;
  if (corregido !== ms) ms = corregido;

  return new Date(ms);
}

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fin de vigencia por defecto segun el tipo de post. */
function endAtPorDefecto(kind, startAt) {
  const base = kind === 'aviso'
    ? new Date(startAt.getTime() + AVISO_DIAS_POR_DEFECTO * 24 * 60 * 60 * 1000)
    : startAt;
  return endOfLocalDay(base);
}

/**
 * Rellena y valida startAt/endAt sobre la fusion de la fila actual (si es
 * update) con lo que trae el payload.
 *
 * El error solo se lanza cuando el endAt invalido VIENE EN EL PAYLOAD. Si el
 * endAt guardado quedo antes del nuevo startAt, se recalcula en silencio: ese
 * valor casi siempre lo puso este mismo lifecycle, y hacer que mover la fecha
 * de un aviso falle con "la fecha de fin no puede ser anterior" por un dato
 * que el admin nunca escribio es hostil y no tiene arreglo obvio desde el
 * panel.
 */
function resolverVigencia(data, actual = null) {
  const kind = data.kind ?? actual?.kind ?? 'evento';
  const startAt = parseDate('startAt' in data ? data.startAt : actual?.startAt);

  // startAt es required en el schema: si falta, que la validacion de Strapi
  // sea la que lo reporte con su propio mensaje.
  if (!startAt) return;

  // Tres casos distintos, y confundirlos se nota en el panel:
  //  1. el payload trae un endAt con valor  -> se valida y se respeta
  //  2. el payload trae endAt vacio (null)  -> el admin lo borro: se recalcula
  //  3. el payload no menciona endAt        -> se hereda el guardado
  const mencionado = 'endAt' in data;
  const enviado = mencionado ? parseDate(data.endAt) : null;

  if (mencionado && !enviado) {
    data.endAt = endAtPorDefecto(kind, startAt);
    return;
  }

  const endAtEntrante = enviado ?? parseDate(actual?.endAt);

  if (!endAtEntrante) {
    data.endAt = endAtPorDefecto(kind, startAt);
    return;
  }

  if (endAtEntrante.getTime() < startAt.getTime()) {
    if (enviado) {
      throw new errors.ApplicationError(
        'La fecha de fin no puede ser anterior a la de inicio.',
        { code: 'INVALID_DATE_RANGE' }
      );
    }
    data.endAt = endAtPorDefecto(kind, startAt);
    return;
  }

  data.endAt = endAtEntrante;
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    if (!data) return;
    resolverVigencia(data);
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    if (!data) return;

    // Un update parcial puede traer solo startAt (o solo kind), asi que la
    // vigencia se resuelve contra la fila que ya esta guardada.
    const tocaLaVigencia = 'startAt' in data || 'endAt' in data || 'kind' in data;
    if (!tocaLaVigencia) return;

    const actual = where
      ? await strapi.db.query('api::city-post.city-post').findOne({
          where,
          select: ['startAt', 'endAt', 'kind'],
        })
      : null;

    resolverVigencia(data, actual);
  },
};
