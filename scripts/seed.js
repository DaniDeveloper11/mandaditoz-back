'use strict';

/**
 * Seed Mandaditoz — Etzatlán, Jalisco
 * Uso:
 *   1. Detén el Strapi dev (Ctrl+C en la terminal donde corre npm run develop)
 *   2. Desde /backend ejecuta: node scripts/seed.js
 *   3. Reinicia npm run develop
 *
 * Idempotente: si detecta negocios ya existentes, aborta sin cambios.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.SEED_PORT || '13380';

const SEED_FILE = path.resolve(__dirname, '..', '..', 'negocios_etzatlan.json');

// -----------------------------------------------------------------------------
// Configuración de dominio
// -----------------------------------------------------------------------------

const ETZATLAN_CENTER = { lat: 20.7639, lng: -104.0808 };

const ROOT_CATEGORIES = {
  Comida: { icon: 'utensils', color: '#F97316', order: 1, description: 'Restaurantes, tacos, mariscos y más' },
  Servicios: { icon: 'wrench', color: '#3B82F6', order: 2, description: 'Talleres, transporte, ferreterías' },
  Hospedaje: { icon: 'bed', color: '#10B981', order: 3, description: 'Cabañas y hoteles' },
  Salud: { icon: 'heart-pulse', color: '#EF4444', order: 4, description: 'Belleza y bienestar' },
  Entretenimiento: { icon: 'music', color: '#8B5CF6', order: 5, description: 'Bares, música y eventos' },
  Emergencia: { icon: 'siren', color: '#DC2626', order: 6, description: 'Servicios de urgencia 24/7' },
  Otros: { icon: 'box', color: '#6B7280', order: 99, description: 'Otras categorías' },
};

const CATEGORY_MAPPING = {
  // Comida
  tacos: { parent: 'Comida', icon: 'utensils', color: '#EF4444' },
  mariscos: { parent: 'Comida', icon: 'fish', color: '#0EA5E9' },
  restaurante: { parent: 'Comida', icon: 'utensils-crossed', color: '#F97316' },
  carne: { parent: 'Comida', icon: 'beef', color: '#B91C1C' },
  comida: { parent: 'Comida', icon: 'utensils', color: '#F59E0B' },
  rosticería: { parent: 'Comida', icon: 'drumstick', color: '#EA580C' },
  alas: { parent: 'Comida', icon: 'drumstick', color: '#DC2626' },
  pizza: { parent: 'Comida', icon: 'pizza', color: '#DC2626' },
  café: { parent: 'Comida', icon: 'coffee', color: '#78350F' },
  lonche: { parent: 'Comida', icon: 'sandwich', color: '#F59E0B' },
  birria: { parent: 'Comida', icon: 'utensils', color: '#B91C1C' },
  pollo: { parent: 'Comida', icon: 'drumstick', color: '#F59E0B' },
  botanas: { parent: 'Comida', icon: 'popcorn', color: '#FBBF24' },
  ensalada: { parent: 'Comida', icon: 'salad', color: '#22C55E' },

  // Servicios
  'moto-servicio': { parent: 'Servicios', icon: 'bike', color: '#3B82F6' },
  taxi: { parent: 'Servicios', icon: 'car', color: '#FBBF24' },
  transporte: { parent: 'Servicios', icon: 'truck', color: '#6366F1' },
  ferretería: { parent: 'Servicios', icon: 'wrench', color: '#78716C' },
  mecanico: { parent: 'Servicios', icon: 'wrench', color: '#0F172A' },
  carpintería: { parent: 'Servicios', icon: 'hammer', color: '#78350F' },
  agua: { parent: 'Servicios', icon: 'droplet', color: '#0EA5E9' },
  deposito: { parent: 'Servicios', icon: 'warehouse', color: '#78716C' },
  internet: { parent: 'Servicios', icon: 'wifi', color: '#3B82F6' },
  legal: { parent: 'Servicios', icon: 'scale', color: '#374151' },
  diseño: { parent: 'Servicios', icon: 'paint-bucket', color: '#EC4899' },
  tapíz: { parent: 'Servicios', icon: 'armchair', color: '#7C3AED' },
  veterinaria: { parent: 'Servicios', icon: 'stethoscope', color: '#10B981' },
  artesanías: { parent: 'Servicios', icon: 'palette', color: '#F59E0B' },
  joya: { parent: 'Servicios', icon: 'gem', color: '#F472B6' },

  // Hospedaje
  cabañas: { parent: 'Hospedaje', icon: 'tent', color: '#10B981' },
  hotel: { parent: 'Hospedaje', icon: 'bed', color: '#059669' },

  // Salud
  belleza: { parent: 'Salud', icon: 'sparkles', color: '#EC4899' },

  // Entretenimiento
  música: { parent: 'Entretenimiento', icon: 'music', color: '#8B5CF6' },
  bar: { parent: 'Entretenimiento', icon: 'wine', color: '#7C3AED' },
  fiesta: { parent: 'Entretenimiento', icon: 'party-popper', color: '#D946EF' },
  balneario: { parent: 'Entretenimiento', icon: 'waves', color: '#0EA5E9' },

  // Emergencia
  emergencia: { parent: 'Emergencia', icon: 'siren', color: '#DC2626' },

  // Otros
  kind: { parent: 'Otros', icon: 'graduation-cap', color: '#6366F1' },
};

const DAY_MAP = {
  lunes: 'mon',
  martes: 'tue',
  miercoles: 'wed',
  miércoles: 'wed',
  jueves: 'thu',
  viernes: 'fri',
  sabado: 'sat',
  sábado: 'sat',
  domingo: 'sun',
};

// Solo estos "servicios" del seed se convertirán en tags reales.
// El resto queda en business.amenities (json) como texto libre.
const TAG_WHITELIST = new Map([
  ['Entrega a domicilio', { name: 'Entrega a domicilio', icon: 'bike' }],
  ['Servicio a domicilio', { name: 'Servicio a domicilio', icon: 'bike' }],
  ['Servicio a domicilio.', { name: 'Servicio a domicilio', icon: 'bike' }],
  ['Servicio de entrega a domicilio', { name: 'Entrega a domicilio', icon: 'bike' }],
  ['Servicio de entrega a domicilio.', { name: 'Entrega a domicilio', icon: 'bike' }],
  ['Envío a domicilio.', { name: 'Entrega a domicilio', icon: 'bike' }],
  ['Disponible 24/7', { name: 'Disponible 24/7', icon: 'clock' }],
  ['Disponible 24/7.', { name: 'Disponible 24/7', icon: 'clock' }],
  ['Servicio de transporte.', { name: 'Servicio de transporte', icon: 'car' }],
  ['Servicio de cabañas', { name: 'Servicio de cabañas', icon: 'tent' }],
  ['Balneario', { name: 'Balneario', icon: 'waves' }],
  ['Hotel', { name: 'Hotel', icon: 'bed' }],
  ['Cafetería.', { name: 'Cafetería', icon: 'coffee' }],
  ['Rosticería', { name: 'Rosticería', icon: 'drumstick' }],
  ['Cibercafé', { name: 'Cibercafé', icon: 'wifi' }],
  ['Restaurante mexicano', { name: 'Comida mexicana', icon: 'utensils' }],
  ['Restaurante asiático', { name: 'Comida asiática', icon: 'utensils' }],
  ['Decoración para evento', { name: 'Decoración para eventos', icon: 'party-popper' }],
]);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 120);
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convierte una hora numérica del seed (ej. 9, 16.3, 24) a "HH:MM:SS".
 * Convenciones observadas: X.3 = X:30, X.5 = X:30, X.15 = X:15, X.45 = X:45.
 * Para 24 devuelve 23:59 (usar is24Hours=true para 0→24).
 */
