'use strict';

/**
 * Genera enlaces de invitación para que los dueños reclamen su ficha.
 *
 * Uso desde backend/:
 *   node scripts/generate-claim-links.js --categoria=moto-servicio --limit=25
 *   node scripts/generate-claim-links.js --categoria=moto-servicio --dry
 *
 * Opciones:
 *   --categoria=<slug>  filtra por categoría principal (sin esto, todos)
 *   --limit=<n>         máximo de negocios (por defecto 25)
 *   --base=<url>        base del sitio (por defecto FRONTEND_URL o localhost:3000)
 *   --dry               enseña la tabla sin escribir nada en la base
 *   --force             regenera el token aunque ya tenga uno vigente
 *   --report            NO genera nada: enseña el estado de la campaña
 *                       (a quién se le escribió, cuándo, y quién ya reclamó)
 *
 * Imprime una tabla lista para copiar: nombre, teléfono y el mensaje completo
 * para pegar en WhatsApp. El envío es a mano y a propósito: la app de WhatsApp
 * sigue en modo test de Meta (5 destinatarios), y para los primeros negocios el
 * trato personal convierte mucho mejor que una plantilla.
 *
 * Idempotente: por defecto respeta los tokens que siguen vigentes y solo genera
 * los que faltan. Salta a los que ya tienen dueño, están en revisión o pidieron
 * no ser contactados.
 */

const crypto = require('crypto');
const { createStrapi, compileStrapi } = require('@strapi/strapi');
const { normalizeMxPhone } = require('../src/utils/phone');

const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

function arg(nombre, porDefecto = null) {
  const found = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return found ? found.split('=').slice(1).join('=') : porDefecto;
}
const FLAG = (nombre) => process.argv.includes(`--${nombre}`);

/**
 * Mismo orden de preferencia que el nodo de n8n en n8n/claim_outreach.json: se
 * busca el número que de verdad tenga WhatsApp antes que el "principal", porque
 * el enlace se manda por ahí.
 */
function elegirTelefono(phones = []) {
  return (
    phones.find((p) => p.hasWhatsapp && p.isPrimary) ||
    phones.find((p) => p.hasWhatsapp) ||
    phones.find((p) => p.isPrimary && p.label === 'mobile') ||
    phones.find((p) => p.label === 'mobile') ||
    phones.find((p) => p.isPrimary) ||
    phones[0] ||
    null
  );
}

// Un emoji que hable del giro hace el mensaje personal en vez de plantilla. Sin
// coincidencia, la tienda genérica: es mejor eso que uno que no venga a cuento.
const EMOJI_CATEGORIA = {
  'moto-servicio': '🛵',
  taxi: '🚕',
  transporte: '🚐',
  comida: '🍽️',
  restaurante: '🍽️',
  tacos: '🌮',
  mariscos: '🦐',
  pizza: '🍕',
  panaderias: '🥖',
  tortillerias: '🫓',
  carne: '🥩',
  pollo: '🍗',
  rosticeria: '🍗',
  belleza: '💇',
  salud: '🏥',
  dentistas: '🦷',
  veterinaria: '🐾',
  ferreteria: '🔧',
  mecanico: '🔧',
  papelerias: '📚',
  educacion: '📚',
  florerias: '💐',
  agua: '💧',
  hotel: '🏨',
};

/**
 * El mensaje que se pega en WhatsApp.
 *
 * Cálido pero sobrio: los asteriscos son negritas de WhatsApp, y los emojis van
 * contados porque un mensaje sembrado de emojis y con un enlace dentro es
 * exactamente la forma que tiene una estafa. La confianza la dan el nombre real
 * del negocio, decir de entrada quién escribe, y la salida fácil al final.
 */
