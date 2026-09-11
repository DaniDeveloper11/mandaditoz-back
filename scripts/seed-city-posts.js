'use strict';

/**
 * Siembra la cartelera de demo de un municipio (content-type city-post):
 * eventos con fecha, avisos con vigencia y carteles de fiestas patronales.
 *
 * Uso desde backend/:
 *   node scripts/seed-city-posts.js
 *   node scripts/seed-city-posts.js --city=etzatlan
 *   node scripts/seed-city-posts.js --wipe
 *
 * Idempotente por slug: si el post ya existe lo actualiza en lugar de
 * duplicarlo, así que se puede correr todas las veces que haga falta.
 *
 * Las fechas son RELATIVAS al día en que se corre (offsets en días), para que
 * la cartelera siempre tenga contenido vigente sin editar el script. Uno de
 * los posts queda en el pasado a propósito: sirve para probar el filtro de
 * archivo (?pasados=1) y que el listado normal no lo muestre.
 *
 * No se suben imágenes: coverImage/gallery quedan vacíos y hay que cargarlos a
 * mano desde el panel. El post de fiestas patronales existe justo para tener
 * dónde probar el render imagen-first de kind = 'cartel'.
 */

const path = require('path');

const CITY_POR_DEFECTO = 'etzatlan';

/** Hoy a las HH:MM locales, corrido `dias`. */
function enDias(dias, hora = 19, minuto = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(hora, minuto, 0, 0);
  return d;
}

/**
 * Los posts de demo. `startAt`/`endAt` se resuelven al correr.
 * Dejar endAt en null es intencional en varios: prueba que el lifecycle lo
 * rellene (evento/cartel = fin del día de inicio; aviso = +30 días).
 */