function toTime(x) {
  if (x == null) return null;
  const num = Number(x);
  if (!Number.isFinite(num)) return null;
  const intPart = Math.floor(num);
  const frac = num - intPart;
  let minutes = 0;
  if (frac > 0) {
    if (Math.abs(frac - 0.3) < 0.05 || Math.abs(frac - 0.5) < 0.05) minutes = 30;
    else if (Math.abs(frac - 0.15) < 0.05 || Math.abs(frac - 0.25) < 0.05) minutes = 15;
    else if (Math.abs(frac - 0.45) < 0.05 || Math.abs(frac - 0.75) < 0.05) minutes = 45;
    else minutes = Math.round(frac * 60);
  }
  const clampedH = intPart >= 24 ? 23 : intPart;
  const clampedM = intPart >= 24 ? 59 : Math.min(minutes, 59);
  return `${String(clampedH).padStart(2, '0')}:${String(clampedM).padStart(2, '0')}:00`;
}

/** Extrae lat/lng de una URL de embed de Google Maps. */
function parseCoords(mapUrl) {
  if (!mapUrl) return null;
  const patterns = [
    /!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
  ];
  for (const p of patterns) {
    const m = mapUrl.match(p);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (lat >= 14 && lat <= 33 && lng >= -118 && lng <= -86) {
        return { lat, lng };
      }
    }
  }
  return null;
}

function normalizePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s;
}

/**
 * Algunos entries del seed traen `menu` como objeto `{img, link}` en vez de string.
 * Extrae siempre una URL string plana o null.
 */
function normalizeUrl(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^"|"$/g, '');
    return trimmed || null;
  }
  if (typeof raw === 'object') {
    return normalizeUrl(raw.link ?? raw.url ?? raw.href ?? null);
  }
  return null;
}

/**
 * Genera un slug único frente a un Set de slugs ya usados (memoria) y BD.
 */
async function generateUniqueSlug(strapi, baseName, usedSlugs) {
  const base = slugify(baseName) || 'negocio';
  let candidate = base;
  let counter = 1;
  while (usedSlugs.has(candidate)) {
    counter++;
    candidate = `${base}-${counter}`;
  }
  while (true) {
    const exists = await strapi.db.query('api::business.business').findOne({ where: { slug: candidate } });
    if (!exists) break;
    counter++;
    candidate = `${base}-${counter}`;
  }
  usedSlugs.add(candidate);
  return candidate;
}

// -----------------------------------------------------------------------------
// Seed lógico
// -----------------------------------------------------------------------------

async function seedRoot(strapi, name, meta) {
  const existing = await strapi.db.query('api::category.category').findOne({ where: { slug: slugify(name) } });
  if (existing) return existing;
  return strapi.documents('api::category.category').create({
    data: {
      name,
      slug: slugify(name),
      description: meta.description,
      icon: meta.icon,
      color: meta.color,
      order: meta.order,
      isActive: true,
      isFeatured: meta.order <= 5,
    },
  });
}

async function seedSubcategory(strapi, seedSlug, parent) {
  const meta = CATEGORY_MAPPING[seedSlug] || { parent: 'Otros', icon: 'box', color: '#6B7280' };
  const slug = slugify(seedSlug);
  const name = capitalize(seedSlug);
  const existing = await strapi.db.query('api::category.category').findOne({ where: { slug } });
  if (existing) return existing;
  return strapi.documents('api::category.category').create({
    data: {
      name,
      slug,
      parent: parent.documentId,
      icon: meta.icon,
      color: meta.color,
      isActive: true,
    },
  });
}

async function seedTag(strapi, tagName, meta) {
  const slug = slugify(tagName);
  const existing = await strapi.db.query('api::tag.tag').findOne({ where: { slug } });
  if (existing) return existing;
  return strapi.documents('api::tag.tag').create({
    data: {
      name: tagName,
      slug,
      icon: meta.icon,
      isActive: true,
    },
  });
}

function resolveTagsForBusiness(serviciosArr, tagsByOriginalKey) {
  const resolvedIds = new Set();
  for (const s of serviciosArr || []) {
    if (TAG_WHITELIST.has(s)) {
      const canonical = TAG_WHITELIST.get(s).name;
      const tag = tagsByOriginalKey.get(canonical);
      if (tag) resolvedIds.add(tag.documentId);
    }
  }
  return [...resolvedIds];
}

