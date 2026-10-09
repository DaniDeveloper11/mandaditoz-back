'use strict';

/**
 * Búsqueda de texto de negocios: `GET /api/businesses?q=...`.
 *
 * El `$containsi` de Strapi es un ILIKE crudo: "cafe" no encuentra "Café" y
 * "panaderia" no encuentra "Panadería". Aquí se arma, por negocio, un solo
 * texto normalizado (minúsculas, sin acentos, ñ → n) con todo lo buscable, y se
 * compara contra los términos normalizados igual. El controller convierte el
 * resultado en un filtro `id $in`, así que ciudad, categoría, destacados,
 * orden, populate y paginación siguen siendo los del `find` de siempre.
 *
 * Reglas:
 * - Cada palabra de la búsqueda tiene que aparecer en algún campo (AND entre
 *   palabras, OR entre campos). "tacos centro" exige ambas.
 * - Si eso no da nada y `pg_trgm` está instalada, se reintenta tolerando
 *   errores de dedo ("panadreia" → Panadería) con `word_similarity`. Solo como
 *   respaldo: con umbral 0.5 ya aparece ruido como "pizeria" → Tortillería.
 *
 * Los acentos se quitan con `translate()` y no con la extensión `unaccent`,
 * para no depender de una extensión en la parte que más importa. `pg_trgm` es
 * opcional (la crea 006-search-extensions.sql si el rol tiene permiso); si no
 * está, simplemente no hay respaldo por errores de dedo.
 *
 * Sin índice a propósito: el texto se arma en cada consulta (~70 ms con 440
 * negocios en local). Si el directorio crece a varios miles, conviene
 * materializarlo en una columna con índice GIN trigram.
 */

const MAX_QUERY_LENGTH = 100;
const MAX_TERMS = 5;
const MIN_TERM_LENGTH = 2;
const FUZZY_MIN_TERM_LENGTH = 4;
const FUZZY_THRESHOLD = 0.6;

const ACCENTED = 'ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüûÑñ';
const PLAIN = 'aaaaaaaaeeeeeeeeiiiiiiiioooooooouuuuuuuunn';

// translate() antes de lower(): en una base con collation C, lower() solo
// baja ASCII y dejaría "Á" intacta.
const norm = (expr) => `lower(translate(${expr}, '${ACCENTED}', '${PLAIN}'))`;

/** Normaliza igual que `norm()` en SQL y parte en términos. */
function toTerms(q) {
  return String(q ?? '')
    .slice(0, MAX_QUERY_LENGTH)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= MIN_TERM_LENGTH)
    .slice(0, MAX_TERMS);
}

const escapeLike = (t) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

// Un texto por negocio: nombre, descripciones, categorías principal y
// secundarias (con su padre, para que "comida" encuentre a una taquería),
// etiquetas, colonia y platillos del menú.
const DOCS_CTE = `
  docs AS (
    SELECT b.id, ${norm(`concat_ws(' ',
      b.name, b.short_description, b.description,
      (SELECT string_agg(concat_ws(' ', c.name, pc.name), ' ')
         FROM (SELECT category_id FROM businesses_category_lnk WHERE business_id = b.id
               UNION
               SELECT category_id FROM businesses_secondary_categories_lnk WHERE business_id = b.id) l
         JOIN categories c ON c.id = l.category_id
         LEFT JOIN categories_parent_lnk pl ON pl.category_id = c.id
         LEFT JOIN categories pc ON pc.id = pl.inv_category_id),
      (SELECT string_agg(t.name, ' ')
         FROM businesses_tags_lnk tl JOIN tags t ON t.id = tl.tag_id
        WHERE tl.business_id = b.id),
      (SELECT n.name
         FROM businesses_neighborhood_lnk nl JOIN neighborhoods n ON n.id = nl.neighborhood_id
        WHERE nl.business_id = b.id),
      (SELECT string_agg(mi.name, ' ')
         FROM menu_items_business_lnk ml JOIN menu_items mi ON mi.id = ml.menu_item_id
        WHERE ml.business_id = b.id AND mi.archived_at IS NULL)
    )`)} AS doc
    FROM businesses b
    WHERE b.archived_at IS NULL
  )`;

let trgmAvailable = null;

async function hasTrgm() {
  if (trgmAvailable === null) {
    try {
      const { rows } = await strapi.db.connection.raw(
        `SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`
      );
      trgmAvailable = rows.length > 0;
    } catch {
      trgmAvailable = false;
    }
  }
  return trgmAvailable;
}

async function runSearch(terms, fuzzy) {
  const conditions = [];
  const bindings = [];
  for (const term of terms) {
    if (fuzzy && term.length >= FUZZY_MIN_TERM_LENGTH) {
      conditions.push(`(doc LIKE ? OR word_similarity(?, doc) >= ${FUZZY_THRESHOLD})`);
      bindings.push(`%${escapeLike(term)}%`, term);
    } else {
      conditions.push(`doc LIKE ?`);
      bindings.push(`%${escapeLike(term)}%`);
    }
  }
  const { rows } = await strapi.db.connection.raw(
    `WITH ${DOCS_CTE} SELECT id FROM docs WHERE ${conditions.join(' AND ')}`,
    bindings
  );
  return rows.map((r) => r.id);
}

/**
 * Ids de los negocios que coinciden con `q`, o `null` si `q` no trae ningún
 * término utilizable (en ese caso no se filtra por texto).
 */
async function findBusinessIdsByText(q) {
  const terms = toTerms(q);
  if (!terms.length) return null;

  const ids = await runSearch(terms, false);
  if (ids.length || !(await hasTrgm())) return ids;
  return runSearch(terms, true);
}

module.exports = { findBusinessIdsByText };
