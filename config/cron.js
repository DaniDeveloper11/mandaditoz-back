'use strict';

module.exports = {
  expireFeaturedBusinesses: {
    task: async ({ strapi }) => {
      try {
        const [{ rowCount }] = await Promise.all([
          strapi.db.connection.raw(
            `UPDATE businesses
             SET is_featured = false, featured_order = NULL
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

  remindPendingOrders: {
    // Un pedido sin aceptar es una venta a punto de perderse: el cliente está
    // mirando el celular. A los 10 minutos se le da un segundo toque al negocio
    // y se avisa al admin, que es quien puede levantar el teléfono.
    task: async ({ strapi }) => {
      try {
        const { sendPendingReminder } = require('../src/api/order/services/order-notify');
        const cutoff = new Date(Date.now() - 10 * 60 * 1000);

        const pending = await strapi.db.query('api::order.order').findMany({
          where: {
            orderStatus: 'new',
            createdAt: { $lte: cutoff },
            reminderSentAt: { $null: true },
          },
          select: ['id', 'documentId', 'orderNumber'],
          limit: 50,
        });

        if (!pending.length) return;

        for (const order of pending) {
          try {
            await sendPendingReminder(strapi, order.documentId);
            strapi.log.warn(`[cron.remindOrders] recordatorio enviado para ${order.orderNumber}`);
          } catch (err) {
            strapi.log.error(`[cron.remindOrders] no se pudo recordar ${order.orderNumber}: ${err.message}`);
          }
        }
      } catch (err) {
        strapi.log.error('[cron.remindOrders] error:', err);
      }
    },
    options: {
      rule: '*/5 * * * *',
    },
  },

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