function buildBusinessHoursRows(horarios) {
  const rows = [];
  if (!horarios) return rows;
  for (const [dayEs, val] of Object.entries(horarios)) {
    const day = DAY_MAP[dayEs.toLowerCase()];
    if (!day) continue;

    if (val === null || val === undefined) {
      rows.push({ dayOfWeek: day, isClosed: true, sortOrder: 0 });
      continue;
    }

    const shifts = Array.isArray(val) ? val : [val];
    let order = 0;
    for (const shift of shifts) {
      if (!shift || (shift.apertura == null && shift.cierre == null)) continue;
      const is24 = shift.apertura === 0 && shift.cierre === 24;
      if (is24) {
        rows.push({
          dayOfWeek: day,
          isClosed: false,
          is24Hours: true,
          crossesMidnight: false,
          openTime: null,
          closeTime: null,
          sortOrder: order++,
        });
        continue;
      }
      const openTime = toTime(shift.apertura);
      const closeTime = toTime(shift.cierre);
      const crossesMidnight =
        shift.apertura != null &&
        shift.cierre != null &&
        Number(shift.cierre) < Number(shift.apertura);
      rows.push({
        dayOfWeek: day,
        isClosed: false,
        is24Hours: false,
        crossesMidnight,
        openTime,
        closeTime,
        sortOrder: order++,
      });
    }
  }
  return rows;
}

