'use strict';

// Traduce al español los mensajes de error que Strapi y sus plugins devuelven
// en inglés. Se coloca DESPUÉS de `strapi::errors` para interceptar el body ya
// serializado (`{ data: null, error: { status, name, message, details } }`).
//
// Estrategia en dos pasos:
//   1. Match exacto en el diccionario `EXACT`.
//   2. Match por patrón (regex) en `PATTERNS` para mensajes con variables
//      (ej. validaciones de yup: "email must be a valid email").
// Si no hay match, el mensaje se deja tal cual.

const EXACT = {
  // users-permissions — auth local
  'Invalid identifier or password': 'Correo o contraseña incorrectos',
  'Your account email is not confirmed': 'Tu correo aún no ha sido confirmado',
  'Your account has been blocked by an administrator': 'Tu cuenta ha sido bloqueada por un administrador',
  'Email is already taken': 'Este correo ya está registrado',
  'Email or Username are already taken': 'El correo o nombre de usuario ya están registrados',
  'Username already taken': 'Este nombre de usuario ya está en uso',
  'Please provide valid email or username': 'Ingresa un correo o usuario válido',
  'This user never set a local password': 'Este usuario no tiene contraseña local configurada',
  'Missing or invalid credentials': 'Credenciales faltantes o inválidas',
  'Incorrect code provided': 'El código proporcionado es incorrecto',
  'Incorrect params provided': 'Los datos proporcionados son incorrectos',
  'Passwords do not match': 'Las contraseñas no coinciden',
  'Impossible to find the private key': 'No se pudo encontrar la clave privada',
  'Invalid token': 'Token inválido',
  'Invalid confirmation token': 'Token de confirmación inválido',
  'It is disabled to register new users': 'El registro de nuevos usuarios está deshabilitado',
  'Default role not found': 'Rol por defecto no encontrado',
  'Impossible to register the user': 'No se pudo registrar el usuario',
  'Register action is currently disabled': 'El registro está temporalmente deshabilitado',
  'Email confirmation is disabled': 'La confirmación de correo está deshabilitada',
  'already.confirmed': 'La cuenta ya está confirmada',
  'wrong.email': 'El correo es incorrecto',
  'wrong.token': 'El token es incorrecto',

  // HTTP genéricos
  'Forbidden': 'No tienes permiso para realizar esta acción',
  'Unauthorized': 'No autorizado',
  'Not Found': 'Recurso no encontrado',
  'Method Not Allowed': 'Método no permitido',
  'Bad Request': 'Solicitud inválida',
  'Internal Server Error': 'Error interno del servidor',
  'Too Many Requests': 'Demasiadas solicitudes, intenta más tarde',
  'Payload Too Large': 'El contenido es demasiado grande',
  'Unsupported Media Type': 'Tipo de contenido no soportado',

  // Auth headers / JWT
  'Missing or invalid token': 'Token faltante o inválido',
  'Missing or invalid credentials.': 'Credenciales faltantes o inválidas',
  'No authorization header was found': 'No se encontró el encabezado de autorización',
  'Token expired': 'El token ha expirado',
  'jwt expired': 'La sesión ha expirado, inicia sesión nuevamente',
  'jwt malformed': 'Token malformado',
  'invalid signature': 'Firma del token inválida',

  // Policy / ownership propios
  'Policy Failed': 'No tienes permiso para realizar esta acción',
};

// Cada patrón: [regex, función que recibe los grupos y devuelve el texto ES]
const PATTERNS = [
  // yup — requeridos
  [/^(.+) is a required field$/i, (m) => `El campo "${m[1]}" es obligatorio`],
  [/^(.+) must be defined$/i,     (m) => `El campo "${m[1]}" es obligatorio`],

  // yup — email / string / número
  [/^(.+) must be a valid email$/i, (m) => `"${m[1]}" debe ser un correo válido`],
  [/^(.+) must be at least (\d+) characters?$/i, (m) => `"${m[1]}" debe tener al menos ${m[2]} caracteres`],
  [/^(.+) must be at most (\d+) characters?$/i,  (m) => `"${m[1]}" no debe superar los ${m[2]} caracteres`],
  [/^(.+) must be a `?number`?/i, (m) => `"${m[1]}" debe ser un número`],
  [/^(.+) must be a `?string`?/i, (m) => `"${m[1]}" debe ser un texto`],
  [/^(.+) must match the following/i, (m) => `El formato de "${m[1]}" no es válido`],
  [/^(.+) must be one of the following values: (.+)$/i,
    (m) => `"${m[1]}" debe ser uno de: ${m[2]}`],

  // Strapi — unique constraint
  [/^This attribute must be unique$/i, () => 'Este valor ya está en uso'],
  [/^(.+) must be unique$/i, (m) => `"${m[1]}" ya está en uso`],

  // Strapi — relaciones / entidades
  [/^(\d+) relation\(s\) of type (.+) associated with this entity do not exist$/i,
    (m) => `${m[1]} relación(es) del tipo "${m[2]}" no existen`],
  [/^Invalid key (.+)$/i, (m) => `Campo inválido: "${m[1]}"`],
  [/^Invalid relations$/i, () => 'Relaciones inválidas'],

  // Not found genérico
  [/^(.+) not found$/i, (m) => `${m[1]} no encontrado`],
];

function translate(message) {
  if (typeof message !== 'string' || !message.length) return message;
  if (EXACT[message]) return EXACT[message];
  for (const [rx, fn] of PATTERNS) {
    const m = message.match(rx);
    if (m) return fn(m);
  }
  return message;
}

// Camina el objeto `details` (validaciones anidadas de yup: details.errors[i].message)
function walkDetails(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(walkDetails);
    return;
  }
  if (typeof node.message === 'string') {
    node.message = translate(node.message);
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === 'object') walkDetails(value);
  }
}

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    await next();

    const body = ctx.body;
    if (!body || typeof body !== 'object' || !body.error) return;

    const err = body.error;
    if (typeof err.message === 'string') {
      err.message = translate(err.message);
    }
    if (err.details) walkDetails(err.details);
  };
};
