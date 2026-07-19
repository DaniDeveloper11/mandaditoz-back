'use strict';

module.exports = {
  async beforeUpdate(event) {
    const { params } = event;
    const newStatus = params.data?.claimStatus;
    if (newStatus === 'approved' || newStatus === 'rejected' || newStatus === 'cancelled') {
      params.data.reviewedAt = new Date();
    }
  },

  async afterCreate(event) {
    const { result } = event;

    const claim = await strapi.documents('api::claim.claim').findOne({
      documentId: result.documentId,
      populate: ['business', 'user', 'proof'],
    });

    if (!claim?.business) {
      strapi.log.warn('[claim] Claim creado sin business relacionado');
      return;
    }

    await strapi.documents('api::business.business').update({
      documentId: claim.business.documentId,
      data: { ownershipStatus: 'pending_claim' },
    });

    strapi.log.info(
      `[claim] Negocio ${claim.business.documentId} marcado como pending_claim`
    );

    try {
      await sendAdminClaimNotification(claim);
    } catch (err) {
      strapi.log.error('[claim] Error enviando aviso al admin:', err);
    }
  },

  async afterUpdate(event) {
    const { result, params } = event;
    const newStatus = params.data?.claimStatus;

    if (newStatus !== 'approved' && newStatus !== 'rejected') return;

    try {
      const claim = await strapi.documents('api::claim.claim').findOne({
        documentId: result.documentId,
        populate: ['user', 'business'],
      });

      if (!claim?.user || !claim?.business) {
        strapi.log.warn('[claim] Claim sin user o business relacionado');
        return;
      }

      if (newStatus === 'approved') {
        const businessOwnerRole = await strapi.db
          .query('plugin::users-permissions.role')
          .findOne({ where: { name: 'BusinessOwner' } });

        if (!businessOwnerRole) {
          strapi.log.warn('[claim] Rol BusinessOwner no encontrado');
          return;
        }

        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: claim.user.id },
          data: { role: businessOwnerRole.id },
        });

        await strapi.documents('api::business.business').update({
          documentId: claim.business.documentId,
          data: {
            owner: claim.user.id,
            ownershipStatus: 'claimed',
            isVerified: true,
            verifiedAt: new Date(),
          },
        });

        strapi.log.info(
          `[claim] Usuario ${claim.user.id} asignado como BusinessOwner del negocio ${claim.business.documentId}`
        );
      }

      await sendClaimEmail(claim, newStatus);

    } catch (err) {
      strapi.log.error('[claim] Error al procesar claim:', err);
    }
  },
};

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CLAIMANT_ROLE_LABEL = {
  owner: 'Dueño',
  manager: 'Encargado',
  employee: 'Empleado',
  other: 'Otro',
};

async function sendAdminClaimNotification(claim) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    strapi.log.warn(
      '[claim.notify] ADMIN_NOTIFICATION_EMAIL no configurado; se omite email al admin'
    );
    return;
  }

  const from = process.env.SMTP_USER;
  const adminBase = process.env.PUBLIC_ADMIN_URL || 'http://localhost:1337/admin';
  const adminUrl = `${adminBase}/content-manager/collection-types/api::claim.claim/${claim.documentId}`;

  const { business, user, claimantName, claimantRole, claimantPhone, notes, proof } = claim;
  const proofCount = Array.isArray(proof) ? proof.length : 0;
  const roleLabel = CLAIMANT_ROLE_LABEL[claimantRole] || claimantRole || '—';

  const subject = `Nueva reclamación pendiente: ${business.name}`;
  const html = `
    <h2>Nueva reclamación de negocio</h2>
    <p>Un usuario envió una solicitud para reclamar la propiedad de un negocio.</p>
    <table style="border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Negocio</td><td><strong>${esc(business.name)}</strong></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Solicitante</td><td>${esc(claimantName)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Relación</td><td>${esc(roleLabel)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Teléfono</td><td>${esc(claimantPhone)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Cuenta</td><td>${esc(user?.email || '—')}${user?.username ? ` (${esc(user.username)})` : ''}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666;">Documentos</td><td>${proofCount > 0 ? `${proofCount} archivo(s) adjunto(s)` : 'Sin adjuntos'}</td></tr>
    </table>
    ${notes ? `<p style="margin:0 0 4px;color:#666;">Notas del solicitante:</p><blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #0EA5E9;background:#F1F5F9;">${esc(notes)}</blockquote>` : ''}
    <p><a href="${adminUrl}" style="display:inline-block;padding:10px 20px;background:#0EA5E9;color:#fff;text-decoration:none;border-radius:6px;">Revisar en el panel</a></p>
  `;

  await strapi.plugin('email').service('email').send({ to, from, subject, html });
  strapi.log.info(`[claim.notify] Email admin enviado (${to}) — ${claim.documentId}`);
}

async function sendClaimEmail(claim, claimStatus) {
  const { user, business, rejectionReason } = claim;
  const businessName = business.name;
  const isApproved = claimStatus === 'approved';

  const subject = isApproved
    ? `¡Tu solicitud para "${businessName}" fue aprobada!`
    : `Tu solicitud para "${businessName}" fue rechazada`;

  const html = isApproved
    ? `
      <h2>¡Felicidades, ${user.displayName || user.username}!</h2>
      <p>Tu solicitud de reclamación para el negocio <strong>${businessName}</strong> ha sido <strong>aprobada</strong>.</p>
      <p>Ya puedes acceder y administrar tu negocio desde la plataforma.</p>
    `
    : `
      <h2>Hola, ${user.displayName || user.username}</h2>
      <p>Tu solicitud de reclamación para el negocio <strong>${businessName}</strong> ha sido <strong>rechazada</strong>.</p>
      ${rejectionReason ? `<p><strong>Motivo:</strong> ${rejectionReason}</p>` : ''}
      <p>Si tienes dudas, contáctanos.</p>
    `;

  try {
    await strapi.plugin('email').service('email').send({
      to: user.email,
      from: process.env.SMTP_USER,
      subject,
      html,
    });
    strapi.log.info(`[claim] Email enviado a ${user.email} (${claimStatus})`);
  } catch (err) {
    strapi.log.error(`[claim] Error enviando email a ${user.email}:`, err);
  }
}