async function seedBusiness(strapi, item, ctx) {
  const { city, tagsByOriginalKey, subCategories, usedSlugs } = ctx;

  const categoryDoc = subCategories.get(item.categoria);
  const coords = parseCoords(item.mapa);
  const tagIds = resolveTagsForBusiness(item.servicios, tagsByOriginalKey);
  const phoneComponents = (item.telefonos || [])
    .map((tel, idx) => {
      const number = normalizePhone(tel);
      if (!number) return null;
      return {
        number,
        label: idx === 0 ? 'mobile' : 'other',
        hasWhatsapp: false,
        isPrimary: idx === 0,
      };
    })
    .filter(Boolean);

  const slug = await generateUniqueSlug(strapi, item.nombre, usedSlugs);

  const businessData = {
    name: item.nombre,
    slug,
    shortDescription: item.horarioTexto?.slice(0, 200) || null,
    category: categoryDoc?.documentId || null,
    city: city.documentId,
    tags: tagIds,
    phones: phoneComponents,
    address: item.direccion
      ? { street: item.direccion.slice(0, 200), rawText: item.direccion.slice(0, 500) }
      : null,
    geo: coords,
    mapEmbedUrl: item.mapa || null,
    logoUrl: normalizeUrl(item.logo),
    menuUrl: normalizeUrl(item.menu),
    videoUrl: normalizeUrl(item.video),
    hoursText: item.horarioTexto || null,
    amenities: item.servicios && item.servicios.length ? item.servicios.filter(Boolean) : null,
    businessStatus: 'published',
    ownershipStatus: 'unclaimed',
    createdByAdmin: true,
    isVerified: false,
    isFeatured: false,
  };

  const created = await strapi.documents('api::business.business').create({ data: businessData });

  const hourRows = buildBusinessHoursRows(item.horarios);
  for (const row of hourRows) {
    await strapi.documents('api::business-hour.business-hour').create({
      data: { ...row, business: created.documentId },
    });
  }

  return created;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function run(strapi) {
  strapi.log.info('[seed] Iniciando seed de Mandaditoz...');

  const existingCount = await strapi.db.query('api::business.business').count({});
  if (existingCount > 0) {
    strapi.log.warn(`[seed] Ya existen ${existingCount} negocios en la BD. Aborta.`);
    return;
  }

  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(`No encuentro seed en ${SEED_FILE}`);
  }
  const items = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  strapi.log.info(`[seed] ${items.length} negocios a importar.`);

  // 1. Estado
  let state = await strapi.db.query('api::state.state').findOne({ where: { slug: 'jalisco' } });
  if (!state) {
    state = await strapi.documents('api::state.state').create({
      data: { name: 'Jalisco', slug: 'jalisco', code: 'JAL', country: 'MX', isActive: true },
    });
  }
  strapi.log.info(`[seed] State: Jalisco (id=${state.id ?? state.documentId})`);

  // 2. Ciudad
  let city = await strapi.db.query('api::city.city').findOne({ where: { slug: 'etzatlan' } });
  if (!city) {
    city = await strapi.documents('api::city.city').create({
      data: {
        name: 'Etzatlán',
        slug: 'etzatlan',
        state: state.documentId,
        center: ETZATLAN_CENTER,
        boundingRadiusKm: 10,
        isActive: true,
      },
    });
  }
  strapi.log.info(`[seed] City: Etzatlán (id=${city.id ?? city.documentId})`);

  // 3. Categorías raíz
  const roots = new Map();
  for (const [name, meta] of Object.entries(ROOT_CATEGORIES)) {
    const r = await seedRoot(strapi, name, meta);
    roots.set(name, r);
  }
  strapi.log.info(`[seed] ${roots.size} categorías raíz`);

  // 4. Subcategorías (una por cada categoría única del seed)
  const uniqueSeedCats = [...new Set(items.map(i => i.categoria).filter(Boolean))];
  const subCategories = new Map();
  for (const seedCat of uniqueSeedCats) {
    const parentName = CATEGORY_MAPPING[seedCat]?.parent || 'Otros';
    const parent = roots.get(parentName) || roots.get('Otros');
    const sub = await seedSubcategory(strapi, seedCat, parent);
    subCategories.set(seedCat, sub);
  }
  strapi.log.info(`[seed] ${subCategories.size} subcategorías`);

  // 5. Tags (solo whitelist)
  const tagsByOriginalKey = new Map();
  const canonicalTags = new Set();
  for (const [, meta] of TAG_WHITELIST) canonicalTags.add(meta.name);
  for (const canonicalName of canonicalTags) {
    const meta = [...TAG_WHITELIST.values()].find(m => m.name === canonicalName);
    const tag = await seedTag(strapi, canonicalName, meta);
    tagsByOriginalKey.set(canonicalName, tag);
  }
  strapi.log.info(`[seed] ${tagsByOriginalKey.size} tags`);

  // 6. Negocios + horarios
  const usedSlugs = new Set();
  const ctx = { city, tagsByOriginalKey, subCategories, usedSlugs };
  let ok = 0;
  let fail = 0;
  for (const [i, item] of items.entries()) {
    try {
      await seedBusiness(strapi, item, ctx);
      ok++;
    } catch (err) {
      fail++;
      strapi.log.error(`[seed] ${item.nombre}: ${err.message}`);
    }
    if ((i + 1) % 25 === 0) {
      strapi.log.info(`[seed] Progreso: ${i + 1}/${items.length} (ok=${ok} fail=${fail})`);
    }
  }

  strapi.log.info(`[seed] ✅ Negocios: ok=${ok} fail=${fail}`);

  // Sync final de contadores denormalizados.
  // El lifecycle afterCreate no siempre ve las relaciones ya persistidas al momento del insert masivo,
  // así que forzamos un recount al final.
  strapi.log.info('[seed] Sincronizando contadores denormalizados...');
  await strapi.db.connection.raw(`
    UPDATE categories SET business_count = (
      SELECT COUNT(*) FROM businesses_category_lnk WHERE category_id = categories.id
    );
  `);
  await strapi.db.connection.raw(`
    UPDATE cities SET business_count = (
      SELECT COUNT(*) FROM businesses_city_lnk WHERE city_id = cities.id
    );
  `);
  await strapi.db.connection.raw(`
    UPDATE tags SET business_count = (
      SELECT COUNT(*) FROM businesses_tags_lnk WHERE tag_id = tags.id
    );
  `);
  strapi.log.info('[seed] ✅ Contadores sincronizados');
}

// -----------------------------------------------------------------------------
// Bootstrap Strapi
// -----------------------------------------------------------------------------

async function main() {
  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi({
    appDir: path.resolve(__dirname, '..'),
    distDir: path.resolve(__dirname, '..', 'dist'),
  });
  const app = await createStrapi(appContext).load();

  try {
    await run(app);
  } catch (err) {
    app.log.error(`[seed] error fatal: ${err.message}`);
    if (err.details) app.log.error(`[seed] details: ${JSON.stringify(err.details, null, 2)}`);
    if (Array.isArray(err.errors)) {
      for (const sub of err.errors) {
        app.log.error(`[seed] sub-error: ${sub.message || JSON.stringify(sub)}`);
        if (sub.details) app.log.error(`[seed]   details: ${JSON.stringify(sub.details)}`);
      }
    }
    if (err.stack) app.log.error(err.stack);
    process.exitCode = 1;
  } finally {
    await app.destroy();
  }
}

main();
