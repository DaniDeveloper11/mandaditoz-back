'use strict';

/**
 * Siembra voces de demo de un municipio (content-type creator): influencers,
 * fotógrafos, cronistas, podcasts y medios locales.
 *
 * Uso desde backend/:
 *   node scripts/seed-voces-demo.js
 *   node scripts/seed-voces-demo.js --city=etzatlan
 *   node scripts/seed-voces-demo.js --wipe
 *
 * Idempotente por slug: si la voz ya existe la actualiza en lugar de
 * duplicarla, así que se puede correr todas las veces que haga falta.
 *
 * ⚠️ SON PERSONAS INVENTADAS. Los nombres y los arrobas no corresponden a nadie
 * real y las URLs de redes apuntan a perfiles que no existen: es data de prueba
 * para ver la sección con contenido, NO un alta de gente de verdad. Una voz real
 * se captura desde el panel y solo después de que la persona haya dado su
 * permiso — para eso está el campo `consentAt`.
 *
 * No se suben imágenes: avatar/coverImage/gallery quedan vacíos y hay que
 * cargarlos a mano desde el panel. Las tarjetas y la ficha ya contemplan el caso
 * sin foto (cae al icono del tipo).
 */

const path = require('path');

const CITY_POR_DEFECTO = 'etzatlan';

/**
 * Las voces de demo. Cubren a propósito varios `creatorType`, para que los
 * chips de filtro de /[city]/voces tengan más de una opción, y una regional
 * (`visibleInAllCities`) para probar que aparece en cualquier municipio y que su
 * canónica cae en /jalisco/voces/...
 */
