'use strict';

const { errors } = require('@strapi/utils');
const {
  recalcCategoryBusinessCount,
  recalcCityBusinessCount,
  recalcTagBusinessCount,
  getBusinessLinks,
} = require('../../../../utils/denorm');

const MAX_PUBLISHED_PER_OWNER = 3;

async function countPublishedByOwner(ownerId, excludeBusinessId = null) {
  const where = {
    owner: ownerId,
    businessStatus: 'published',
    archivedAt: null,
  };
  if (excludeBusinessId) where.id = { $ne: excludeBusinessId };
  return strapi.db.query('api::business.business').count({ where });
}

async function assertPublishLimit(ownerId, excludeBusinessId = null) {
  if (!ownerId) return;
  const count = await countPublishedByOwner(ownerId, excludeBusinessId);
  if (count >= MAX_PUBLISHED_PER_OWNER) {
    throw new errors.ApplicationError(
      `Has alcanzado el límite de ${MAX_PUBLISHED_PER_OWNER} negocios publicados por usuario. Archiva o pon en borrador alguno para publicar este.`,
      { code: 'PUBLISH_LIMIT_REACHED' }
    );
  }
}

/**
 * Difiere el recount al siguiente tick del event loop para que los link tables
 * ya estén persistidos cuando lo ejecutemos. En INSERT masivos el afterCreate
 * dispara antes de que Strapi complete los INSERTs en las tablas link.
 */
function scheduleRecalc(businessId) {
  if (!businessId) return;
  setImmediate(async () => {
    try {
      const links = await getBusinessLinks(businessId);
      await Promise.all([
        recalcCategoryBusinessCount(links.categoryId),
        recalcCityBusinessCount(links.cityId),
        ...links.tagIds.map(recalcTagBusinessCount),
      ]);
    } catch (err) {
      strapi.log.error('[business recalc deferred] error:', err);
    }
  });
}

function scheduleRecalcForLinks(links) {
  if (!links) return;
  setImmediate(async () => {
    try {
      await Promise.all([
        recalcCategoryBusinessCount(links.categoryId),
        recalcCityBusinessCount(links.cityId),
        ...links.tagIds.map(recalcTagBusinessCount),
      ]);
    } catch (err) {
      strapi.log.error('[business recalc deferred] error:', err);
    }
  });
}

