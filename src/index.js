'use strict';

// Permisos otorgados a cada rol en bootstrap.
// Se aplican de forma idempotente: solo crea permisos que no existen.

const PUBLIC_PERMISSIONS = {
  'api::business.business': ['find', 'findOne', 'submit'],
  'api::business-event.business-event': ['track'],
  'api::contact-message.contact-message': ['submit'],
  'plugin::upload': ['content-api.upload'],
  'api::business-hour.business-hour': ['find', 'findOne'],
  'api::business-hour-exception.business-hour-exception': ['find', 'findOne'],
  'api::category.category': ['find', 'findOne'],
  'api::city.city': ['find', 'findOne'],
  'api::neighborhood.neighborhood': ['find', 'findOne'],
  'api::photo.photo': ['find', 'findOne'],
  'api::menu-section.menu-section': ['find', 'findOne'],
  'api::menu-item.menu-item': ['find', 'findOne'],
  'api::review.review': ['find', 'findOne', 'submit'],
  'api::state.state': ['find', 'findOne'],
  'api::tag.tag': ['find', 'findOne'],
  'plugin::users-permissions.auth': [
    'callback',
    'connect',
    'emailConfirmation',
    'forgotPassword',
    'refresh',
    'register',
    'resetPassword',
    'sendEmailConfirmation',
  ],
  'plugin::users-permissions.user': ['create', 'me'],
};

// Nota: los permisos son por rol, no acumulativos en Strapi. Todo lo que el
// rol Public puede leer tiene que estar también aquí, o la misma pantalla que
// funciona sin sesión devuelve 403 al iniciar sesión como comensal.
const AUTHENTICATED_PERMISSIONS = {
  // 'create': un comensal puede publicar su propio negocio. El lifecycle
  // afterCreate de business lo asciende a BusinessOwner en ese momento.
  'api::business.business': ['create', 'find', 'findOne', 'update', 'delete', 'mine'],
  'api::business-event.business-event': ['track', 'statsForBusiness'],
  'api::business-hour.business-hour': ['find', 'findOne'],
  'api::business-hour-exception.business-hour-exception': ['find', 'findOne'],
  'api::contact-message.contact-message': ['submit'],
  'api::category.category': ['find', 'findOne'],
  'api::city.city': ['find', 'findOne'],
  'api::state.state': ['find', 'findOne'],
  'api::neighborhood.neighborhood': ['find', 'findOne'],
  'api::tag.tag': ['find', 'findOne'],
  'api::photo.photo': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::menu-section.menu-section': ['find', 'findOne', 'create', 'update', 'delete'],
  'api::menu-item.menu-item': ['find', 'findOne', 'create', 'update', 'delete'],
  // Sin 'update' ni 'delete': el core router de order no los expone y todo
  // cambio de estado pasa por rutas que validan la transición.
  'api::order.order': ['create', 'find', 'findOne', 'cancel'],
  'api::claim.claim': ['create', 'find', 'findOne'],
  'api::report.report': ['create'],
  'api::review.review': ['find', 'findOne', 'create', 'update', 'delete', 'respond'],
  'plugin::upload': ['content-api.upload'],
  'plugin::users-permissions.auth': ['changePassword', 'logout'],
  'plugin::users-permissions.user': ['me', 'updateMe'],
};

const BUSINESS_OWNER_PERMISSIONS = {
  'api::business.business': ['create', 'find', 'findOne', 'update', 'delete', 'mine'],
  'api::business-event.business-event': ['statsForBusiness'],
  'api::business-hour.business-hour': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::business-hour-exception.business-hour-exception': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::category.category': ['find', 'findOne'],
  'api::city.city': ['find', 'findOne'],
  'api::neighborhood.neighborhood': ['find', 'findOne'],
  'api::tag.tag': ['find', 'findOne'],
  'api::photo.photo': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::menu-section.menu-section': ['find', 'findOne', 'create', 'update', 'delete'],
  'api::menu-item.menu-item': ['find', 'findOne', 'create', 'update', 'delete'],
  'api::order.order': ['create', 'find', 'findOne', 'cancel', 'findForBusiness', 'statusAsOwner'],
  'api::claim.claim': ['create', 'find', 'findOne'],
  'api::review.review': ['find', 'findOne', 'create', 'update', 'delete', 'respond'],
  'plugin::upload': ['content-api.upload'],
  'plugin::users-permissions.user': ['me', 'updateMe'],
};

