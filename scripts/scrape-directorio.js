'use strict';

/**
 * Extrae el arreglo `const negocios = [...]` embebido en el HTML del
 * directorio de etzatlanjalisco.com.mx (o cualquier página con el mismo
 * formato) y lo guarda como JSON limpio.
 *
 * Uso desde backend/:
 *   node scripts/scrape-directorio.js [url] [salida]
 *
 * Defaults:
 *   url    = https://etzatlanjalisco.com.mx/directorio/
 *   salida = ../negocios_etzatlan_v2.json  (relativa a este archivo)
 *
 * Después de correr esto:
 *   node scripts/seed-categories-v2.js       (si hay categorías nuevas)
 *   node scripts/seed-businesses.js
 *   node scripts/recompute-business-counts.js
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://etzatlanjalisco.com.mx/directorio/';
const DEFAULT_OUT = path.resolve(__dirname, '../../negocios_etzatlan_v2.json');
const START_MARKER = 'const negocios=[';

async function fetchHtml(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al bajar ${url}`);
  return res.text();
}

// Recorre el HTML contando corchetes (respetando strings) hasta cerrar el
// arreglo. Necesario porque el JSON en la página no es JSON estricto — usa
// claves sin comillas — así que un regex no basta.
function extractArraySource(html) {
  const startIdx = html.indexOf(START_MARKER);
  if (startIdx === -1) throw new Error(`No se encontró "${START_MARKER}" en el HTML`);

  let depth = 0;
  let inString = false;
  let stringChar = null;
  let escape = false;
  let endIdx = -1;

  for (let i = startIdx + START_MARKER.length - 1; i < html.length; i++) {
    const c = html[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (inString) {
      if (c === stringChar) inString = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inString = true; stringChar = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

  if (endIdx === -1) throw new Error('El arreglo `negocios` nunca se cerró');
  return html.slice(startIdx + 'const negocios='.length, endIdx);
}

async function run() {
  const url = process.argv[2] || DEFAULT_URL;
  const out = process.argv[3] || DEFAULT_OUT;

  console.log(`→ Descargando ${url}`);
  const html = await fetchHtml(url);
  console.log(`  HTML: ${(html.length / 1024).toFixed(1)} KB`);

  const arraySrc = extractArraySource(html);
  // eslint-disable-next-line no-eval
  const negocios = eval('(' + arraySrc + ')');

  const cats = [...new Set(negocios.map((n) => n.categoria))].sort();
  console.log(`  Negocios extraídos: ${negocios.length}`);
  console.log(`  Categorías únicas:  ${cats.length}`);
  console.log(`  ${cats.join(', ')}`);

  fs.writeFileSync(out, JSON.stringify(negocios, null, 2));
  console.log(`\n✅ Escrito: ${out}`);
}

run().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
