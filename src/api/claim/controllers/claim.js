'use strict';
const { factories } = require('@strapi/strapi');
const { normalizeMxPhone } = require('../../../utils/phone');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * "3865551289" -> "386 ••• •• 89". Se enseña en la pantalla de reclamo para que
 * el dueño reconozca su propio número sin que la ficha publique uno nuevo.
 */
function maskPhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 3)} ••• •• ${digits.slice(-2)}`;
}

/**
 * Resuelve el estado de una invitación. El token NO se borra al canjearse: el
 * candado de un solo uso es `ownershipStatus`, y así se puede distinguir "ya lo
 * usaron" de "este enlace no existe". Si un reclamo se rechaza, el negocio
 * vuelve a `unclaimed` y el mismo enlace sirve otra vez, que es lo que quieres
 * cuando alguien se equivocó de dato.
 */
function inviteStatus(business) {
  if (!business) return 'not_found';
  if (business.ownershipStatus !== 'unclaimed' || business.owner) return 'used';
  const expira = business.outreachTokenExpiresAt;
  if (expira && new Date(expira).getTime() < Date.now()) return 'expired';
  return 'valid';
}

async function findByToken(strapi, token) {
  if (!token) return null;
  return strapi.db.query('api::business.business').findOne({
    where: { outreachToken: token },
    populate: { city: true, category: true, owner: true },
  });
}

module.exports = factories.createCoreController('api::claim.claim', ({ strapi }) => ({
  async create(ctx) {
    await this.validateQuery(ctx);
    const sanitizedData = await this.sanitizeInput(ctx.request.body.data, ctx);

    const entity = await strapi.documents('api::claim.claim').create({
      data: {
        ...sanitizedData,
        user: ctx.state.user.id,
        // El origen no lo decide el cliente: por esta vía siempre es el
        // formulario de la ficha. Los de invitación los marca redeemInvite.
        claimSource: 'form',
      },
      populate: ctx.query?.populate,
    });

    const sanitizedResult = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedResult);
  },

  /**
   * GET /api/claims/invite/:token
   *
   * Devuelve lo justo para pintar la pantalla y que el dueño reconozca su
   * negocio. Nunca devuelve el token ni el teléfono completo: lo que ya es
   * público sale entero, lo demás enmascarado.
   */
  async invite(ctx) {
    const token = String(ctx.params.token ?? '').trim();
    const business = await findByToken(strapi, token);
    const status = inviteStatus(business);

    if (status === 'not_found') {
      return ctx.send({ status });
    }

    return ctx.send({
      status,
      business: {
        name: business.name,
        slug: business.slug,
        citySlug: business.city?.slug ?? null,
        cityName: business.city?.name ?? null,
        categoryName: business.category?.name ?? null,
        phoneMasked: maskPhone(business.outreachPhone),
      },
    });
  },

  /**
   * POST /api/claims/invite/:token/redeem
   *
   * Crea (o reutiliza) la cuenta y **entrega el negocio en el momento**. No hay
   * aprobación manual de por medio: exigirla ponía un candado justo en el minuto
   * de más interés, y sin poder editar su ficha el dueño no vuelve.
   *
   * Lo que sustituye a la revisión previa: el enlace es de un solo uso, vence a
   * los 30 días, se mandó al teléfono que YA estaba publicado en la ficha, y al
   * admin le llega aviso inmediato con opción de revocar (rechazar el reclamo
   * ahora quita la propiedad de verdad).
   *
   * El correo NO se confirma antes de entrar. Mismo criterio que
   * /auth/register-customer: quien está reclamando su negocio ya demostró más
   * de lo que demuestra un correo —tiene el enlace que se mandó al teléfono
   * publicado en la ficha— y mandarlo a su bandeja aquí es perderlo.
   */
  async redeemInvite(ctx) {
    const token = String(ctx.params.token ?? '').trim();
    const business = await findByToken(strapi, token);
    const status = inviteStatus(business);

    if (status !== 'valid') {
      return ctx.badRequest('Esta invitación ya no es válida.', { status });
    }

    const body = ctx.request.body?.data ?? ctx.request.body ?? {};
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = body.password;
    const displayName = String(body.displayName ?? '').trim();

    if (!EMAIL_RE.test(email)) return ctx.badRequest('El correo no es válido.');
    if (typeof password !== 'string' || password.length < 8) {
      return ctx.badRequest('La contraseña debe tener al menos 8 caracteres.');
    }

    const userService = strapi.plugin('users-permissions').service('user');
    const userQuery = strapi.db.query('plugin::users-permissions.user');

    let user = await userQuery.findOne({ where: { email } });

    if (user) {
      // Cuenta existente: un dueño puede tener varias fichas y no tiene por qué
      // crear una cuenta nueva por cada una.
      const ok = await userService.validatePassword(password, user.password);
      if (!ok) return ctx.badRequest('Ya hay una cuenta con ese correo, pero la contraseña no coincide.');
      if (user.blocked) return ctx.badRequest('Esa cuenta está bloqueada.');
    } else {
      const authenticatedRole = await strapi
        .db.query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } });
      if (!authenticatedRole) return ctx.internalServerError('El rol Authenticated no existe.');

      // La identidad natural aquí es el teléfono al que se mandó la invitación.
      // Si ese username ya está tomado (otra cuenta con el mismo número), se cae
      // al correo: el username solo tiene que ser único y servir para /auth/local.
      const mx = normalizeMxPhone(business.outreachPhone);
      let username = mx?.username ?? email;
      if (await userQuery.findOne({ where: { username } })) username = email;

      user = await userService.add({
        username,
        email,
        password,
        provider: 'local',
        displayName: displayName || business.name,
        phone: mx?.e164 ?? null,
        confirmed: true,
        emailVerified: false,
        blocked: false,
        role: authenticatedRole.id,
      });

      // Recordatorio, no candado: si el envío falla el reclamo sigue en pie.
      userService
        .sendConfirmationEmail(user)
        .catch((err) =>
          strapi.log.error(`[claim.redeem] error enviando confirmación a ${user.email}: ${err.code || ''} ${err.message}`)
        );
    }

    // Se crea y se aprueba en dos pasos a propósito. Toda la lógica de "qué
    // significa aprobar" —asignar owner, marcar verificado, ascender el rol,
    // avisar al dueño— vive en el afterUpdate de claim/lifecycles.js. Duplicarla
    // aquí sería tener dos verdades que se van a desincronizar.
    const claim = await strapi.documents('api::claim.claim').create({
      data: {
        business: business.documentId,
        user: user.id,
        claimantName: displayName || user.displayName || business.name,
        claimantRole: 'owner',
        claimantPhone: business.outreachPhone,
        claimSource: 'outreach_token',
        claimStatus: 'pending',
        notes: 'Reclamo por enlace de invitación enviado por WhatsApp. Aprobado automáticamente.',
      },
    });

    await strapi.documents('api::claim.claim').update({
      documentId: claim.documentId,
      data: { claimStatus: 'approved' },
    });

    strapi.log.info(`[claim.redeem] negocio ${business.documentId} entregado a user ${user.id}`);

    // Releer al usuario: el lifecycle acaba de ascenderlo a BusinessOwner y la
    // copia que tenemos en memoria todavía trae el rol viejo.
    const actualizado = await userQuery.findOne({ where: { id: user.id }, populate: { role: true } });

    const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: user.id });
    const { password: _pw, resetPasswordToken, confirmationToken, ...safeUser } = actualizado ?? user;

    return ctx.send({
      jwt,
      user: safeUser,
      business: {
        name: business.name,
        slug: business.slug,
        citySlug: business.city?.slug ?? null,
      },
    });
  },
}));
