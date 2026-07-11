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

const SOURCE_JSON = path.resolve(__dirname, '../../negocios_etzatlan_v2.json');

// Mapeo: categoría del JSON → slug real de la BD.
// Los slugs de la BD son singulares y sin acentos (`restaurante`, no `restaurantes`).
const CATEGORY_MAP = {
  // Existentes en BD
  'mariscos':      'mariscos',
  'tacos':         'tacos',
  'moto-servicio': 'moto-servicio',
  'restaurante':   'restaurante',
  'carne':         'carne',
  'comida':        'comida',
  'taxi':          'taxi',
  'rosticería':    'rosticeria',
  'ferretería':    'ferreteria',
  'alas':          'alas',
  'pizza':         'pizza',
  'música':        'musica',
  'café':          'cafe',
  'cabañas':       'cabanas',
  'emergencia':    'emergencia',
  'fiesta':        'fiesta',
  'lonche':        'lonche',
  'deposito':      'deposito',
  'agua':          'agua',
  'bar':           'bar',
  'internet':      'internet',
  'mecanico':      'mecanico',
  'botanas':       'botanas',
  'artesanías':    'artesanias',
  'diseño':        'diseno',
  'hotel':         'hotel',
  'belleza':       'belleza',
  'legal':         'legal',
  'veterinaria':   'veterinaria',
  'balneario':     'balneario',
  'birria':        'birria',
  'ensalada':      'ensalada',
  'carpintería':   'carpinteria',
  'transporte':    'transporte',
  'pollo':         'pollo',
  'tapíz':         'tapiz',
  'joya':          'joya',
  // Educación unificada (kind + prim + sec)
  'kind':          'educacion',
  'prim':          'educacion',
  'sec':           'educacion',
  // Nuevas categorías del v2
  'dientes':       'dentistas',
  'pan':           'panaderias',
  'ham':           'hamburguesas',
  'wash':          'autolavados',
  'carnitas':      'carnitas',
  'electrónica':   'electronica',
  'flor':          'florerias',
  'tortillas':     'tortillerias',
  'sushi':         'sushi',
  'trab':          'oficios',
  'tamales':       'tamales',
  'moda':          'ropa-y-moda',
  'papel':         'papelerias',
  'cel':           'celulares',
  // Salud existente absorbe cuerpo y nutri
  'cuerpo':        'salud',
  'nutri':         'salud',
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
    postalCode: '46500',
    rawText: t.slice(0, 500),
  };
}

function buildShortDescription(servicios) {
  const parts = (servicios || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const joined = parts.join(' · ');
  return joined.length > 200 ? joined.slice(0, 197) + '…' : joined;
}

function buildDescription(servicios) {
  const parts = (servicios || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const joined = parts.join('\n\n');
  return joined.length > 3000 ? joined.slice(0, 2997) + '…' : joined;
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

// Regex del componente business.phone.number: ^[+]?[0-9\s\-()]{3,20}$
const PHONE_RE = /^[+]?[0-9\s\-()]{3,20}$/;

// Algunos campos del JSON (menu, logo) a veces vienen como objeto {img, link}
// en vez de string. Coacciona a string tomando el primer valor útil.
function coerceUrl(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object') {
    const candidate = v.link || v.url || v.href || v.img || null;
    if (typeof candidate === 'string') return candidate.trim().replace(/^"+|"+$/g, '') || null;
  }
  return null;
}

function cleanPhone(p) {
  if (p == null) return null;
  const t = String(p).trim();
  if (!t) return null;
  if (!PHONE_RE.test(t)) return null;
  return t;
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

async function importBusiness(strapi, raw, categoryDocIdBySlug, cityDocId, stats) {
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
  const address = buildAddress(raw.direccion);
  const shortDescription = buildShortDescription(raw.servicios);
  const description = buildDescription(raw.servicios);
  const hoursText = raw.horariosTexto || raw.horarioTexto || null;

  const data = {
    name,
    slug,
    category: categoryDocId,
    city: cityDocId,
    shortDescription,
    description,
    phones: phones.map((num, i) => ({
      number: num,
      label: 'mobile',
      isPrimary: i === 0,
    })),
    address,
    logoUrl: coerceUrl(raw.logo),
    mapEmbedUrl: coerceUrl(raw.mapa),
    menuUrl: coerceUrl(raw.menu),
    videoUrl: coerceUrl(raw.video),
    hoursText,
    businessStatus: 'published',
    ownershipStatus: 'unclaimed',
    createdByAdmin: true,
  };

  const business = await strapi
    .documents('api::business.business')
    .create({ data });

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

  // Todos los negocios del JSON son de Etzatlán. Cargamos su documentId una vez.
  const etzatlanCity = await app.documents('api::city.city').findFirst({
    filters: { slug: 'etzatlan' },
    fields: ['documentId'],
  });
  if (!etzatlanCity) {
    throw new Error("No existe la ciudad 'etzatlan' — créala primero en el panel");
  }
  const cityDocId = etzatlanCity.documentId;
  console.log(`  → ciudad etzatlan cargada (documentId=${cityDocId})`);

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
      await importBusiness(app, raw, categoryDocIdBySlug, cityDocId, stats);
    } catch (e) {
      stats.failed++;
      const details = e.details ? JSON.stringify(e.details) : '';
      console.error(`  ✗ Error con '${raw.nombre}': ${e.message} ${details}`);
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
