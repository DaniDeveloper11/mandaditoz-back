'use strict';

// Permisos otorgados a cada rol en bootstrap.
// Se aplican de forma idempotente: solo crea permisos que no existen.

const PUBLIC_PERMISSIONS = {
  'api::business.business': ['find', 'findOne', 'submit'],
  'plugin::upload': ['content-api.upload'],
  'api::business-hour.business-hour': ['find', 'findOne'],
  'api::business-hour-exception.business-hour-exception': ['find', 'findOne'],
  'api::category.category': ['find', 'findOne'],
  'api::city.city': ['find', 'findOne'],
  'api::neighborhood.neighborhood': ['find', 'findOne'],
  'api::photo.photo': ['find', 'findOne'],
  'api::review.review': ['find', 'findOne'],
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

const AUTHENTICATED_PERMISSIONS = {
  'api::business.business': ['update', 'delete', 'mine'],
  'api::category.category': ['find', 'findOne'],
  'api::city.city': ['find', 'findOne'],
  'api::neighborhood.neighborhood': ['find', 'findOne'],
  'api::tag.tag': ['find', 'findOne'],
  'api::photo.photo': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::claim.claim': ['create', 'find', 'findOne'],
  'api::report.report': ['create'],
  'api::review.review': ['create', 'update', 'delete'],
  'plugin::upload': ['content-api.upload'],
  'plugin::users-permissions.auth': ['changePassword', 'logout'],
  'plugin::users-permissions.user': ['me', 'updateMe'],
};

const BUSINESS_OWNER_PERMISSIONS = {
  'api::business.business': ['create', 'find', 'findOne', 'update', 'delete', 'mine'],
  'api::business-hour.business-hour': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::business-hour-exception.business-hour-exception': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::category.category': ['find', 'findOne'],
  'api::city.city': ['find', 'findOne'],
  'api::neighborhood.neighborhood': ['find', 'findOne'],
  'api::tag.tag': ['find', 'findOne'],
  'api::photo.photo': ['create', 'update', 'delete', 'find', 'findOne'],
  'api::claim.claim': ['create', 'find', 'findOne'],
  'api::review.review': ['find', 'findOne'],
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

async function enableEmailConfirmation(strapi) {
  const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
  const current = (await pluginStore.get({ key: 'advanced' })) || {};
  if (current.email_confirmation === true) return;

  await pluginStore.set({
    key: 'advanced',
    value: {
      ...current,
      email_confirmation: true,
      email_confirmation_redirection: current.email_confirmation_redirection ?? null,
    },
  });
  strapi.log.info('[bootstrap] Email confirmation habilitado');
}

module.exports = {
  register(/* { strapi } */) {},

  async bootstrap({ strapi }) {
    try {
      const publicRole = await findRole(strapi, { type: 'public' });
      const authenticatedRole = await findRole(strapi, { type: 'authenticated' });
      const ownerRole = await ensureBusinessOwnerRole(strapi);

      await setRolePermissions(strapi, publicRole, PUBLIC_PERMISSIONS);
      await setRolePermissions(strapi, authenticatedRole, AUTHENTICATED_PERMISSIONS);
      await setRolePermissions(strapi, ownerRole, BUSINESS_OWNER_PERMISSIONS);

      await enableEmailConfirmation(strapi);
    } catch (err) {
      strapi.log.error('[bootstrap] error:', err);
    }
  },
};