function mensaje(negocio, link) {
  const emoji = EMOJI_CATEGORIA[negocio.categoriaSlug] ?? '🏪';
  return [
    `¡Hola! 👋 Le escribo de *Mandaditoz*, el directorio de negocios de ${negocio.ciudad}.`,
    ``,
    `Su negocio *${negocio.name}* ${emoji} ya está publicado y la gente de ${negocio.ciudad} lo está encontrando ahí.`,
    ``,
    `Le comparto este enlace para que usted mismo tome el control de su ficha:`,
    ``,
    `👉 ${link}`,
    ``,
    `Ahí puede poner sus horarios ⏰, su WhatsApp 📲 y sus fotos 📸, para que sus clientes lo encuentren más rápido.`,
    ``,
    `✅ Es completamente gratis. No pedimos tarjeta ni cobramos comisión.`,
    `🔒 El enlace es solo para usted, mejor no lo comparta.`,
    ``,
    `Si no le interesa, no hay problema: ignore este mensaje y no volvemos a escribirle. ¡Gracias! 🙏`,
  ].join('\n');
}

async function reporte(app, categoria) {
  const negocios = await app.documents('api::business.business').findMany({
    filters: {
      businessStatus: 'published',
      archivedAt: { $null: true },
      lastOutreachAt: { $notNull: true },
      ...(categoria ? { category: { slug: categoria } } : {}),
    },
    populate: ['city'],
    sort: 'lastOutreachAt:desc',
    limit: 500,
  });

  if (!negocios.length) {
    console.log('\n  Todavía no se le ha mandado invitación a nadie.\n');
    return;
  }

  // `pending_claim` ya no aparece por esta vía: los reclamos por invitación se
  // aprueban solos. Sigue en la tabla porque los reclamos del formulario público
  // de la ficha sí pasan por revisión.
  const ESTADO = {
    claimed: '✅ RECLAMADO',
    pending_claim: '⏳ revisar en panel',
    unclaimed: '·  sin respuesta',
  };

  const dias = (fecha) => Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);
  const cuenta = { claimed: 0, pending_claim: 0, unclaimed: 0 };

  console.log(`\n  ESTADO DE LA CAMPAÑA${categoria ? ` — ${categoria}` : ''}\n`);
  console.log(`  ${'NEGOCIO'.padEnd(34)}${'ESTADO'.padEnd(18)}${'ESCRITO'.padEnd(12)}ENVÍOS`);
  console.log(`  ${'─'.repeat(74)}`);

  for (const b of negocios) {
    cuenta[b.ownershipStatus] = (cuenta[b.ownershipStatus] ?? 0) + 1;
    const d = dias(b.lastOutreachAt);
    const cuando = d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
    console.log(
      `  ${b.name.slice(0, 32).padEnd(34)}` +
      `${(ESTADO[b.ownershipStatus] ?? b.ownershipStatus).padEnd(18)}` +
      `${cuando.padEnd(12)}${b.outreachCount ?? 1}`
    );
  }

  const total = negocios.length;
  const pct = (n) => `${Math.round((n / total) * 100)}%`;
  console.log(`  ${'─'.repeat(74)}`);
  console.log(
    `  ${total} invitados · ${cuenta.claimed ?? 0} reclamados (${pct(cuenta.claimed ?? 0)}) · ` +
    `${cuenta.unclaimed ?? 0} sin respuesta\n`
  );

  if (cuenta.pending_claim) {
    console.log(`  ⚠ ${cuenta.pending_claim} llegaron por el formulario público y sí necesitan tu revisión en el panel.\n`);
  }
}