async function assertOwnershipInvariant(businessId, data) {
  const newOwnership = data?.ownershipStatus;
  if (newOwnership !== 'claimed') return;

  const ownerInData = 'owner' in (data || {}) ? data.owner : undefined;
  if (ownerInData) return;

  if (!businessId) {
    throw new Error(
      'Un negocio con ownershipStatus="claimed" debe tener owner asignado.'
    );
  }

  const [{ rows }] = await Promise.all([
    strapi.db.connection.raw(
      `SELECT user_id FROM businesses_owner_lnk WHERE business_id = ? LIMIT 1`,
      [businessId]
    ),
  ]);
  if (!rows[0]?.user_id) {
    throw new Error(
      `Negocio ${businessId} no puede pasar a ownershipStatus="claimed" sin owner.`
    );
  }
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    // Inyecta owner desde el request context autenticado.
    // Se hace aquí (no en el controller) para que la validación de content-API
    // no rechace la key "owner" antes de llegar al Document Service.
    if (!data.owner) {
      const ctx = strapi.requestContext.get();
      const userId = ctx?.state?.user?.id;
      if (userId) {
        data.owner = userId;
      }
    }

    if (data?.ownershipStatus === 'claimed' && !data.owner) {
      throw new Error(
        'No se puede crear un negocio con ownershipStatus="claimed" sin owner.'
      );
    }

    // Límite: máx. 3 negocios publicados por usuario.
    if (data.businessStatus === 'published' && data.owner) {
      await assertPublishLimit(data.owner);
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    const businessId = where?.id;

    // Límite: máx. 3 negocios publicados por usuario. Solo aplicamos si el
    // update intenta poner el negocio como published y actualmente no lo está.
    if (data.businessStatus === 'published' && businessId) {
      const current = await strapi.db.query('api::business.business').findOne({
        where: { id: businessId },
        populate: { owner: true },
      });
      if (current?.businessStatus !== 'published' && current?.owner?.id) {
        await assertPublishLimit(current.owner.id, businessId);
      }
      // Stashed for afterUpdate: usado para detectar la transición → published
      // y disparar el email de "tu negocio ya está publicado" al submitter.
      event.state = event.state || {};
      event.state.previousBusinessStatus = current?.businessStatus;
    }

    await assertOwnershipInvariant(businessId, data);
    if (businessId) {
      event.state = event.state || {};
      event.state.previousBusinessLinks = await getBusinessLinks(businessId);
    }
  },

  async afterCreate(event) {
    scheduleRecalc(event.result.id);

    // Notificaciones de solicitud pública (pending_review):
    // 1. Email al admin de que llegó una solicitud nueva a la cola.
    // 2. Email al submitter confirmando recepción.
    if (event.result.businessStatus === 'pending_review') {
      setImmediate(() => notifyOnSubmission(event.result.documentId));
    }
  },

  async afterUpdate(event) {
    const businessId = event.result.id;
    const prev = event.state?.previousBusinessLinks || { categoryId: null, cityId: null, tagIds: [] };
    setImmediate(async () => {
      try {
        const current = await getBusinessLinks(businessId);
        const categoryIds = new Set([current.categoryId, prev.categoryId].filter(Boolean));
        const cityIds = new Set([current.cityId, prev.cityId].filter(Boolean));
        const tagIds = new Set([...current.tagIds, ...prev.tagIds]);
        await Promise.all([
          ...[...categoryIds].map(recalcCategoryBusinessCount),
          ...[...cityIds].map(recalcCityBusinessCount),
          ...[...tagIds].map(recalcTagBusinessCount),
        ]);
      } catch (err) {
        strapi.log.error('[business.afterUpdate deferred] error:', err);
      }
    });

    // Notificación al submitter cuando su solicitud pasa de pending_review/draft a published.
    // Se dispara solo en la transición (no en cada re-guardado con status ya published).
    const prevStatus = event.state?.previousBusinessStatus;
    const newStatus = event.result.businessStatus;
    if (prevStatus && prevStatus !== 'published' && newStatus === 'published' && event.result.submitterEmail) {
      setImmediate(() => notifyOnPublication(event.result.documentId));
    }
  },

  async beforeDelete(event) {
    const { where } = event.params;
    const businessId = where?.id;
    if (!businessId) return;
    event.state = event.state || {};
    event.state.deletedBusinessLinks = await getBusinessLinks(businessId);
  },

  async afterDelete(event) {
    scheduleRecalcForLinks(event.state?.deletedBusinessLinks);
  },
};

// ─────────────────────────────────────────────────────────────
// Notificaciones por email
// ─────────────────────────────────────────────────────────────

async function notifyOnSubmission(documentId) {
  try {
    const business = await strapi.documents('api::business.business').findOne({
      documentId,
      populate: ['city', 'category'],
    });
    if (!business) return;

    await Promise.all([
      sendAdminNewSubmissionEmail(business).catch((err) =>
        strapi.log.error('[business.notify] error email a admin:', err)
      ),
      business.submitterEmail
        ? sendSubmitterConfirmationEmail(business).catch((err) =>
            strapi.log.error('[business.notify] error email a submitter:', err)
          )
        : Promise.resolve(),
    ]);
  } catch (err) {
    strapi.log.error('[business.notify] error en notifyOnSubmission:', err);
  }
}

