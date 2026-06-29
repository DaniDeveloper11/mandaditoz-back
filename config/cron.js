'use strict';

module.exports = {
  expireFeaturedBusinesses: {
    task: async ({ strapi }) => {
      try {
        const [{ rowCount }] = await Promise.all([
          strapi.db.connection.raw(
            `UPDATE businesses
             SET is_featured = false
             WHERE is_featured = true
               AND featured_until IS NOT NULL
               AND featured_until < NOW()`
          ),
        ]);
        if (rowCount > 0) {
          strapi.log.info(`[cron.expireFeatured] Apagados ${rowCount} negocios destacados vencidos`);
        }
      } catch (err) {
        strapi.log.error('[cron.expireFeatured] error:', err);
      }
    },
    options: {
      rule: '0 * * * *',
    },
  },
};
