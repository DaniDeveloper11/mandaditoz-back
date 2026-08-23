const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:3000',
  'https://mandaditoz-front-production.up.railway.app',
  'https://mandaditoz.com',
  'https://www.mandaditoz.com',
  'https://localhost',
  'capacitor://localhost',
]

const FRONTEND_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_FRONTEND_ORIGINS

module.exports = [
  'strapi::logger',
  'global::translate-errors',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src':     ["'self'", 'data:', 'blob:', 'https://market-assets.strapi.io'],
          'media-src':   ["'self'", 'data:', 'blob:'],
          'frame-ancestors': ["'self'", ...FRONTEND_ORIGINS],
          upgradeInsecureRequests: null,
        },
      },
      frameguard: false,
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: FRONTEND_ORIGINS,
      headers: '*',
      credentials: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
