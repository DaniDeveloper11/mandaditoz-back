'use strict';

/**
 * Asigna categorías a negocios existentes en la DB usando negocios_etzatlan.json.
 * Uso desde backend/:
 *   node scripts/assign-categories.js
 *
 * Idempotente: sólo actualiza negocios que no tengan categoría asignada.
 * Usa --force para sobreescribir aunque ya tengan categoría.
 */

const fs = require('fs');
const path = require('path');
const { createStrapi, compileStrapi } = require('@strapi/strapi');

const SOURCE_JSON = path.resolve(__dirname, '../../negocios_etzatlan.json');
const FORCE = process.argv.includes('--force');

const CATEGORY_MAP = {
  'mariscos':      'mariscos',
  'tacos':         'tacos',
  'moto-servicio': 'moto-servicio',
  'restaurante':   'restaurantes',
  'carne':         'carnes-y-asados',
  'comida':        'comida-en-general',
  'taxi':          'taxis',
  'rosticería':    'pollo-y-rosticerias',
  'ferretería':    'ferreterias',
  'alas':          'alitas',
  'pizza':         'pizza',
  'música':        'musica',
  'café':          'cafeterias',
  'cabañas':       'cabanas',
  'emergencia':    'emergencias',
  'fiesta':        'organizacion-de-fiestas',
  'lonche':        'lonches-y-tortas',
  'deposito':      'depositos',
  'kind':          'preescolar',
  'agua':          'agua',
  'bar':           'bares',
  'internet':      'internet',
  'mecanico':      'mecanicos',
  'botanas':       'botanas',
  'artesanías':    'artesanias',
  'diseño':        'diseno',
  'hotel':         'hoteles',
  'belleza':       'belleza-y-estetica',
  'legal':         'servicios-legales',
  'veterinaria':   'veterinarias',
  'balneario':     'balnearios',
  'birria':        'birria',
  'ensalada':      'ensaladas',
  'carpintería':   'carpinteria',
  'transporte':    'transporte',
  'pollo':         'pollo-y-rosticerias',
  'tapíz':         'tapiceria',
  'joya':          'joyeria',
};

function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function run() {
  if (!fs.existsSync(SOURCE_JSON)) {
    throw new Error(`No se encontró ${SOURCE_JSON}`);
  }

  const raws = JSON.parse(fs.readFileSync(SOURCE_JSON, 'utf8'));
  console.log(`\n→ ${raws.length} negocios en el JSON${FORCE ? ' (modo --force)' : ''}`);

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  // Cargar categorías: slug → documentId
  const cats = await app.documents('api::category.category').findMany({
    fields: ['slug', 'documentId'],
    pagination: { pageSize: 200 },
  });
  const catBySlug = Object.fromEntries(cats.map((c) => [c.slug, c.documentId]));
  console.log(`  → ${cats.length} categorías cargadas`);

  const stats = { updated: 0, skippedHasCat: 0, skippedNotFound: 0, skippedNoMap: 0, failed: 0 };

  console.log('\n→ Asignando categorías...\n');

  for (const raw of raws) {
    const name = (raw.nombre || '').trim();
    if (!name) continue;

    const slug = slugify(name);
    const legacyCat = (raw.categoria || '').trim();
    const targetSlug = CATEGORY_MAP[legacyCat];

    if (!targetSlug) {
      console.warn(`  ⚠ sin mapeo: '${legacyCat}' → '${name}'`);
      stats.skippedNoMap++;
      continue;
    }

    const categoryDocId = catBySlug[targetSlug];
    if (!categoryDocId) {
      console.warn(`  ⚠ categoría '${targetSlug}' no existe en DB → '${name}'`);
      stats.skippedNoMap++;
      continue;
    }

    try {
      const business = await app.documents('api::business.business').findFirst({
        filters: { slug },
        populate: ['category'],
      });

      if (!business) {
        console.log(`  - no encontrado en DB: '${slug}'`);
        stats.skippedNotFound++;
        continue;
      }

      if (!FORCE && business.category) {
        stats.skippedHasCat++;
        continue;
      }

      await app.documents('api::business.business').update({
        documentId: business.documentId,
        data: { category: categoryDocId },
      });

      console.log(`  ✔ ${slug}  →  ${targetSlug}`);
      stats.updated++;
    } catch (e) {
      console.error(`  ✗ Error con '${name}':`, e.message);
      stats.failed++;
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`  Actualizados:              ${stats.updated}`);
  console.log(`  Ya tenían categoría:       ${stats.skippedHasCat}`);
  console.log(`  No encontrados en DB:      ${stats.skippedNotFound}`);
  console.log(`  Sin mapeo de categoría:    ${stats.skippedNoMap}`);
  console.log(`  Errores:                   ${stats.failed}`);
  console.log('');

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
