'use strict';

module.exports = {
  cleanupOrphanUploads: {
    // Borra archivos subidos que no están relacionados a ninguna entidad
    // y tienen más de 24h. Protege contra abuso del endpoint público /upload
    // usado por el flujo /negocios/publicar.
    task: async ({ strapi }) => {
      try {
        const { rows } = await strapi.db.connection.raw(
          `SELECT f.id
             FROM files f
             LEFT JOIN files_related_morphs frm ON frm.file_id = f.id
            WHERE frm.file_id IS NULL
              AND f.created_at < NOW() - INTERVAL '24 hours'
            LIMIT 500`
        );

        if (!rows?.length) return;

        const uploadService = strapi.plugin('upload').service('upload');
        let deleted = 0;
        for (const { id } of rows) {
          try {
            const file = await strapi.db.query('plugin::upload.file').findOne({ where: { id } });
            if (file) {
              await uploadService.remove(file);
              deleted++;
            }
          } catch (err) {
            strapi.log.warn(`[cron.cleanupOrphans] no se pudo borrar file ${id}: ${err.message}`);
          }
        }
        strapi.log.info(`[cron.cleanupOrphans] borrados ${deleted}/${rows.length} archivos huérfanos`);
      } catch (err) {
        strapi.log.error('[cron.cleanupOrphans] error:', err);
      }
    },
    options: {
      rule: '0 3 * * *',
    },
  },
};
