'use strict';

const { normalizeMxPhone } = require('../../utils/phone');
const { safeRedirectPath } = require('../../utils/redirect');
const { verifyGoogleIdToken } = require('../../utils/google-auth');

const ALLOWED_UPDATE_FIELDS = ['displayName', 'phone', 'bio', 'avatar'];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * `username` es único y obligatorio (mínimo 3), pero en un alta con Google no lo
 * elige nadie: se deriva del correo. Dos personas distintas con `juan@gmail.com`
 * y `juan@hotmail.com` chocarían, así que se desempata con un sufijo.
 */
async function usernameDisponible(base) {
  const limpio = String(base).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
  const raiz = limpio.length >= 3 ? limpio : `usuario${limpio}`;

  for (let intento = 0; intento < 5; intento += 1) {
    const candidato = intento === 0 ? raiz : `${raiz}${1000 + Math.floor(Math.random() * 9000)}`;
    const ocupado = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { username: candidato }, select: ['id'] });
    if (!ocupado) return candidato;
  }

  // Cinco colisiones seguidas no pasan por azar; antes de fallar el registro se
  // entrega algo que no puede chocar.
  return `${raiz}-${Date.now().toString(36)}`;
}

module.exports = (plugin) => {
  plugin.controllers.user.registerOwner = async (ctx) => {
    const { username, email, password, displayName, phone, redirect } = ctx.request.body;

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
      // A donde iba el usuario antes de que le pidieramos crear cuenta (p.ej.
      // la ficha que venia a reclamar). Se guarda aqui y no en el cliente
      // porque el correo de confirmacion se abre cuando y donde sea, y al
      // volver por el 302 de Strapi no queda ni query ni sesion que consultar.
      pendingRedirect: safeRedirectPath(redirect),
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
   * Confirmacion de correo: devolver al usuario a donde iba.
   *
   * El controlador del plugin confirma la cuenta y hace un 302 ciego hacia
   * `email_confirmation_redirection`, una URL fija que vive en la base. El que
   * venia a reclamar su negocio aterrizaba en una pagina sin query ni sesion, y
   * el rastro de su intencion se perdia ahi. Aqui se recupera el
   * `pendingRedirect` que guardo register-owner y se cuelga del 302 como `?to=`.
   *
   * OJO con la forma: a diferencia de `user`, que el plugin exporta como objeto
   * plano (y por eso mas abajo se puede envolver `user.me` directamente), el
   * controlador `auth` se exporta como FABRICA: `({ strapi }) => ({ ... })`.
   * Asignar sobre `plugin.controllers.auth.emailConfirmation` no sobrescribe
   * nada, solo le cuelga una propiedad a la funcion, y el envoltorio jamas se
   * ejecuta. Hay que envolver la fabrica y parchear el objeto que devuelve.
   */
  const authControllerFactory = plugin.controllers.auth;

  plugin.controllers.auth = (context) => {
    const controller = authControllerFactory(context);
    const originalEmailConfirmation = controller.emailConfirmation;

    // El tercer argumento es `returnUser`: cuando viene en true (lo usa la
    // mutacion de GraphQL) el controlador responde con JSON en vez de redirigir,
    // asi que hay que pasarlo tal cual o se rompe ese camino.
    controller.emailConfirmation = async (ctx, next, returnUser) => {
      // Hay que leer al usuario ANTES: el controlador original limpia
      // confirmationToken, y despues ya no hay forma de saber quien confirmo.
      const token = ctx.query.confirmation;
      const user = token
        ? await strapi.db
            .query('plugin::users-permissions.user')
            .findOne({ where: { confirmationToken: token } })
        : null;

      await originalEmailConfirmation(ctx, next, returnUser);

      const destino = safeRedirectPath(user?.pendingRedirect);
      if (!destino) return;

      // El original ya hizo ctx.redirect(...); aqui solo se le cuelga el
      // destino. Se concatena a mano en vez de usar URL() porque ese ajuste vive
      // en la base y podria estar guardado como ruta relativa, con la que el
      // constructor lanzaria.
      const location = ctx.response.get('Location');
      if (!location || ctx.status < 300 || ctx.status >= 400) return;

      const sep = location.includes('?') ? '&' : '?';
      ctx.redirect(`${location}${sep}to=${encodeURIComponent(destino)}`);

      // De un solo uso, y solo se borra cuando de verdad se entrego: si el
      // usuario ya va camino a su destino y esto falla, se registra y se sigue.
      try {
        await strapi.db
          .query('plugin::users-permissions.user')
          .update({ where: { id: user.id }, data: { pendingRedirect: null } });
      } catch (err) {
        strapi.log.error(
          `[email-confirmation] no se pudo limpiar pendingRedirect de ${user.id}: ${err.message}`
        );
      }
    };

    return controller;
  };

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

  /**
   * POST /api/auth/google — inicio de sesión / registro con cuenta de Google.
   *
   * Un solo endpoint para los dos clientes: la web obtiene el `idToken` con
   * Google Identity Services y la app Android con el plugin nativo (que pide el
   * token con el mismo *client id* web, por eso el `aud` coincide). No se usa el
   * flujo `/api/connect/google` de Strapi porque ese es una cadena de redirects
   * que no existe dentro del WebView de Capacitor — y Google bloquea OAuth en
   * WebViews, así que ahí nunca habría funcionado.
   *
   * Devuelve `{ jwt, user }` igual que `/auth/local`: el usuario entra de una vez.
   * No hay correo de confirmación que mandar — Google ya verificó la dirección, y
   * eso es exactamente lo que ese correo comprueba.
   */
  plugin.controllers.user.loginWithGoogle = async (ctx) => {
    const { idToken } = ctx.request.body ?? {};

    let profile;
    try {
      profile = await verifyGoogleIdToken(idToken);
    } catch (err) {
      if (err.cause) {
        strapi.log.warn(`[auth-google] token rechazado: ${err.cause.message}`);
      }
      return ctx.badRequest(err.message);
    }

    const userQuery = strapi.db.query('plugin::users-permissions.user');

    // Puede haber más de una fila con el mismo correo si en algún momento se
    // apagó `unique_email`, así que se buscan todas y se elige por proveedor.
    const matches = await userQuery.findMany({ where: { email: profile.email } });

    // Orden de preferencia: la cuenta que ya nació de Google, y si no, la local.
    //
    // Entrar a la cuenta local es una VINCULACIÓN deliberada, no un descuido: el
    // correo está verificado por Google (se exige arriba) y es el mismo buzón al
    // que llega el enlace de "olvidé mi contraseña". Quien controla ese correo ya
    // podía entrar; esto solo le ahorra el rodeo. La fila no se toca más de la
    // cuenta: `provider` sigue siendo `local` y la contraseña sigue sirviendo,
    // porque `/auth/local` filtra por `provider = 'local'` y cambiarlo dejaría al
    // usuario sin su forma original de entrar.
    let user =
      matches.find((u) => u.provider === 'google') ??
      matches.find((u) => u.provider === 'local') ??
      matches[0];

    if (user) {
      if (user.blocked) {
        return ctx.forbidden('Tu cuenta ha sido bloqueada por un administrador');
      }

      // Google acaba de comprobar el correo. Si la cuenta seguía esperando el
      // clic del email de confirmación, esto la desbloquea: es la misma prueba.
      const parche = {};
      if (!user.confirmed)     parche.confirmed = true;
      if (!user.emailVerified) parche.emailVerified = true;
      if (!user.displayName && profile.name) parche.displayName = profile.name;

      if (Object.keys(parche).length) {
        user = await userQuery.update({ where: { id: user.id }, data: parche });
      }

      strapi.log.info(`[auth-google] login id=${user.id} provider=${user.provider}`);
    } else {
      const defaultRole = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { type: 'authenticated' },
      });
      if (!defaultRole) {
        return ctx.internalServerError('El rol Authenticated no existe.');
      }

      // Se crea con `strapi.db.query`, no con `userService.add()`: este usuario no
      // tiene contraseña y el Document Service no aporta nada aquí. El lifecycle
      // `beforeCreate` de `src/index.js` ve `provider !== 'local'` + `confirmed`
      // y pone `emailVerified` solo; se manda explícito de todos modos para que
      // el registro no dependa de ese orden.
      //
      // Nace como `Authenticated` (comensal) aunque venga a publicar un negocio:
      // los roles son niveles acumulativos y el `afterCreate` de `business` lo
      // asciende a BusinessOwner en cuanto publique el primero.
      user = await userQuery.create({
        data: {
          username: await usernameDisponible(profile.email.split('@')[0]),
          email: profile.email,
          provider: 'google',
          displayName: profile.name,
          confirmed: true,
          emailVerified: true,
          blocked: false,
          role: defaultRole.id,
        },
      });

      strapi.log.info(`[auth-google] usuario creado id=${user.id} email=${user.email}`);
    }

    const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
    const { password, resetPasswordToken, confirmationToken, ...safeUser } = user;

    return ctx.send({ jwt, user: safeUser });
  };

  plugin.routes['content-api'].routes.push({
    method: 'POST',
    path: '/auth/google',
    handler: 'user.loginWithGoogle',
    config: {
      prefix: '',
      auth: false,
      policies: [],
      // El mismo limitador que el plugin pone en `/auth/local`: el endpoint es
      // público y verificar un JWT contra las llaves de Google cuesta CPU.
      middlewares: ['plugin::users-permissions.rateLimit'],
    },
  });

  return plugin;
};
