'use strict';

/**
 * Verificación del `id_token` de Google.
 *
 * Los dos clientes (web con Google Identity Services, Android con el plugin
 * nativo) terminan mandando lo mismo: un JWT firmado por Google. Así que hay un
 * solo camino de verificación en el backend en vez de dos.
 *
 * No se usa el endpoint `tokeninfo` de Google: `verifyIdToken` valida la firma
 * contra las llaves públicas (que la librería cachea) sin salir a la red en cada
 * login, y además comprueba `iss`, `exp` y `aud` en el mismo paso.
 */

const { OAuth2Client } = require('google-auth-library');

// Emisores válidos de Google. La librería ya los valida, pero se repite aquí
// porque es la única defensa si alguna versión futura relaja esa comprobación.
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Los `aud` que aceptamos. En Android el plugin nativo pide el token con el
 * *serverClientId* (el ID web), así que normalmente basta con uno — pero se
 * admite una lista separada por comas para poder rotar la credencial sin
 * tirar las sesiones de la app ya publicada.
 */
function allowedAudiences() {
  const raw = process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isConfigured() {
  return allowedAudiences().length > 0;
}

let client = null;
function getClient() {
  if (!client) client = new OAuth2Client();
  return client;
}

/**
 * @returns {Promise<{ sub, email, emailVerified, name, picture }>}
 * @throws  {Error} con mensaje ya en español, listo para `ctx.badRequest`.
 */
async function verifyGoogleIdToken(idToken) {
  const audience = allowedAudiences();
  if (!audience.length) {
    throw new Error('El inicio de sesión con Google no está configurado en el servidor.');
  }
  if (typeof idToken !== 'string' || idToken.length < 10) {
    throw new Error('Falta el token de Google.');
  }

  let payload;
  try {
    const ticket = await getClient().verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (err) {
    // El detalle real (firma inválida, expirado, aud equivocado) solo sirve para
    // depurar; al cliente se le da un mensaje único para no filtrar cuál falló.
    throw Object.assign(new Error('El token de Google no es válido o ya expiró.'), { cause: err });
  }

  if (!payload || !VALID_ISSUERS.includes(payload.iss)) {
    throw new Error('El token de Google no es válido o ya expiró.');
  }

  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new Error('Tu cuenta de Google no compartió un correo electrónico.');
  }

  // Sin esto la vinculación con una cuenta local sería un secuestro: cualquiera
  // que registre `victima@dominio.com` en un Workspace sin verificar entraría a
  // la cuenta de la víctima. Google marca `email_verified: false` en ese caso.
  if (payload.email_verified !== true) {
    throw new Error('Google no ha verificado ese correo. Inicia sesión con tu contraseña.');
  }

  return {
    sub: payload.sub,
    email,
    emailVerified: true,
    name: String(payload.name ?? '').trim() || null,
    picture: payload.picture ?? null,
  };
}

module.exports = { verifyGoogleIdToken, isConfigured, allowedAudiences };