const POSTS = [
  {
    slug: 'fiestas-patronales-san-francisco-de-asis',
    title: 'Fiestas Patronales de San Francisco de Asís',
    kind: 'cartel',
    eventCategory: 'fiesta_patronal',
    summary: 'Diez días de novenario, danzas, castillo, jaripeo y música en vivo en la plaza principal.',
    description: 'Programa completo del novenario en honor a San Francisco de Asís: peregrinaciones por barrio, danza de sonajeros, juegos mecánicos en la explanada, jaripeo el sábado y quema de castillo el último día. El cartel con el programa por día se publica en la portada de este evento.',
    startAt: enDias(20, 8, 0),
    endAt: enDias(30, 23, 0),
    allDay: true,
    venueName: 'Plaza principal y Parroquia de San Francisco de Asís',
    venueAddress: 'Centro, Etzatlán, Jalisco',
    organizerName: 'Comité de Fiestas Patronales',
    priceText: 'Entrada libre',
    isFeatured: true,
    featuredOrder: 1,
  },
  {
    slug: 'serenata-en-la-plaza-principal',
    title: 'Serenata en la plaza principal',
    kind: 'evento',
    eventCategory: 'cultural',
    summary: 'La banda municipal toca cada domingo al caer la tarde en el kiosco.',
    startAt: enDias(7, 18, 30),
    endAt: null,
    venueName: 'Kiosco de la plaza principal',
    venueAddress: 'Centro, Etzatlán, Jalisco',
    organizerName: 'Casa de la Cultura',
    priceText: 'Entrada libre',
  },
  {
    slug: 'torneo-de-futbol-llanero-copa-etzatlan',
    title: 'Torneo de fútbol llanero Copa Etzatlán',
    kind: 'evento',
    eventCategory: 'deportivo',
    summary: 'Arranque del torneo con 16 equipos de la región. Inscripciones en la Unidad Deportiva.',
    startAt: enDias(14, 9, 0),
    endAt: enDias(14, 18, 0),
    venueName: 'Unidad Deportiva Municipal',
    organizerName: 'Dirección de Fomento Deportivo',
    contactPhone: '3861234567',
    priceText: 'Cooperación $50 por equipo',
  },
  {
    slug: 'aviso-corte-de-agua-zona-centro',
    title: 'Corte de agua programado en la zona centro',
    kind: 'aviso',
    eventCategory: 'servicio_publico',
    summary: 'Mantenimiento a la red: el suministro se suspende de 8:00 a 16:00 en el primer cuadro.',
    description: 'Se recomienda almacenar agua la noche anterior. Colonias afectadas: Centro, La Cruz y El Refugio.',
    startAt: enDias(2, 8, 0),
    endAt: null, // el lifecycle lo pone en +30 días por ser aviso
    organizerName: 'SIMAPAE',
    contactPhone: '3861112233',
  },
  {
    slug: 'feria-regional-de-la-nieve-y-el-mezcal',
    title: 'Feria regional de la nieve y el mezcal',
    kind: 'evento',
    eventCategory: 'feria',
    summary: 'Productores de toda la región Valles en un solo lugar: nieve de garrafa, mezcal y artesanía.',
    startAt: enDias(45, 11, 0),
    endAt: enDias(47, 22, 0),
    venueName: 'Explanada municipal',
    organizerName: 'Gobierno municipal',
    externalUrl: 'https://www.facebook.com/events/ejemplo-feria-regional',
    priceText: 'Entrada libre',
    // Varios negocios en un mismo evento: los puestos que participan.
    negocios: 3,
    // Evento regional: aparece en la cartelera de cualquier municipio.
    visibleInAllCities: true,
    isFeatured: true,
    featuredOrder: 2,
  },
  {
    slug: 'desfile-civico-20-de-noviembre',
    title: 'Desfile cívico-deportivo del 20 de Noviembre',
    kind: 'evento',
    eventCategory: 'civico',
    summary: 'Contingentes de todas las escuelas del municipio recorriendo el centro.',
    startAt: enDias(60, 9, 0),
    endAt: null,
    venueName: 'Calle Hidalgo, del jardín a la Unidad Deportiva',
    organizerName: 'Presidencia municipal',
    priceText: 'Entrada libre',
  },
  {
    slug: 'noche-de-mariachi',
    title: 'Noche de mariachi',
    kind: 'evento',
    eventCategory: 'cultural',
    summary: 'Mariachi en vivo desde las 8 de la noche.',
    startAt: enDias(10, 20, 0),
    endAt: null,
    priceText: 'Sin cover',
    // Un solo negocio: la sede. Prueba el caso simple de la relación y el
    // bloque "Próximos eventos aquí" de la ficha.
    negocios: 1,
    sede: true,
  },
  {
    slug: 'kermes-infantil-de-la-parroquia',
    title: 'Kermés infantil de la parroquia',
    kind: 'evento',
    eventCategory: 'infantil',
    summary: 'Juegos, antojitos y rifa a beneficio del catecismo.',
    // A propósito en el pasado: sirve para probar el archivo (?pasados=1).
    startAt: enDias(-5, 16, 0),
    endAt: enDias(-5, 21, 0),
    venueName: 'Atrio de la parroquia',
    organizerName: 'Grupo de catequistas',
    priceText: 'Cooperación voluntaria',
  },
];

