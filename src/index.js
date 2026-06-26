'use strict';

const PUBLIC_PERMISSIONS = {
  'api::category.category': ['find', 'findOne'],
  'api::business.business': ['find', 'findOne'],
  'api::business-hour.business-hour': ['find', 'findOne'],
  'api::review.review': ['find', 'findOne'],
  'api::photo.photo': ['find', 'findOne'],
  'api::social-link.social-link': ['find', 'findOne'],
};

const AUTHENTICATED_PERMISSIONS = {
  'plugin::users-permissions.user': ['updateMe'],
};

async function setRolePermissions(strapi, roleType, permissions) {
  const role = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: roleType } });

  if (!role) {
    strapi.log.warn(`[bootstrap] Role "${roleType}" not found, skipping`);
    return;
  }

  for (const [uid, actions] of Object.entries(permissions)) {
    for (const action of actions) {
      const permAction = `${uid}.${action}`;
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action: permAction, role: role.id } });

      if (!existing) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: { action: permAction, role: role.id },
        });
        strapi.log.info(`[bootstrap] granted ${roleType}: ${permAction}`);
      }
    }
  }
}

module.exports = {
  register(/* { strapi } */) {},

  async bootstrap({ strapi }) {
    await setRolePermissions(strapi, 'public', PUBLIC_PERMISSIONS);
    await setRolePermissions(strapi, 'authenticated', AUTHENTICATED_PERMISSIONS);
  },
};