const BUSINESS_OWNER_ROLE = {
  name: 'BusinessOwner',
  description: 'Rol asignado al dueño de un negocio (registro directo o vía claim aprobado).',
  type: 'businessowner',
};

async function findRole(strapi, matcher) {
  return strapi.db.query('plugin::users-permissions.role').findOne({ where: matcher });
}

async function ensureBusinessOwnerRole(strapi) {
  const existing = await findRole(strapi, { type: BUSINESS_OWNER_ROLE.type });
  if (existing) return existing;

  const created = await strapi.db.query('plugin::users-permissions.role').create({
    data: BUSINESS_OWNER_ROLE,
  });
  strapi.log.info(`[bootstrap] Rol "${BUSINESS_OWNER_ROLE.name}" creado`);
  return created;
}

async function setRolePermissions(strapi, role, permissions) {
  if (!role) return;
  for (const [uid, actions] of Object.entries(permissions)) {
    for (const action of actions) {
      const permAction = `${uid}.${action}`;
      const existing = await strapi.db
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action: permAction, role: role.id } });

      if (!existing) {
        await strapi.db.query('plugin::users-permissions.permission').create({
          data: { action: permAction, role: role.id },
        });
        strapi.log.info(`[bootstrap] granted ${role.type}: ${permAction}`);
      }
    }
  }
}

async function configureAuthEmailUrls(strapi) {
  const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const current = (await pluginStore.get({ key: 'advanced' })) || {};

  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const desiredRedirect = `${frontendUrl}/cuenta/confirmada`;
  const desiredResetUrl = `${frontendUrl}/reset-password`;

  if (
    current.email_confirmation === true &&
    current.email_confirmation_redirection === desiredRedirect &&
    current.email_reset_password === desiredResetUrl
  ) {
    return;
  }

  await pluginStore.set({
    key: 'advanced',
    value: {
      ...current,
      email_confirmation: true,
      email_confirmation_redirection: desiredRedirect,
      email_reset_password: desiredResetUrl,
    },
  });
  strapi.log.info(`[bootstrap] Email URLs configuradas: confirm→${desiredRedirect} reset→${desiredResetUrl}`);
}

module.exports = {
  register({ strapi }) {
    // `confirmed` es el candado de login de Strapi; `emailVerified` es el dato
    // de negocio: ¿alguien comprobó de verdad que este correo existe?
    strapi.db.lifecycles.subscribe({
      models: ['plugin::users-permissions.user'],

      // Un alta por OAuth (Google) nace con `confirmed: true` de una vez, sin
      // pasar por ningún update: el proveedor ya verificó el correo. El alta
      // local de comensal también nace con `confirmed: true`, pero ahí NADIE
      // verificó nada — por eso la regla mira el provider y no solo `confirmed`.
      beforeCreate(event) {
        const data = event.params.data;
        if (!data) return;
        // Si el llamador ya decidió (register-customer lo pone en false a
        // propósito), se respeta.
        if (data.emailVerified !== undefined) return;
        data.emailVerified =
          data.confirmed === true && !!data.provider && data.provider !== 'local';
      },

      // Cuando el usuario abre el enlace del correo, Strapi solo toca
      // `confirmed`. Incluye también las confirmaciones hechas desde el panel.
      beforeUpdate(event) {
        if (event.params.data?.confirmed === true) {
          event.params.data.emailVerified = true;
        }
      },
    });
  },

  async bootstrap({ strapi }) {
    try {
      const publicRole = await findRole(strapi, { type: 'public' });
      const authenticatedRole = await findRole(strapi, { type: 'authenticated' });
      const ownerRole = await ensureBusinessOwnerRole(strapi);

      await setRolePermissions(strapi, publicRole, PUBLIC_PERMISSIONS);
      await setRolePermissions(strapi, authenticatedRole, AUTHENTICATED_PERMISSIONS);
      await setRolePermissions(strapi, ownerRole, BUSINESS_OWNER_PERMISSIONS);

      await configureAuthEmailUrls(strapi);
    } catch (err) {
      strapi.log.error('[bootstrap] error:', err);
    }
  },
};
