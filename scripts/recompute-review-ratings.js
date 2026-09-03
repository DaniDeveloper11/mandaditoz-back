'use strict';

/**
 * Recomputa ratingAverage / ratingCount / reviewCount de TODOS los negocios
 * a partir de sus reseñas con reviewStatus='published'.
 *
 * Necesario como backfill: hasta ahora el recalc de los lifecycles podía
 * correr antes del COMMIT de la transacción del document service y guardar el
 * conteo previo al cambio (publicar una reseña desde el admin dejaba el
 * negocio en 0 reseñas). El fix vive en src/utils/denorm.js (runAfterCommit);
 * este script arregla las filas que quedaron mal.
 *
 * Uso desde backend/:
 *   node scripts/recompute-review-ratings.js
 *
 * Es idempotente y seguro: los tres campos son cache, siempre se regeneran
 * desde reviews + reviews_business_lnk.
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

async function run() {
  const app = await createStrapi(await compileStrapi()).load();
  const knex = app.db.connection;

  const { rows: before } = await knex.raw(`
    SELECT b.id, b.name, b.rating_average, b.rating_count, sub.avg, sub.cnt
    FROM businesses b
    JOIN (
      SELECT bb.id,
             COALESCE(AVG(r.rating) FILTER (WHERE r.review_status = 'published'), 0)::numeric(10,2) AS avg,
             COUNT(r.id) FILTER (WHERE r.review_status = 'published') AS cnt
      FROM businesses bb
      LEFT JOIN reviews_business_lnk rbl ON rbl.business_id = bb.id
      LEFT JOIN reviews r ON r.id = rbl.review_id
      GROUP BY bb.id
    ) sub ON sub.id = b.id
    WHERE b.rating_count IS DISTINCT FROM sub.cnt
       OR b.review_count IS DISTINCT FROM sub.cnt
       OR b.rating_average IS DISTINCT FROM sub.avg
  `);

  for (const r of before) {
    console.log(
      `  #${r.id} ${r.name}: ${r.rating_average}/${r.rating_count} → ${r.avg}/${r.cnt}`
    );
  }

  const result = await knex.raw(`
    UPDATE businesses b
    SET rating_average = sub.avg,
        rating_count   = sub.cnt,
        review_count   = sub.cnt
    FROM (
      SELECT bb.id,
             COALESCE(AVG(r.rating) FILTER (WHERE r.review_status = 'published'), 0)::numeric(10,2) AS avg,
             COUNT(r.id) FILTER (WHERE r.review_status = 'published') AS cnt
      FROM businesses bb
      LEFT JOIN reviews_business_lnk rbl ON rbl.business_id = bb.id
      LEFT JOIN reviews r ON r.id = rbl.review_id
      GROUP BY bb.id
    ) sub
    WHERE b.id = sub.id
      AND (b.rating_average IS DISTINCT FROM sub.avg
        OR b.rating_count   IS DISTINCT FROM sub.cnt
        OR b.review_count   IS DISTINCT FROM sub.cnt)
  `);

  console.log(`✅ Negocios resincronizados: ${result.rowCount ?? before.length}`);

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
