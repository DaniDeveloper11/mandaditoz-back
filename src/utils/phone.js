'use strict';

/**
 * Normaliza un teléfono mexicano a E.164 (+52 + 10 dígitos).
 *
 * Acepta lo que la gente realmente teclea: espacios, guiones, paréntesis,
 * con o sin +52, y el prefijo legacy "1" de móvil (521...) que WhatsApp
 * todavía devuelve en algunos formatos.
 *
 * Devuelve null si no se puede interpretar como un número mexicano de 10
 * dígitos. El `username` es la forma sin "+" para poder usarlo como
 * identificador de login (Strapi acepta email o username en /auth/local).
 */
function normalizeMxPhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return null;

  // Ojo: un número de EE.UU. como 1-415-555-1234 también son 11 dígitos con
  // "1" al frente y se interpretaría como mexicano. El producto es solo Jalisco,
  // así que se asume MX; si algún día se abre a otros países hay que pedir lada.
  if (digits.length === 13 && digits.startsWith('521')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);

  if (digits.length !== 10) return null;
  if (digits.startsWith('0')) return null;

  return {
    national: digits,
    e164: `+52${digits}`,
    username: `52${digits}`,
  };
}

module.exports = { normalizeMxPhone };
