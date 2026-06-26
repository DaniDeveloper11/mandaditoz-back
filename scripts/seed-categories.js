'use strict';

/**
 * Seed de categorías del directorio.
 * Uso desde la carpeta backend/:
 *   node scripts/seed-categories.js
 *
 * Es idempotente: si una categoría con el mismo slug ya existe, no la duplica.
 */

const { createStrapi, compileStrapi } = require('@strapi/strapi');

const PARENTS = [
  { name: 'Comida y bebidas',       slug: 'comida-y-bebidas',       icon: 'utensils',        color: '#F59E0B', order: 1 },
  { name: 'Vida nocturna',          slug: 'vida-nocturna',          icon: 'beer',            color: '#7C3AED', order: 2 },
  { name: 'Hospedaje',              slug: 'hospedaje',              icon: 'hotel',           color: '#0EA5E9', order: 3 },
  { name: 'Automotriz y transporte',slug: 'automotriz-y-transporte',icon: 'car',             color: '#EF4444', order: 4 },
  { name: 'Hogar y construcción',   slug: 'hogar-y-construccion',   icon: 'hammer',          color: '#A16207', order: 5 },
  { name: 'Salud y bienestar',      slug: 'salud-y-bienestar',      icon: 'heart-pulse',     color: '#EC4899', order: 6 },
  { name: 'Servicios profesionales',slug: 'servicios-profesionales',icon: 'briefcase',       color: '#1E40AF', order: 7 },
  { name: 'Eventos y fiestas',      slug: 'eventos-y-fiestas',      icon: 'party-popper',    color: '#D946EF', order: 8 },
  { name: 'Recreación y turismo',   slug: 'recreacion-y-turismo',   icon: 'palm-tree',       color: '#10B981', order: 9 },
  { name: 'Educación',              slug: 'educacion',              icon: 'graduation-cap',  color: '#6366F1', order: 10 },
  { name: 'Servicios básicos',      slug: 'servicios-basicos',      icon: 'alert-triangle',  color: '#DC2626', order: 11 },
];

