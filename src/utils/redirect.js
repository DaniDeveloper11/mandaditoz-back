'use strict';

/**
 * Valida un destino de navegación interno.
 *
 * Solo se acepta una ruta del propio sitio. Sin esto, el cliente podría guardar
 * https://sitio.malo y el correo de confirmación —que sale de nuestro dominio y
 * por tanto inspira confianza— acabaría empujando al usuario fuera del sitio:
 * un open redirect de manual, ideal para phishing.
 *
 * Se rechaza `//host` y `/\host` porque los navegadores las tratan como
 * absolutas: `//sitio.malo` navega a ese host aunque empiece con barra.
 *
 * Devuelve la ruta o null. El tope de 255 no es decorativo: Strapi mapea los
 * campos `string` a varchar(255) pase lo que pase en el maxLength, así que una
 * ruta más larga reventaría al guardar `pendingRedirect`.
 */
function safeRedirectPath(value) {
  const path = String(value ?? '').trim();
  if (!path.startsWith('/')) return null;
  if (path.startsWith('//') || path.startsWith('/\\')) return null;
  if (path.length > 255) return null;
  return path;
}

module.exports = { safeRedirectPath };
