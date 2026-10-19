'use strict';

/**
 * Recalcula `ownershipStatus` de todos los negocios con la misma regla que
 * claim/lifecycles.js (sincronizarPropiedad):
 *   - tiene owner             -> claimed
 *   - algún reclamo `pending` -> pending_claim
 *   - nada de lo anterior     -> unclaimed
 *
 * Sirve para destrabar negocios que quedaron mal antes de que el estado se
 * derivara (un reclamo `cancelled`, un rechazo con otro pendiente, un reclamo
 * sobre un negocio que ya tenía dueño). Un negocio atorado en `pending_claim`
 * además deja inservible su enlace de invitación.
 *
 * Uso desde backend/:
 *   node scripts/sync-ownership-status.js           # solo reporta
 *   node scripts/sync-ownership-status.js --apply   # además corrige
 *
 * ⚠️ Arrancar Strapi sincroniza el esquema de src/ contra la BD a la que
 * apunta: contra staging o prod, correrlo SOLO desde el commit desplegado.
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

const APPLY = process.argv.includes('--apply');

async function run() {
  const app = await createStrapi(await compileStrapi()).load();
  const knex = app.db.connection;

  const { rows } = await knex.raw(`
    SELECT b.document_id, b.name, b.ownership_status AS actual,
           CASE
             WHEN o.user_id IS NOT NULL THEN 'claimed'
             WHEN EXISTS (
               SELECT 1 FROM claims_business_lnk cl
                 JOIN claims c ON c.id = cl.claim_id
                WHERE cl.business_id = b.id AND c.claim_status = 'pending'
             ) THEN 'pending_claim'
             ELSE 'unclaimed'
           END AS esperado
      FROM businesses b
      LEFT JOIN businesses_owner_lnk o ON o.business_id = b.id
  `);

  const malos = rows.filter((r) => r.actual !== r.esperado);
  console.log(`${rows.length} negocios revisados, ${malos.length} con ownershipStatus incorrecto.`);
  for (const r of malos) {
    console.log(`  ${r.actual.padEnd(13)} -> ${r.esperado.padEnd(13)} ${r.name}`);
  }

  if (APPLY) {
    for (const r of malos) {
      await app.documents('api::business.business').update({
        documentId: r.document_id,
        data: { ownershipStatus: r.esperado },
      });
    }
    console.log(malos.length ? `Corregidos ${malos.length}.` : 'Nada que corregir.');
  } else if (malos.length) {
    console.log('\nSin cambios. Correr con --apply para corregirlos.');
  }

  // El lifecycle de business agenda recálculos de contadores con setImmediate
  // después de cada update; cerrar la conexión antes los hacía tronar.
  if (APPLY && malos.length) await new Promise((r) => setTimeout(r, 2000));
  await app.destroy();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
