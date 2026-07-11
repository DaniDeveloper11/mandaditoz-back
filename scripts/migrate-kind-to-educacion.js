'use strict';

/**
 * Migra los negocios existentes de la categoría `kind` (preescolares)
 * a la categoría unificada `educacion`.
 *
 * Prerequisito: haber corrido `node scripts/seed-categories-v2.js` antes
 * (para que exista la categoría `educacion`).
 *
 * Uso desde backend/:
 *   node scripts/migrate-kind-to-educacion.js
 *
 * Es idempotente: si no hay negocios en `kind`, no hace nada.
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

async function run() {
  const app = await createStrapi(await compileStrapi()).load();

  const educacion = await app.documents('api::category.category').findFirst({
    filters: { slug: 'educacion' },
  });
  if (!educacion) {
    console.error('❌ No existe la categoría "educacion" — corre seed-categories-v2.js primero');
    await app.destroy();
    process.exit(1);
  }

  const kind = await app.documents('api::category.category').findFirst({
    filters: { slug: 'kind' },
  });
  if (!kind) {
    console.log('✔ No existe la categoría "kind" — nada que migrar');
    await app.destroy();
    process.exit(0);
  }

  const businesses = await app.documents('api::business.business').findMany({
    filters: { category: { slug: 'kind' } },
    fields: ['documentId', 'slug', 'name'],
    pagination: { pageSize: 500 },
  });
  console.log(`→ Encontrados ${businesses.length} negocios en categoría "kind"`);

  for (const b of businesses) {
    await app.documents('api::business.business').update({
      documentId: b.documentId,
      data: { category: educacion.documentId },
    });
    console.log(`  ↻ ${b.slug} → educacion`);
  }

  console.log(`\n✅ Migrados ${businesses.length} negocios`);
  console.log('⚠ La categoría "kind" quedó vacía pero sigue existiendo.');
  console.log('  Si ya no la quieres, bórrala desde el panel de Strapi.');

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
