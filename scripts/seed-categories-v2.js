'use strict';

/**
 * Agrega las 15 categorías nuevas requeridas por el dataset v2
 * (negocios_etzatlan_v2.json — 426 negocios scrapeados en 2026-07).
 *
 * Uso desde backend/:
 *   node scripts/seed-categories-v2.js
 *
 * Es idempotente: si el slug ya existe, no la duplica.
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

const NEW_CATEGORIES = [
  { name: 'Educación',    slug: 'educacion',    icon: 'graduation-cap', color: '#6366F1', order: 100 },
  { name: 'Dentistas',    slug: 'dentistas',    icon: 'tooth',          color: '#38BDF8', order: 101 },
  { name: 'Panaderías',   slug: 'panaderias',   icon: 'croissant',      color: '#D97706', order: 102 },
  { name: 'Hamburguesas', slug: 'hamburguesas', icon: 'sandwich',       color: '#EA580C', order: 103 },
  { name: 'Autolavados',  slug: 'autolavados',  icon: 'droplets',       color: '#0EA5E9', order: 104 },
  { name: 'Carnitas',     slug: 'carnitas',     icon: 'beef',           color: '#B91C1C', order: 105 },
  { name: 'Electrónica',  slug: 'electronica',  icon: 'cpu',            color: '#4F46E5', order: 106 },
  { name: 'Florerías',    slug: 'florerias',    icon: 'flower',         color: '#DB2777', order: 107 },
  { name: 'Tortillerías', slug: 'tortillerias', icon: 'wheat',          color: '#CA8A04', order: 108 },
  { name: 'Sushi',        slug: 'sushi',        icon: 'fish',           color: '#059669', order: 109 },
  { name: 'Oficios',      slug: 'oficios',      icon: 'wrench',         color: '#525252', order: 110 },
  { name: 'Tamales',      slug: 'tamales',      icon: 'utensils',       color: '#A16207', order: 111 },
  { name: 'Ropa y moda',  slug: 'ropa-y-moda',  icon: 'shirt',          color: '#9333EA', order: 112 },
  { name: 'Papelerías',   slug: 'papelerias',   icon: 'book-open',      color: '#0284C7', order: 113 },
  { name: 'Celulares',    slug: 'celulares',    icon: 'smartphone',     color: '#2563EB', order: 114 },
];

async function run() {
  const app = await createStrapi(await compileStrapi()).load();

  console.log(`\n→ Insertando ${NEW_CATEGORIES.length} categorías nuevas...`);
  let created = 0;
  let skipped = 0;

  for (const cat of NEW_CATEGORIES) {
    const existing = await app.documents('api::category.category').findFirst({
      filters: { slug: cat.slug },
    });
    if (existing) {
      console.log(`  ↻ ya existe: ${cat.slug}`);
      skipped++;
      continue;
    }
    await app.documents('api::category.category').create({
      data: { ...cat, isActive: true, depth: 0 },
    });
    console.log(`  ✚ creada:    ${cat.slug}`);
    created++;
  }

  console.log('\n=== Resumen ===');
  console.log(`  Creadas: ${created}`);
  console.log(`  Ya existían: ${skipped}`);
  console.log('');

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
