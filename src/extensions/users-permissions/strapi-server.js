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

  // ---------------------------------------------------------------------------
  // Outreach claim flow
  // ---------------------------------------------------------------------------

  async function loadBusinessByToken(slug, token) {
    if (!slug || !token) return { error: 'Slug y token son requeridos', status: 400 };

    const [business] = await strapi.entityService.findMany('api::business.business', {
      filters: { slug },
      populate: ['owner'],
    });

    if (!business) return { error: 'Negocio no encontrado', status: 404 };
    if (business.outreachToken !== token) return { error: 'Token inválido', status: 403 };
    if (!business.outreachTokenExpiresAt || new Date(business.outreachTokenExpiresAt) < new Date()) {
      return { error: 'Token expirado', status: 403 };
    }
    if (business.owner) return { error: 'Este negocio ya tiene dueño', status: 409 };
    if (business.ownershipStatus !== 'unclaimed') {
      return { error: 'Este negocio ya está en proceso de reclamo o reclamado', status: 409 };
    }
    return { business };
  }

  async function createClaimFromOutreach({ business, user }) {
    return strapi.documents('api::claim.claim').create({
      data: {
        business: business.id,
        user: user.id,
        claimantName: user.displayName || user.username,
        claimantRole: 'owner',
        claimantPhone: business.outreachPhone || '',
        origin: 'outreach',
        outreachPhone: business.outreachPhone || null,
        claimStatus: 'pending',
      },
      populate: ['business'],
    });
  }

  async function invalidateOutreachToken(businessDocumentId) {
    await strapi.documents('api::business.business').update({
      documentId: businessDocumentId,
      data: { outreachToken: null, outreachTokenExpiresAt: null },
    });
  }

  function issueJwt(userId) {
    return strapi.plugin('users-permissions').service('jwt').issue({ id: userId });
  }

  function sanitizeUser(u) {
    if (!u) return null;
    const { password, resetPasswordToken, confirmationToken, ...safe } = u;
    return safe;
  }

  function respondError(ctx, status, body) {
    ctx.status = status;
    ctx.body = body;
    return;
  }

  plugin.controllers.user.claimFromOutreach = async (ctx) => {
    const { slug, token, name, email, password, acceptedTerms } = ctx.request.body || {};

    if (!name || !email || !password) {
      return ctx.badRequest('name, email y password son requeridos');
    }
    if (!acceptedTerms) {
      return ctx.badRequest('Debes aceptar los términos y la política de privacidad');
    }

    const { business, error, status } = await loadBusinessByToken(slug, token);
    if (error) return respondError(ctx, status, { error });

    const emailLower = String(email).toLowerCase();
    const existing = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { email: emailLower } });

    if (existing) {
      return respondError(ctx, 409, { error: 'Ya existe una cuenta con este email', needsLogin: true });
    }

    const businessOwnerRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { name: 'BusinessOwner' } });

    if (!businessOwnerRole) {
      return ctx.internalServerError('El rol BusinessOwner no existe');
    }

    const userService = strapi.plugin('users-permissions').service('user');

    const newUser = await userService.add({
      username: emailLower,
      email: emailLower,
      password,
      provider: 'local',
      displayName: name,
      confirmed: true,
      blocked: false,
      role: businessOwnerRole.id,
    });

    strapi.log.info(`[claim-from-outreach] user creado id=${newUser.id} email=${newUser.email} business=${business.documentId}`);

    const claim = await createClaimFromOutreach({ business, user: newUser });
    await invalidateOutreachToken(business.documentId);

    ctx.body = {
      jwt: issueJwt(newUser.id),
      user: sanitizeUser(newUser),
      claim: { documentId: claim.documentId, claimStatus: claim.claimStatus },
    };
  };

  plugin.controllers.user.claimLinkExisting = async (ctx) => {
    const { slug, token, email, password } = ctx.request.body || {};

    if (!email || !password) {
      return ctx.badRequest('email y password son requeridos');
    }

    const { business, error, status } = await loadBusinessByToken(slug, token);
    if (error) return respondError(ctx, status, { error });

    const emailLower = String(email).toLowerCase();
    const dbUser = await strapi.db
      .query('plugin::users-permissions.user')
      .findOne({ where: { email: emailLower, provider: 'local' } });

    if (!dbUser || !dbUser.password) {
      return respondError(ctx, 401, { error: 'Credenciales inválidas' });
    }

    const bcrypt = require('bcryptjs');
    const ok = await bcrypt.compare(password, dbUser.password);
    if (!ok) return respondError(ctx, 401, { error: 'Credenciales inválidas' });

    if (dbUser.blocked) return respondError(ctx, 403, { error: 'Cuenta bloqueada' });

    const claim = await createClaimFromOutreach({ business, user: dbUser });
    await invalidateOutreachToken(business.documentId);

    strapi.log.info(`[claim-link-existing] user id=${dbUser.id} reclamó business=${business.documentId}`);

    ctx.body = {
      jwt: issueJwt(dbUser.id),
      user: sanitizeUser(dbUser),
      claim: { documentId: claim.documentId, claimStatus: claim.claimStatus },
    };
  };

  plugin.routes['content-api'].routes.push({
    method: 'POST',
    path: '/claims/from-outreach',
    handler: 'user.claimFromOutreach',
    config: { prefix: '', auth: false, policies: [], middlewares: [] },
  });

  plugin.routes['content-api'].routes.push({
    method: 'POST',
    path: '/claims/link-existing',
    handler: 'user.claimLinkExisting',
    config: { prefix: '', auth: false, policies: [], middlewares: [] },
  });

  return plugin;
};
