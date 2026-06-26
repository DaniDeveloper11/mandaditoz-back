'use strict';

/**
 * Importación de negocios desde negocios_etzatlan.json
 *
 * Uso desde backend/:
 *   node scripts/seed-businesses.js
 *
 * Es idempotente: si un negocio con el mismo slug ya existe, no se duplica
 * (pero sí se crean sus horarios si no estaban).
 *
 * Notas:
 * - Los logos del JSON son URLs externas; no se importan en esta pasada.
 *   Se puede correr un segundo script después que los descargue y suba vía
 *   el upload service de Strapi.
 * - La dirección entera se mete en address.street; defaults Etzatlán/Jalisco/46500.
 */

const fs = require('fs');
const path = require('path');
const { createStrapi, compileStrapi } = require('@strapi/strapi');

const SOURCE_JSON = path.resolve(__dirname, '../../negocios_etzatlan.json');

// Mapeo: categoría legacy del JSON → slug de la nueva taxonomía
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

const DAY_MAP = {
  lunes:     'mon',
  martes:    'tue',
  miercoles: 'wed',
  jueves:    'thu',
  viernes:   'fri',
  sabado:    'sat',
  domingo:   'sun',
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

function buildAddress(direccion) {
  const t = (direccion || '').trim();
  if (!t || /^no aplica/i.test(t)) return null;
  return {
    street: t.slice(0, 200),
    exteriorNumber: 'S/N',
    city: 'Etzatlán',
    state: 'Jalisco',
    zip: '46500',
  };
}

function toTime(num) {
  if (num >= 24) return '23:59:00.000';
  const h = Math.floor(num);
  const m = Math.round((num - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000`;
}

function buildHourRecord(dayOfWeek, raw) {
  if (!raw) return { dayOfWeek, isClosed: true };
  const { apertura, cierre } = raw;
  if (apertura == null || cierre == null) return { dayOfWeek, isClosed: true };
  if (apertura === 0 && cierre === 24) return { dayOfWeek, is24Hours: true };
  if (apertura === 0 && cierre === 0) return { dayOfWeek, isClosed: true };
  return {
    dayOfWeek,
    openTime: toTime(apertura),
    closeTime: toTime(cierre),
  };
}

function cleanPhone(p) {
  if (!p) return null;
  const t = String(p).trim();
  return t || null;
}

async function findUniqueSlug(strapi, baseSlug) {
  let slug = baseSlug;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await strapi.documents('api::business.business').findFirst({
      filters: { slug },
    });
    if (!existing) return { slug, exists: false };
    if (n === 1) {
      // First collision: maybe it's the same business being re-imported
      return { slug, exists: true, existingDoc: existing };
    }
    slug = `${baseSlug}-${n}`;
    n++;
    if (n > 50) throw new Error(`No se pudo generar slug único para ${baseSlug}`);
  }
}

async function importBusiness(strapi, raw, categoryDocIdBySlug, stats) {
  const name = (raw.nombre || '').trim();
  if (!name) {
    stats.skippedNoName++;
    return;
  }

  const legacyCat = (raw.categoria || '').trim();
  const targetSlug = CATEGORY_MAP[legacyCat];
  if (!targetSlug) {
    console.warn(`  ⚠ categoría desconocida '${legacyCat}' en '${name}' — se omite`);
    stats.skippedNoCategory++;
    return;
  }
  const categoryDocId = categoryDocIdBySlug[targetSlug];
  if (!categoryDocId) {
    console.warn(`  ⚠ categoría '${targetSlug}' no existe en BD — se omite '${name}'`);
    stats.skippedNoCategory++;
    return;
  }

  const baseSlug = slugify(name);

  // Si existe por slug, lo consideramos idempotente y saltamos
  const { slug, exists } = await findUniqueSlug(strapi, baseSlug);
  if (exists) {
    stats.skippedExists++;
    return;
  }

  const phones = (raw.telefonos || []).map(cleanPhone).filter(Boolean);
  const tags = (raw.servicios || []).filter(Boolean);
  const address = buildAddress(raw.direccion);

  const data = {
    name,
    slug,
    category: categoryDocId,
    tags,
    phone: phones[0] || null,
    whatsapp: phones[1] || null,
    address,
    status: 'published',
    ownershipStatus: 'unclaimed',
    createdByAdmin: true,
  };

  const business = await strapi
    .documents('api::business.business')
    .create({ data, status: 'published' });

  // Horarios
  const horarios = raw.horarios || {};
  let createdHours = 0;
  for (const [dayEs, dayEn] of Object.entries(DAY_MAP)) {
    const rec = buildHourRecord(dayEn, horarios[dayEs]);
    await strapi.documents('api::business-hour.business-hour').create({
      data: { ...rec, business: business.documentId },
    });
    createdHours++;
  }

  stats.created++;
  stats.hoursCreated += createdHours;
  console.log(`  ✚ ${slug}  (${phones.length} tel, ${createdHours}h)`);
}

async function run() {
  if (!fs.existsSync(SOURCE_JSON)) {
    throw new Error(`No se encontró ${SOURCE_JSON}`);
  }
  const raws = JSON.parse(fs.readFileSync(SOURCE_JSON, 'utf8'));
  console.log(`\n→ Cargando ${raws.length} negocios desde ${SOURCE_JSON}`);

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  // Pre-cargar categorías para mapear slug → documentId
  const cats = await app.documents('api::category.category').findMany({
    fields: ['slug', 'documentId'],
    pagination: { pageSize: 200 },
  });
  const categoryDocIdBySlug = Object.fromEntries(cats.map((c) => [c.slug, c.documentId]));
  console.log(`  → ${cats.length} categorías cargadas para mapeo`);

  const stats = {
    created: 0,
    hoursCreated: 0,
    skippedExists: 0,
    skippedNoName: 0,
    skippedNoCategory: 0,
    failed: 0,
  };

  console.log('\n→ Importando negocios...');
  for (const raw of raws) {
    try {
      await importBusiness(app, raw, categoryDocIdBySlug, stats);
    } catch (e) {
      stats.failed++;
      console.error(`  ✗ Error con '${raw.nombre}':`, e.message);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`  Creados:                  ${stats.created}`);
  console.log(`  Horarios creados:         ${stats.hoursCreated}`);
  console.log(`  Saltados (ya existían):   ${stats.skippedExists}`);
  console.log(`  Saltados (sin nombre):    ${stats.skippedNoName}`);
  console.log(`  Saltados (sin categoría): ${stats.skippedNoCategory}`);
  console.log(`  Errores:                  ${stats.failed}`);
  console.log('');

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal en la importación:', err);
  process.exit(1);
});
