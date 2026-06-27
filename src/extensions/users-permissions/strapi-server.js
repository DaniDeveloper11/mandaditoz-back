'use strict';

const ALLOWED_UPDATE_FIELDS = ['displayName', 'phone', 'bio', 'avatar'];

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

    try {
      await userService.sendConfirmationEmail(newUser);
    } catch (err) {
      strapi.log.error(`[register-owner] error enviando email de confirmacion: ${err.message}`);
    }

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
