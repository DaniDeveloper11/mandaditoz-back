'use strict';

const PUBLIC_PERMISSIONS = {
  'api::category.category': ['find', 'findOne'],
  'api::business.business': ['find', 'findOne'],
  'api::business-hour.business-hour': ['find', 'findOne'],
  'api::review.review': ['find', 'findOne'],
  'api::photo.photo': ['find', 'findOne'],
  'api::social-link.social-link': ['find', 'findOne'],
};

async function setPublicPermissions(strapi) {
  const publicRole = await strapi
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: 'public' } });

  if (!publicRole) {
    strapi.log.warn('[bootstrap] Public role not found, skipping permissions setup');
    return;
  }

  for (const [uid, actions] of Object.entries(PUBLIC_PERMISSIONS)) {
    for (const action of actions) {
      const permAction = `${uid}.${action}`;
      const existing = await strapi
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action: permAction, role: publicRole.id } });

      if (!existing) {
        await strapi.query('plugin::users-permissions.permission').create({
          data: { action: permAction, role: publicRole.id },
        });
        strapi.log.info(`[bootstrap] granted public: ${permAction}`);
      }
    }
  }
}

module.exports = {
  register(/* { strapi } */) {},

  async bootstrap({ strapi }) {
    await setPublicPermissions(strapi);
  },
};