async function run() {
  const app = await createStrapi(await compileStrapi()).load();

  const categoria = arg('categoria');

  if (FLAG('report')) {
    await reporte(app, categoria);
    await app.destroy();
    process.exit(0);
  }

  const limit = Number(arg('limit', '25'));
  const base = String(arg('base', process.env.FRONTEND_URL || 'http://localhost:3000')).replace(/\/$/, '');
  const dry = FLAG('dry');
  const force = FLAG('force');

  const negocios = await app.documents('api::business.business').findMany({
    filters: {
      businessStatus: 'published',
      archivedAt: { $null: true },
      ownershipStatus: 'unclaimed',
      owner: { $null: true },
      // NO usar `{ $ne: true }` ni `{ $eq: false }` aquí: la columna se agregó
      // después, así que las 400+ filas existentes están en NULL, y en SQL
      // `NULL != true` es NULL — o sea, se quedaban todas fuera y el script no
      // devolvía nada. (El mismo error está en n8n/claim_outreach.json, que
      // filtra por `outreachOptOut[$eq]=false`.)
      $or: [{ outreachOptOut: { $null: true } }, { outreachOptOut: false }],
      ...(categoria ? { category: { slug: categoria } } : {}),
    },
    populate: ['phones', 'city', 'category'],
    sort: 'lastOutreachAt:asc',
    // `findMany` de la Documents API usa `limit`, no `pagination`: con
    // `pagination: { pageSize }` devuelve todo y el --limit se ignora en silencio.
    limit,
  });

  console.log(`\n→ ${negocios.length} negocios sin dueño${categoria ? ` en "${categoria}"` : ''}${dry ? '  [DRY RUN]' : ''}\n`);

  const filas = [];
  const saltados = [];

  for (const b of negocios) {
    const pick = elegirTelefono(b.phones);
    const mx = pick ? normalizeMxPhone(pick.number) : null;
    if (!mx) {
      saltados.push([b.name, pick ? `teléfono no interpretable: ${pick.number}` : 'sin teléfono']);
      continue;
    }

    const vigente =
      b.outreachToken &&
      b.outreachTokenExpiresAt &&
      new Date(b.outreachTokenExpiresAt).getTime() > Date.now();

    const token = vigente && !force ? b.outreachToken : crypto.randomBytes(16).toString('hex');
    const expira = vigente && !force
      ? b.outreachTokenExpiresAt
      : new Date(Date.now() + TREINTA_DIAS_MS).toISOString();

    if (!dry && (!vigente || force)) {
      await app.documents('api::business.business').update({
        documentId: b.documentId,
        data: {
          outreachToken: token,
          outreachTokenExpiresAt: expira,
          outreachPhone: mx.username,
          lastOutreachAt: new Date().toISOString(),
          outreachCount: (b.outreachCount ?? 0) + 1,
        },
      });
    }

    filas.push({
      name: b.name,
      ciudad: b.city?.name ?? 'Jalisco',
      categoriaSlug: b.category?.slug ?? null,
      telefono: mx.national,
      wa: `https://wa.me/${mx.username}`,
      link: `${base}/reclamar/${token}`,
      reusado: vigente && !force,
    });
  }

  for (const f of filas) {
    console.log('─'.repeat(72));
    console.log(`${f.name}${f.reusado ? '   (token vigente reutilizado)' : ''}`);
    console.log(`Tel: ${f.telefono}   ${f.wa}`);
    console.log(`Link: ${f.link}`);
    console.log(`\n${mensaje(f, f.link)}\n`);
  }

  console.log('─'.repeat(72));
  console.log(`\n✅ ${filas.length} enlaces${dry ? ' (no se escribió nada)' : ' generados y guardados'}`);
  if (saltados.length) {
    console.log(`\n⚠ ${saltados.length} sin enlace:`);
    for (const [nombre, motivo] of saltados) console.log(`   · ${nombre} — ${motivo}`);
  }
  console.log('');

  // tarn (el pool de conexiones de knex) rechaza sus operaciones pendientes al
  // cerrar, y ese rechazo llega fuera de este await: sin esto el proceso muere
  // con un stack de "aborted" cuando el trabajo ya terminó y los enlaces ya se
  // guardaron, que parece un fallo y no lo es.
  process.on('unhandledRejection', () => {});
  try {
    await app.destroy();
  } catch {
    // El proceso termina igual; no hay nada que rescatar.
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