async function run() {
  const args = process.argv.slice(2);
  const wipe = args.includes('--wipe');
  const cityArg = args.find((a) => a.startsWith('--city='));
  const citySlug = cityArg ? cityArg.split('=')[1] : CITY_POR_DEFECTO;

  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  const appContext = await compileStrapi({
    appDir: path.resolve(__dirname, '..'),
    distDir: path.resolve(__dirname, '..', 'dist'),
  });
  const strapi = await createStrapi(appContext).load();

  // Ojo: en el Document Service las consultas se acotan con `limit`, no con
  // `pagination: { pageSize }` — esa opcion se ignora en silencio y devuelve
  // TODO (mismo tropiezo documentado en scripts/generate-claim-links.js:206).
  const docs = strapi.documents('api::city-post.city-post');

  if (wipe) {
    const previos = await docs.findMany({
      filters: { slug: { $in: POSTS.map((p) => p.slug) } },
      fields: ['documentId'],
      limit: 100,
    });
    for (const p of previos) await docs.delete({ documentId: p.documentId });
    console.log(`🧹 Borrados ${previos.length} posts de demo previos`);
  }

  const [city] = await strapi.documents('api::city.city').findMany({
    filters: { slug: citySlug },
    fields: ['documentId', 'name', 'slug'],
    limit: 1,
  });

  if (!city) {
    console.error(`❌ No existe la ciudad con slug "${citySlug}". Corre primero el seed de ciudades.`);
    await strapi.destroy();
    process.exit(1);
  }

  // Para el evento con sede se busca un negocio donde una noche de mariachi
  // tenga sentido (restaurante/bar/etc.). Si no hay, cae al primer publicado:
  // el objetivo es que la relación quede sembrada, no el realismo.
  const CATEGORIAS_CON_SEDE = ['restaurante', 'mariscos', 'botanas', 'comida', 'tacos'];
  let candidatos = await strapi.documents('api::business.business').findMany({
    filters: {
      businessStatus: 'published',
      archivedAt: { $null: true },
      category: { slug: { $in: CATEGORIAS_CON_SEDE } },
    },
    fields: ['documentId', 'name'],
    sort: 'id:asc',
    limit: 5,
  });
  if (!candidatos.length) {
    candidatos = await strapi.documents('api::business.business').findMany({
      filters: { businessStatus: 'published', archivedAt: { $null: true } },
      fields: ['documentId', 'name'],
      sort: 'id:asc',
      limit: 5,
    });
  }

  console.log(`📅 Sembrando cartelera de ${city.name}...`);
  let creados = 0;
  let actualizados = 0;

  for (const { negocios, sede, ...post } of POSTS) {
    const data = {
      ...post,
      city: city.documentId,
      postStatus: 'published',
    };

    if (negocios) {
      const elegidos = candidatos.slice(0, negocios);
      if (!elegidos.length) {
        console.log(`   ⚠️  ${post.slug}: no hay negocios publicados, se siembra sin relación`);
      } else {
        // La relación es manyToMany: siempre un array, aunque sea uno solo.
        data.businesses = elegidos.map((b) => b.documentId);
        if (sede) {
          data.venueName = elegidos[0].name;
          data.title = `${post.title} en ${elegidos[0].name}`;
        }
      }
    }

    const [existente] = await docs.findMany({
      filters: { slug: post.slug },
      fields: ['documentId'],
      limit: 1,
    });

    if (existente) {
      await docs.update({ documentId: existente.documentId, data });
      actualizados++;
      console.log(`   ↻ ${data.title}`);
    } else {
      await docs.create({ data });
      creados++;
      console.log(`   ✓ ${data.title}`);
    }
  }

  // Un borrador para verificar que el controller NO lo expone por la API
  // (?filters[postStatus][$eq]=draft tiene que seguir devolviendo vacío).
  const slugBorrador = 'borrador-de-prueba-no-publicado';
  const [borrador] = await docs.findMany({
    filters: { slug: slugBorrador },
    fields: ['documentId'],
    limit: 1,
  });
  if (!borrador) {
    await docs.create({
      data: {
        slug: slugBorrador,
        title: 'Borrador de prueba (no publicado)',
        kind: 'aviso',
        summary: 'Si esto aparece en la API pública, el filtro del controller está roto.',
        startAt: enDias(5, 10, 0),
        city: city.documentId,
        postStatus: 'draft',
      },
    });
    creados++;
    console.log('   ✓ Borrador de prueba (postStatus = draft)');
  }

  console.log(`\n✅ ${creados} creados, ${actualizados} actualizados`);
  console.log('   Las portadas (coverImage) se cargan a mano desde el panel.');

  await strapi.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
