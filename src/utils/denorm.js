'use strict';

/**
 * Ejecuta `fn` cuando la transaccion en curso haya hecho COMMIT (o de inmediato
 * si no hay transaccion abierta).
 *
 * Los recalcs de este archivo leen y escriben con `strapi.db.connection.raw`,
 * que toma su propia conexion del pool y NO ve lo que la transaccion del
 * document service todavia no commiteo. Un lifecycle que dispara el recalc con
 * `setImmediate` puede ganarle al COMMIT y guardar el conteo viejo — que es
 * exactamente lo que pasaba al publicar una resena desde el admin: el recalc
 * leia la resena aun como 'pending' y dejaba el negocio en 0 resenas.
 */
function runAfterCommit(fn) {
  const run = () => {
    setImmediate(async () => {
      try {
        await fn();
      } catch (err) {
        strapi.log.error('[denorm afterCommit] error:', err);
      }
    });
  };

  if (!strapi.db.inTransaction?.()) {
    run();
    return;
  }

  strapi.db
    .transaction(({ onCommit }) => {
      onCommit(run);
    })
    .catch((err) => {
      strapi.log.error('[denorm afterCommit] no se pudo enganchar al commit:', err);
      run();
    });
}

/**
 * Recalcula business_count de una categoría desde su tabla link.
 * Idempotente: no depende de saber si fue add/remove.
 */
async function recalcCategoryBusinessCount(categoryId) {
  if (!categoryId) return;
  await strapi.db.connection.raw(
    `UPDATE categories SET business_count = (
       SELECT COUNT(*) FROM businesses_category_lnk WHERE category_id = ?
     ) WHERE id = ?`,
    [categoryId, categoryId]
  );
}

async function recalcCityBusinessCount(cityId) {
  if (!cityId) return;
  await strapi.db.connection.raw(
    `UPDATE cities SET business_count = (
       SELECT COUNT(*) FROM businesses_city_lnk WHERE city_id = ?
     ) WHERE id = ?`,
    [cityId, cityId]
  );
}

async function recalcTagBusinessCount(tagId) {
  if (!tagId) return;
  await strapi.db.connection.raw(
    `UPDATE tags SET business_count = (
       SELECT COUNT(*) FROM businesses_tags_lnk WHERE tag_id = ?
     ) WHERE id = ?`,
    [tagId, tagId]
  );
}

/**
 * Recalcula ratingAverage, ratingCount y reviewCount de un negocio
 * en base a sus reviews publicadas (reviewStatus='published').
 */
async function recalcBusinessRating(businessId) {
  if (!businessId) return;
  const [{ rows }] = await Promise.all([
    strapi.db.connection.raw(
      `SELECT
         COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg,
         COUNT(r.id) AS cnt
       FROM reviews r
       JOIN reviews_business_lnk rbl ON rbl.review_id = r.id
       WHERE rbl.business_id = ? AND r.review_status = 'published'`,
      [businessId]
    ),
  ]);
  const row = rows[0] || { avg: 0, cnt: 0 };
  const avg = Number(row.avg) || 0;
  const cnt = Number(row.cnt) || 0;
  await strapi.db.connection.raw(
    `UPDATE businesses
     SET rating_average = ?, rating_count = ?, review_count = ?
     WHERE id = ?`,
    [avg, cnt, cnt, businessId]
  );
}

/**
 * Devuelve los IDs de category/city/tags actualmente ligados a un business.
 * Útil para recomputar cuentas tras un cambio.
 */
async function getBusinessLinks(businessId) {
  if (!businessId) return { categoryId: null, cityId: null, tagIds: [] };
  const [{ rows: catRows }, { rows: cityRows }, { rows: tagRows }] = await Promise.all([
    strapi.db.connection.raw(
      `SELECT category_id FROM businesses_category_lnk WHERE business_id = ? LIMIT 1`,
      [businessId]
    ),
    strapi.db.connection.raw(
      `SELECT city_id FROM businesses_city_lnk WHERE business_id = ? LIMIT 1`,
      [businessId]
    ),
    strapi.db.connection.raw(
      `SELECT tag_id FROM businesses_tags_lnk WHERE business_id = ?`,
      [businessId]
    ),
  ]);
  return {
    categoryId: catRows[0]?.category_id ?? null,
    cityId: cityRows[0]?.city_id ?? null,
    tagIds: tagRows.map(r => r.tag_id),
  };
}

module.exports = {
  runAfterCommit,
  recalcCategoryBusinessCount,
  recalcCityBusinessCount,
  recalcTagBusinessCount,
  recalcBusinessRating,
  getBusinessLinks,
};