const CHILDREN = [
  // Comida y bebidas
  { parentSlug: 'comida-y-bebidas', name: 'Restaurantes',        slug: 'restaurantes',        icon: 'utensils',     order: 1 },
  { parentSlug: 'comida-y-bebidas', name: 'Mariscos',            slug: 'mariscos',            icon: 'fish',         order: 2 },
  { parentSlug: 'comida-y-bebidas', name: 'Tacos',               slug: 'tacos',               icon: 'sandwich',     order: 3 },
  { parentSlug: 'comida-y-bebidas', name: 'Carnes y asados',     slug: 'carnes-y-asados',     icon: 'beef',         order: 4 },
  { parentSlug: 'comida-y-bebidas', name: 'Pizza',               slug: 'pizza',               icon: 'pizza',        order: 5 },
  { parentSlug: 'comida-y-bebidas', name: 'Pollo y rosticerías', slug: 'pollo-y-rosticerias', icon: 'drumstick',    order: 6 },
  { parentSlug: 'comida-y-bebidas', name: 'Alitas',              slug: 'alitas',              icon: 'flame',        order: 7 },
  { parentSlug: 'comida-y-bebidas', name: 'Lonches y tortas',    slug: 'lonches-y-tortas',    icon: 'sandwich',     order: 8 },
  { parentSlug: 'comida-y-bebidas', name: 'Cafeterías',          slug: 'cafeterias',          icon: 'coffee',       order: 9 },
  { parentSlug: 'comida-y-bebidas', name: 'Botanas',             slug: 'botanas',             icon: 'popcorn',      order: 10 },
  { parentSlug: 'comida-y-bebidas', name: 'Ensaladas',           slug: 'ensaladas',           icon: 'salad',        order: 11 },
  { parentSlug: 'comida-y-bebidas', name: 'Birria',              slug: 'birria',              icon: 'soup',         order: 12 },
  { parentSlug: 'comida-y-bebidas', name: 'Comida en general',   slug: 'comida-en-general',   icon: 'utensils-crossed', order: 13 },

  // Vida nocturna
  { parentSlug: 'vida-nocturna', name: 'Bares',     slug: 'bares',     icon: 'beer',    order: 1 },
  { parentSlug: 'vida-nocturna', name: 'Depósitos', slug: 'depositos', icon: 'wine',    order: 2 },
  { parentSlug: 'vida-nocturna', name: 'Música',    slug: 'musica',    icon: 'music',   order: 3 },

  // Hospedaje
  { parentSlug: 'hospedaje', name: 'Hoteles',  slug: 'hoteles',  icon: 'hotel',  order: 1 },
  { parentSlug: 'hospedaje', name: 'Cabañas',  slug: 'cabanas',  icon: 'tent',   order: 2 },

  // Automotriz y transporte
  { parentSlug: 'automotriz-y-transporte', name: 'Taxis',          slug: 'taxis',          icon: 'taxi',       order: 1 },
  { parentSlug: 'automotriz-y-transporte', name: 'Moto-servicio',  slug: 'moto-servicio',  icon: 'bike',       order: 2 },
  { parentSlug: 'automotriz-y-transporte', name: 'Mecánicos',      slug: 'mecanicos',      icon: 'wrench',     order: 3 },
  { parentSlug: 'automotriz-y-transporte', name: 'Transporte',     slug: 'transporte',     icon: 'truck',      order: 4 },

  // Hogar y construcción
  { parentSlug: 'hogar-y-construccion', name: 'Ferreterías',  slug: 'ferreterias',  icon: 'hammer',  order: 1 },
  { parentSlug: 'hogar-y-construccion', name: 'Carpintería',  slug: 'carpinteria',  icon: 'axe',     order: 2 },
  { parentSlug: 'hogar-y-construccion', name: 'Tapicería',    slug: 'tapiceria',    icon: 'sofa',    order: 3 },

  // Salud y bienestar
  { parentSlug: 'salud-y-bienestar', name: 'Belleza y estética', slug: 'belleza-y-estetica', icon: 'scissors', order: 1 },
  { parentSlug: 'salud-y-bienestar', name: 'Veterinarias',       slug: 'veterinarias',       icon: 'paw-print',order: 2 },

  // Servicios profesionales
  { parentSlug: 'servicios-profesionales', name: 'Servicios legales', slug: 'servicios-legales', icon: 'scale',  order: 1 },
  { parentSlug: 'servicios-profesionales', name: 'Diseño',            slug: 'diseno',            icon: 'palette',order: 2 },
  { parentSlug: 'servicios-profesionales', name: 'Internet',          slug: 'internet',          icon: 'wifi',   order: 3 },

  // Eventos y fiestas
  { parentSlug: 'eventos-y-fiestas', name: 'Organización de fiestas', slug: 'organizacion-de-fiestas', icon: 'party-popper', order: 1 },
  { parentSlug: 'eventos-y-fiestas', name: 'Artesanías',              slug: 'artesanias',              icon: 'palette',       order: 2 },
  { parentSlug: 'eventos-y-fiestas', name: 'Joyería',                 slug: 'joyeria',                 icon: 'gem',           order: 3 },

  // Recreación y turismo
  { parentSlug: 'recreacion-y-turismo', name: 'Balnearios', slug: 'balnearios', icon: 'waves', order: 1 },

  // Educación
  { parentSlug: 'educacion', name: 'Preescolar', slug: 'preescolar', icon: 'baby', order: 1 },

  // Servicios básicos
  { parentSlug: 'servicios-basicos', name: 'Agua',         slug: 'agua',         icon: 'droplet',         order: 1 },
  { parentSlug: 'servicios-basicos', name: 'Emergencias',  slug: 'emergencias',  icon: 'alert-triangle',  order: 2 },
];

async function upsertCategory(strapi, data) {
  const existing = await strapi.documents('api::category.category').findFirst({
    filters: { slug: data.slug },
  });

  if (existing) {
    console.log(`  ↻ ya existe: ${data.slug}`);
    return existing;
  }

  const created = await strapi.documents('api::category.category').create({ data });
  console.log(`  ✚ creada:    ${data.slug}`);
  return created;
}

async function run() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  console.log('\n→ Creando categorías padre...');
  const parentByslug = {};
  for (const p of PARENTS) {
    const doc = await upsertCategory(app, {
      name: p.name,
      slug: p.slug,
      icon: p.icon,
      color: p.color,
      order: p.order,
      isActive: true,
    });
    parentByslug[p.slug] = doc;
  }

  console.log('\n→ Creando subcategorías...');
  let createdChildren = 0;
  for (const c of CHILDREN) {
    const parent = parentByslug[c.parentSlug];
    if (!parent) {
      console.warn(`  ⚠ no se encontró el padre ${c.parentSlug} para ${c.slug}`);
      continue;
    }
    await upsertCategory(app, {
      name: c.name,
      slug: c.slug,
      icon: c.icon,
      order: c.order,
      isActive: true,
      parent: parent.documentId,
    });
    createdChildren++;
  }

  console.log(`\n✅ Seed completado: ${PARENTS.length} padres + ${createdChildren} subcategorías procesadas.\n`);
  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error en el seed:', err);
  process.exit(1);
});
