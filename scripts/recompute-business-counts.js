'use strict';

/**
 * Recomputa el campo denormalizado `businessCount` en todas las categorías.
 *
 * Necesario después de un import masivo (seed-businesses.js), porque el
 * lifecycle hook que mantiene el contador no siempre se dispara en batch.
 *
 * Uso desde backend/:
 *   node scripts/recompute-business-counts.js
 *
 * Es idempotente y seguro: `businessCount` es un cache, siempre se puede
 * regenerar desde el join con businesses.
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

async function run() {
  const app = await createStrapi(await compileStrapi()).load();
  const knex = app.db.connection;

  const result = await knex.raw(`
    UPDATE categories c
    SET business_count = sub.n
    FROM (
      SELECT c.id, COUNT(lnk.business_id) AS n
      FROM categories c
      LEFT JOIN businesses_category_lnk lnk ON lnk.category_id = c.id
      GROUP BY c.id
    ) sub
    WHERE c.id = sub.id AND c.business_count IS DISTINCT FROM sub.n;
  `);

  console.log(`✅ Categorías resincronizadas: ${result.rowCount ?? 'ok'}`);

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
