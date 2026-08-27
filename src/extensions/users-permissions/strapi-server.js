'use strict';

const { normalizeMxPhone } = require('../../utils/phone');

const ALLOWED_UPDATE_FIELDS = ['displayName', 'phone', 'bio', 'avatar'];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = (plugin) => {
  plugin.controllers.user.registerOwner = async (ctx) => {
    const { username, email, password, displayName, phone } = ctx.request.body;

    if (!username || !email || !password) {
      return ctx.badRequest('username, email y password son requeridos');
    }

    const businessOwnerRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { name: 'BusinessOwner' } });

    if (!businessOwnerRole) {
      return ctx.internalServerError('El rol BusinessOwner no existe, créalo en el panel de Strapi');
    }

    const existing = await strapi
      .query('plugin::users-permissions.user')
      .findOne({ where: { email } });

    if (existing) {
      return ctx.badRequest('Ya existe un usuario con ese email');
    }

    const userService = strapi.plugin('users-permissions').service('user');

    const newUser = await userService.add({
      username,
      email: email.toLowerCase(),
      password,
      provider: 'local',
      displayName: displayName || null,
      phone: phone || null,
      confirmed: false,
      blocked: false,
      role: businessOwnerRole.id,
    });

    strapi.log.info(`[register-owner] usuario creado: id=${newUser.id} email=${newUser.email} provider=${newUser.provider} confirmed=${newUser.confirmed}`);

    const dbUser = await strapi.db.query('plugin::users-permissions.user').findOne({ where: { id: newUser.id } });
    strapi.log.info(`[register-owner] DB check: hasPassword=${!!dbUser.password} provider=${dbUser.provider} confirmed=${dbUser.confirmed}`);

    userService.sendConfirmationEmail(newUser)
      .then(() => strapi.log.info(`[register-owner] email enviado a ${newUser.email}`))
      .catch((err) => strapi.log.error(`[register-owner] error enviando email a ${newUser.email}: ${err.code || ''} ${err.message}`));

    return ctx.send({
      message: 'Registro exitoso. Revisa tu correo para confirmar tu cuenta.',
    });
  };

  plugin.routes['content-api'].routes.push({
    method: 'POST',
    path: '/auth/register-owner',
    handler: 'user.registerOwner',
    config: {
      prefix: '',
      auth: false,
      policies: [],
      middlewares: [],
    },
  });

  /**
   * Registro exprés de comensal.
   *
   * A diferencia de register-owner, aquí el correo NO es un candado: el
   * comensal queda con `confirmed: true` y entra de inmediato, porque el
   * registro ocurre a medio pedido y mandarlo a su bandeja de entrada mata la
   * conversión. `emailVerified` guarda el dato real de si ya comprobó el correo
   * y es lo que se usa para recordarle después.
   *
   * El WhatsApp es la identidad real del comensal, así que se guarda también
   * como `username`: /auth/local acepta email o username como identifier, de
   * modo que puede iniciar sesión con su número si tecleó mal el correo.
   */
  plugin.controllers.user.registerCustomer = async (ctx) => {
    const { displayName, email, password, phone } = ctx.request.body ?? {};

    const name = String(displayName ?? '').trim();
    if (name.length < 2) return ctx.badRequest('Escribe tu nombre.');

    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) return ctx.badRequest('El correo no es válido.');

    if (typeof password !== 'string' || password.length < 8) {
      return ctx.badRequest('La contraseña debe tener al menos 8 caracteres.');
    }

    const mx = normalizeMxPhone(phone);
    if (!mx) return ctx.badRequest('Escribe tu WhatsApp a 10 dígitos.');

    const authenticatedRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'authenticated' } });

    if (!authenticatedRole) {
      return ctx.internalServerError('El rol Authenticated no existe.');
    }

    const [byEmail, byPhone] = await Promise.all([
      strapi.query('plugin::users-permissions.user').findOne({ where: { email: normalizedEmail } }),
      strapi.query('plugin::users-permissions.user').findOne({ where: { username: mx.username } }),
    ]);

    if (byEmail) return ctx.badRequest('Ya hay una cuenta con ese correo. Inicia sesión.');
    if (byPhone) return ctx.badRequest('Ya hay una cuenta con ese WhatsApp. Inicia sesión.');

    const userService = strapi.plugin('users-permissions').service('user');

    const newUser = await userService.add({
      username: mx.username,
      email: normalizedEmail,
      password,
      provider: 'local',
      displayName: name,
      phone: mx.e164,
      confirmed: true,
      emailVerified: false,
      blocked: false,
      role: authenticatedRole.id,
    });

    // Recordatorio, no candado: si el envío falla el registro sigue siendo
    // válido y el usuario ya puede pedir. Por eso no se hace await.
    userService
      .sendConfirmationEmail(newUser)
      .catch((err) =>
        strapi.log.error(`[register-customer] error enviando confirmación a ${newUser.email}: ${err.code || ''} ${err.message}`)
      );

    strapi.log.info(`[register-customer] usuario creado: id=${newUser.id} phone=${newUser.phone}`);

    const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: newUser.id });
    const { password: _pw, resetPasswordToken, confirmationToken, ...safeUser } = newUser;

    return ctx.send({ jwt, user: safeUser });
  };

  plugin.routes['content-api'].routes.push({
    method: 'POST',
    path: '/auth/register-customer',
    handler: 'user.registerCustomer',
    config: {
      prefix: '',
      auth: false,
      policies: [],
      middlewares: [],
    },
  });

  /**
   * El `me` del plugin ignora `?populate`, así que el rol nunca llegaba al
   * cliente. El frontend lo necesita para saber si la cuenta ya es de negocio
   * (por ejemplo, después de que publicar un negocio la asciende).
   */
  const originalMe = plugin.controllers.user.me;
  plugin.controllers.user.me = async (ctx) => {
    await originalMe(ctx);

    const userId = ctx.state.user?.id;
    if (!userId || !ctx.body || typeof ctx.body !== 'object') return;

    const withRole = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: userId },
      populate: { role: true },
    });
    if (withRole?.role) {
      const { id, name, type } = withRole.role;
      ctx.body.role = { id, name, type };
    }
  };

  plugin.controllers.user.updateMe = async (ctx) => {
    const user = ctx.state.user;

    if (!user) return ctx.unauthorized();

    const body = ctx.request.body;
    const data = {};

    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (body[field] !== undefined) {
        data[field] = body[field];
      }
    }

    const updated = await strapi.entityService.update(
      'plugin::users-permissions.user',
      user.id,
      { data, populate: ['avatar', 'role'] }
    );

    const { password, resetPasswordToken, confirmationToken, ...safeUser } = updated;

    return ctx.send(safeUser);
  };

  plugin.routes['content-api'].routes.push({
    method: 'PUT',
    path: '/users/me',
    handler: 'user.updateMe',
    config: {
      prefix: '',
      policies: [],
      middlewares: [],
    },
  });

  return plugin;
};