async function notifyOnPublication(documentId) {
  try {
    const business = await strapi.documents('api::business.business').findOne({ documentId });
    if (!business?.submitterEmail) return;
    await sendSubmitterPublishedEmail(business);
  } catch (err) {
    strapi.log.error('[business.notify] error en notifyOnPublication:', err);
  }
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendAdminNewSubmissionEmail(business) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    strapi.log.warn(
      '[business.notify] ADMIN_NOTIFICATION_EMAIL no configurado; se omite email al admin'
    );
    return;
  }

  const from = process.env.SMTP_USER;
  const adminBase = process.env.PUBLIC_ADMIN_URL || 'http://localhost:1337/admin';
  const adminUrl = `${adminBase}/content-manager/collection-types/api::business.business/${business.documentId}`;

  const subject = `Nueva solicitud pendiente: ${business.name}`;
  const html = `
    <h2>Nueva solicitud de publicación</h2>
    <p>Un usuario envió una solicitud pública para publicar un negocio en el directorio.</p>
    <table style="border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Nombre</td><td><strong>${esc(business.name)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Categoría</td><td>${esc(business.category?.name || '—')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Municipio</td><td>${esc(business.city?.name || '—')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Ambulante</td><td>${business.isMobile ? 'Sí' : 'No'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Enviado por</td><td>${esc(business.submitterName || '—')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Email contacto</td><td>${esc(business.submitterEmail || '—')}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Teléfono contacto</td><td>${esc(business.submitterPhone || '—')}</td></tr>
    </table>
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 20px;background:#0EA5E9;color:#fff;text-decoration:none;border-radius:6px;">Revisar en el panel</a></p>
  `;

  await strapi.plugin('email').service('email').send({ to, from, subject, html });
  strapi.log.info(`[business.notify] Email admin enviado (${to}) — ${business.documentId}`);
}

async function sendSubmitterConfirmationEmail(business) {
  const from = process.env.SMTP_USER;
  const subject = `Recibimos tu solicitud: ${business.name}`;
  const html = `
    <h2>¡Gracias, ${esc(business.submitterName || '')}!</h2>
    <p>Recibimos tu solicitud para publicar <strong>${esc(business.name)}</strong> en el directorio de Mandaditoz.</p>
    <p>Un administrador revisará la información y publicará el negocio en las próximas <strong>24 a 48 horas hábiles</strong>.</p>
    <p>Te avisaremos por este mismo correo cuando el negocio esté publicado.</p>
    <p style="color:#666;font-size:13px;margin-top:24px;">Si necesitamos aclarar algo, te contactaremos a este email${business.submitterPhone ? ` o al teléfono ${esc(business.submitterPhone)}` : ''}.</p>
  `;

  await strapi
    .plugin('email')
    .service('email')
    .send({ to: business.submitterEmail, from, subject, html });
  strapi.log.info(
    `[business.notify] Email confirmación submitter enviado (${business.submitterEmail}) — ${business.documentId}`
  );
}

async function sendSubmitterPublishedEmail(business) {
  const from = process.env.SMTP_USER;
  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
  const publicUrl = `${frontendBase}/negocios/${business.slug}`;

  const subject = `¡Tu negocio "${business.name}" ya está publicado!`;
  const html = `
    <h2>¡Buenas noticias${business.submitterName ? `, ${esc(business.submitterName)}` : ''}!</h2>
    <p>Tu solicitud fue aprobada y <strong>${esc(business.name)}</strong> ya está publicado en el directorio.</p>
    <p><a href="${publicUrl}" style="display:inline-block;padding:10px 20px;background:#0EA5E9;color:#fff;text-decoration:none;border-radius:6px;">Ver la ficha del negocio</a></p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
    <h3>¿Quieres administrar tu negocio?</h3>
    <p>Crea una cuenta con este mismo email para reclamar el negocio y editar horarios, fotos y más detalles cuando quieras.</p>
  `;

  await strapi
    .plugin('email')
    .service('email')
    .send({ to: business.submitterEmail, from, subject, html });
  strapi.log.info(
    `[business.notify] Email publicación submitter enviado (${business.submitterEmail}) — ${business.documentId}`
  );
}
