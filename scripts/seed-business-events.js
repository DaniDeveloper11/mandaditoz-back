'use strict';

/**
 * Siembra eventos históricos de tráfico (business-event) para simular actividad.
 * Genera, por cada negocio publicado, en los últimos 30 días:
 *   - profile_view:   50–300
 *   - phone_click:    5–40
 *   - whatsapp_click: 3–20
 *
 * Uso desde backend/:
 *   node scripts/seed-business-events.js
 *
 * Flags:
 *   --wipe                 Borra todos los business_events antes de sembrar
 *   --only=<documentId>    Siembra solo para ese negocio
 *
 * Notas:
 * - Usa strapi.documents().create() para que Strapi 5 maneje document_id,
 *   published_at y la tabla de link de la relación business automáticamente.
 * - Después parchea occurredAt/createdAt directo en DB para distribuir los
 *   eventos en los últimos 30 días (create() los pondría todos con "ahora").
 */

const path = require('path');

const RANGES = {
  profile_view:   [50, 300],
  phone_click:    [5, 40],
  whatsapp_click: [3, 20],
};
const DAYS_BACK = 30;

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomTimestampWithin(days) {
  const now = Date.now();
  const offset = Math.floor(Math.random() * days * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
}

function fakeSessionId() {
  return `seed_${Math.random().toString(36).slice(2, 12)}`;
}

async function run() {
  const args = process.argv.slice(2);
  const wipe = args.includes('--wipe');
  const onlyArg = args.find(a => a.startsWith('--only='));
  const onlyDocId = onlyArg ? onlyArg.split('=')[1] : null;

  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi({
    appDir: path.resolve(__dirname, '..'),
    distDir: path.resolve(__dirname, '..', 'dist'),
  });
  const strapi = await createStrapi(appContext).load();

  const knex = strapi.db.connection;

  if (wipe) {
    await knex('business_events_business_lnk').del().catch(() => {});
    const deleted = await knex('business_events').del();
    console.log(`🧹 Borrados ${deleted} eventos previos`);
  }

  const filters = { businessStatus: 'published' };
  if (onlyDocId) filters.documentId = onlyDocId;

  const businesses = await strapi.documents('api::business.business').findMany({
    filters,
    fields: ['id', 'documentId', 'name'],
    pagination: { pageSize: 1000 },
  });

  if (!businesses.length) {
    console.log('⚠️  No hay negocios publicados para sembrar');
    await strapi.destroy();
    process.exit(0);
  }

  console.log(`📊 Sembrando eventos para ${businesses.length} negocio(s)...`);
  let totalInserted = 0;

  for (const biz of businesses) {
    const batch = [];
    for (const [type, [min, max]] of Object.entries(RANGES)) {
      const n = randInt(min, max);
      for (let i = 0; i < n; i++) {
        batch.push({ type, when: randomTimestampWithin(DAYS_BACK) });
      }
    }

    // Crear los eventos vía documents().create() para que Strapi maneje
    // document_id, published_at y el link a business.
    const CONCURRENCY = 20;
    const createdDocIds = [];
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      const results = await Promise.all(slice.map(item =>
        strapi.documents('api::business-event.business-event').create({
          data: {
            business: biz.documentId,
            type: item.type,
            sessionId: fakeSessionId(),
            occurredAt: item.when,
          },
        })
      ));
      for (let j = 0; j < results.length; j++) {
        createdDocIds.push({ documentId: results[j].documentId, when: slice[j].when });
      }
    }

    // Parcha createdAt/updatedAt para que también reflejen la fecha simulada,
    // por si algún consumidor filtra por createdAt en lugar de occurredAt.
    for (const { documentId, when } of createdDocIds) {
      await knex('business_events')
        .where({ document_id: documentId })
        .update({ created_at: when, updated_at: when });
    }

    totalInserted += batch.length;
    console.log(`  ✓ ${biz.name}: ${batch.length} eventos`);
  }

  console.log(`\n✅ Total insertado: ${totalInserted} eventos`);
  console.log(`   Rango: últimos ${DAYS_BACK} días`);

  await strapi.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