const VOCES = [
  {
    slug: 'mariana-del-toro',
    name: 'Mariana del Toro',
    handle: 'marianadeltoro',
    creatorType: 'influencer',
    tagline: 'Recorro los pueblos de la región y cuento dónde comer bien y barato.',
    bio: 'Empecé subiendo videos de las fiestas de mi pueblo y no paré. Hoy recorro los municipios de la región Valles buscando fondas, tianguis y lugares que nadie más graba.',
    audienceText: '18 mil en TikTok',
    coversTopics: 'comida, fiestas patronales, tianguis',
    regionName: 'Región Valles',
    isFeatured: true,
    featuredOrder: 1,
    socialLinks: [
      { platform: 'tiktok', url: 'https://www.tiktok.com/@marianadeltoro' },
      { platform: 'instagram', url: 'https://www.instagram.com/marianadeltoro' },
    ],
  },
  {
    slug: 'foto-aguirre',
    name: 'Foto Aguirre',
    handle: 'fotoaguirre',
    creatorType: 'fotografo',
    tagline: 'Fotografía de fiestas patronales, bodas y charrería desde 1998.',
    bio: 'Tres generaciones retratando lo que pasa en la plaza. El archivo tiene más de veinte años de fiestas del municipio.',
    coversTopics: 'fiestas patronales, charrería, retrato',
    socialLinks: [
      { platform: 'facebook', url: 'https://www.facebook.com/fotoaguirre' },
      { platform: 'instagram', url: 'https://www.instagram.com/fotoaguirre' },
    ],
    contactPhone: '3861234567',
  },
  {
    slug: 'don-chuy-cronista',
    name: 'Don Chuy, cronista',
    handle: 'donchuycronista',
    creatorType: 'cronista',
    tagline: 'Historias viejas del pueblo, contadas como se contaban en la banqueta.',
    bio: 'Llevo cuarenta años juntando historias, actas y fotos del municipio. Publico una cada domingo.',
    coversTopics: 'historia local, tradiciones, archivo',
    socialLinks: [
      { platform: 'facebook', url: 'https://www.facebook.com/donchuycronista' },
    ],
  },
  {
    slug: 'radar-de-los-valles',
    name: 'Radar de los Valles',
    handle: 'radarvalles',
    creatorType: 'medio_local',
    tagline: 'Noticias de los municipios de la región Valles, todos los días.',
    bio: 'Medio digital independiente. Cubrimos cabildo, obra pública y seguridad en toda la región.',
    audienceText: '40 mil seguidores',
    coversTopics: 'noticias, política local, seguridad',
    regionName: 'Región Valles',
    // Regional: se ve en la sección de cualquier municipio y su canónica cae en
    // /jalisco/voces/... Es el caso que prueba visibleInAllCities.
    visibleInAllCities: true,
    socialLinks: [
      { platform: 'facebook', url: 'https://www.facebook.com/radarvalles' },
      { platform: 'youtube', url: 'https://www.youtube.com/@radarvalles' },
      { platform: 'twitter', url: 'https://x.com/radarvalles' },
    ],
    website: 'https://radardelosvalles.example.com',
  },
  {
    slug: 'podcast-aqui-entre-nos',
    name: 'Aquí entre nos',
    handle: 'aquientrenospod',
    creatorType: 'podcast',
    tagline: 'Cada semana, una plática larga con alguien del pueblo.',
    bio: 'Un podcast sin prisas: oficios que se están acabando, negocios de toda la vida y gente que hizo algo raro.',
    audienceText: '60 episodios',
    coversTopics: 'entrevistas, oficios, negocios locales',
    socialLinks: [
      { platform: 'youtube', url: 'https://www.youtube.com/@aquientrenospod' },
      { platform: 'instagram', url: 'https://www.instagram.com/aquientrenospod' },
    ],
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
  const docs = strapi.documents('api::creator.creator');

  if (wipe) {
    const previos = await docs.findMany({
      filters: { slug: { $in: [...VOCES.map((v) => v.slug), 'voz-borrador-de-prueba'] } },
      fields: ['documentId'],
      limit: 100,
    });
    for (const v of previos) await docs.delete({ documentId: v.documentId });
    console.log(`🧹 Borradas ${previos.length} voces de demo previas`);
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

  console.log(`\n🎙  Sembrando voces de demo en ${city.name} (${city.slug})\n`);

  let creados = 0;
  let actualizados = 0;

  for (const voz of VOCES) {
    const [previo] = await docs.findMany({
      filters: { slug: voz.slug },
      fields: ['documentId'],
      limit: 1,
    });

    const data = {
      ...voz,
      city: city.documentId,
      creatorStatus: 'published',
      // Data inventada: se marca el consentimiento para que la ficha sea
      // coherente consigo misma. En una voz REAL este campo es el rastro de que
      // la persona dio su permiso, y no debe rellenarse a la ligera.
      consentAt: new Date(),
    };

    if (previo) {
      await docs.update({ documentId: previo.documentId, data });
      actualizados++;
      console.log(`   ↻ ${voz.name}`);
    } else {
      await docs.create({ data });
      creados++;
      console.log(`   ✓ ${voz.name}`);
    }
  }

  // Borrador de control: si esto aparece en /api/creators, el forzado de
  // creatorStatus del controller está roto. Mismo truco que seed-city-posts.js.
  const slugBorrador = 'voz-borrador-de-prueba';
  const [previoBorrador] = await docs.findMany({
    filters: { slug: slugBorrador },
    fields: ['documentId'],
    limit: 1,
  });
  if (!previoBorrador) {
    await docs.create({
      data: {
        slug: slugBorrador,
        name: 'Borrador de prueba (no publicado)',
        creatorType: 'otro',
        tagline: 'Si esto aparece en la API pública, el filtro del controller está roto.',
        city: city.documentId,
        creatorStatus: 'draft',
      },
    });
    creados++;
    console.log('   ✓ Borrador de prueba (creatorStatus = draft)');
  }

  console.log(`\n✅ ${creados} creadas, ${actualizados} actualizadas`);
  console.log('   Los avatares y portadas se cargan a mano desde el panel.');

  await strapi.destroy();
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
