'use strict';

/**
 * Sube las imágenes de imagenes-negocios/ a la Media Library de Strapi
 * y las vincula al campo `logo` de cada negocio.
 *
 * Uso desde backend/:
 *   node scripts/upload-imagenes.js             # corre todo
 *   node scripts/upload-imagenes.js --dry-run   # solo muestra matches, no sube
 *   node scripts/upload-imagenes.js --force      # sobreescribe logos existentes
 *   node scripts/upload-imagenes.js --desde 50  # empieza desde el índice 50
 *
 * Matching: el slug se deriva del nombre del archivo eliminando el prefijo
 * numérico y la extensión. Ej: "003-comisaria-...jpg" → "comisaria-..."
 * Esto coincide con los slugs que genera seed-businesses.js.
 */

const fs   = require('fs');
const path = require('path');
const { createStrapi, compileStrapi } = require('@strapi/strapi');

const IMAGES_DIR = path.resolve(__dirname, '../../frontend/public/imagenes-negocios');
const INDEX_FILE = path.join(IMAGES_DIR, 'indice.json');
const MIME_MAP   = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE   = args.includes('--force');
const desdeIdx = (() => {
  const i = args.indexOf('--desde');
  return i !== -1 ? parseInt(args[i + 1], 10) : 0;
})();

function slugFromArchivo(archivo) {
  return archivo
    .replace(/^\d+-/, '')
    .replace(/\.[^.]+$/, '');
}

function mimeFromArchivo(archivo) {
  const ext = archivo.split('.').pop().toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

async function procesarNegocio(app, entrada, stats) {
  const { indice, archivo, nombre } = entrada;

  if (indice < desdeIdx) {
    stats.saltadoDesde++;
    return;
  }

  const filePath = path.join(IMAGES_DIR, archivo);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ [${indice}] archivo no encontrado: ${archivo}`);
    stats.archivoNoEncontrado++;
    return;
  }

  const slug = slugFromArchivo(archivo);

  const business = await app.documents('api::business.business').findFirst({
    filters: { slug },
    populate: ['logo'],
  });

  if (!business) {
    console.warn(`  ⚠ [${indice}] negocio no encontrado para slug "${slug}" (${nombre})`);
    stats.negocioNoEncontrado++;
    return;
  }

  if (business.logo && !FORCE) {
    console.log(`  · [${indice}] ${slug} — ya tiene logo, omitido`);
    stats.yaTeníaLogo++;
    return;
  }

  if (DRY_RUN) {
    console.log(`  ✓ [${indice}] ${slug} ← ${archivo}`);
    stats.subidas++;
    return;
  }

  const mime = mimeFromArchivo(archivo);
  const stat = fs.statSync(filePath);

  const uploadSvc = app.plugin('upload').service('upload');
  const [media] = await uploadSvc.upload({
    data: {
      fileInfo: {
        name: archivo,
        alternativeText: nombre,
        caption: nombre,
      },
    },
    files: {
      path: filePath,
      name: archivo,
      type: mime,
      size: stat.size,
    },
  });

  await app.documents('api::business.business').update({
    documentId: business.documentId,
    data: { logo: media.id },
    status: 'published',
  });

  console.log(`  ✚ [${indice}] ${slug} ← ${archivo}`);
  stats.subidas++;
}

async function run() {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`No se encontró ${INDEX_FILE}`);
  }

  const entradas = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  console.log(`\n→ ${entradas.length} entradas en indice.json`);
  if (DRY_RUN) console.log('  (modo --dry-run, no se subirá nada)');
  if (FORCE)   console.log('  (modo --force, se sobreescriben logos existentes)');
  if (desdeIdx > 0) console.log(`  (empezando desde índice ${desdeIdx})`);

  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  const stats = {
    subidas: 0,
    yaTeníaLogo: 0,
    negocioNoEncontrado: 0,
    archivoNoEncontrado: 0,
    saltadoDesde: 0,
    errores: 0,
  };

  console.log('\n→ Procesando...');
  for (const entrada of entradas) {
    try {
      await procesarNegocio(app, entrada, stats);
    } catch (e) {
      stats.errores++;
      console.error(`  ✗ [${entrada.indice}] ${entrada.archivo}:`, e.message);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`  ${DRY_RUN ? 'Matches encontrados' : 'Subidas'}:      ${stats.subidas}`);
  console.log(`  Ya tenían logo:               ${stats.yaTeníaLogo}`);
  console.log(`  Negocio no encontrado:        ${stats.negocioNoEncontrado}`);
  console.log(`  Archivo no encontrado:        ${stats.archivoNoEncontrado}`);
  if (desdeIdx > 0)
    console.log(`  Saltados (--desde):           ${stats.saltadoDesde}`);
  console.log(`  Errores:                      ${stats.errores}`);
  console.log('');

  await app.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
