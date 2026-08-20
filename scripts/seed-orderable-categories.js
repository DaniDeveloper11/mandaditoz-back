'use strict';

/**
 * Marca `isOrderable: true` en las categorías de comida y bebida.
 *
 * Uso desde backend/:
 *   node scripts/seed-orderable-categories.js
 *
 * Es idempotente: solo escribe las que están en false.
 *
 * Ojo: el árbol vivo NO es el que describe seed-categories.js, y local y
 * producción tampoco coinciden entre sí. En la base real la raíz es `comida`
 * (no `comida-y-bebidas`), `bar` cuelga de `entretenimiento` en prod pero es
 * raíz en local, `deposito` cuelga de `servicios`, y varias categorías de
 * comida quedaron PLANAS en depth 0 (alas, carnitas, hamburguesas, panaderías,
 * restaurante, sushi, tamales, tortillerías) — su `path` es su propio slug.
 *
 * Por eso hay dos mecanismos: un barrido por subárbol para las raíces, y una
 * lista curada de slugs sueltos que incluye los nombres alternativos de ambas
 * taxonomías. Las que no existan se avisan al final, no revientan el script.
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

// Raíces cuyo subárbol completo es "pedible".
// Se listan las variantes de ambas taxonomías; las inexistentes se avisan.
const ORDERABLE_ROOTS = ['comida', 'comida-y-bebidas', 'vida-nocturna'];

// Categorías de comida y bebida que viven fuera de esas raíces.
const ORDERABLE_SLUGS = [
  // planas de depth 0
  'alas',
  'carnitas',
  'hamburguesas',
  'panaderias',
  'restaurante',
  'sushi',
  'tamales',
  'tortillerias',
  // bebidas: `bar` cuelga de entretenimiento en prod, `deposito` de servicios
  'bar',
  'deposito',
  // variantes en plural de la taxonomía de seed-categories.js
  'restaurantes',
  'bares',
  'depositos',
  'cafeterias',
];

async function run() {
  const app = await createStrapi(await compileStrapi()).load();

  const all = await app.db.query('api::category.category').findMany({
    select: ['id', 'name', 'slug', 'path', 'depth', 'isOrderable'],
    limit: 1000,
  });

  const targets = all.filter((c) => {
    if (ORDERABLE_SLUGS.includes(c.slug)) return true;
    return ORDERABLE_ROOTS.some(
      (root) => c.slug === root || (c.path && c.path.startsWith(`${root}/`))
    );
  });

  console.log(`\n→ ${targets.length} categorías identificadas como pedibles.\n`);

  let updated = 0;
  let already = 0;

  for (const cat of targets) {
    if (cat.isOrderable === true) {
      console.log(`  ↻ ya marcada: ${cat.slug}`);
      already++;
      continue;
    }
    await app.db.query('api::category.category').update({
      where: { id: cat.id },
      data: { isOrderable: true },
    });
    console.log(`  ✚ marcada:    ${cat.slug}`);
    updated++;
  }

  // Aviso: raíces esperadas que no existen en la base.
  for (const root of ORDERABLE_ROOTS) {
    if (!all.some((c) => c.slug === root)) {
      console.warn(`  ⚠ raíz no encontrada: ${root}`);
    }
  }
  for (const slug of ORDERABLE_SLUGS) {
    if (!all.some((c) => c.slug === slug)) {
      console.warn(`  ⚠ categoría no encontrada: ${slug}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`  Marcadas ahora: ${updated}`);
  console.log(`  Ya estaban:     ${already}`);
  console.log(`  Total pedibles: ${targets.length}`);
  console.log('');

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
