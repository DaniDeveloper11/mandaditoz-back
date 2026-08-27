'use strict';

const { renderBrandedEmail, esc } = require('../../../../utils/email-template');
const { promoteToBusinessOwner } = require('../../../../utils/roles');

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
        await promoteToBusinessOwner(strapi, claim.user.id);

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

  const from = process.env.EMAIL_FROM;
  const adminBase = process.env.PUBLIC_ADMIN_URL || 'http://localhost:1337/admin';
  const adminUrl = `${adminBase}/content-manager/collection-types/api::claim.claim/${claim.documentId}`;

  const { business, user, claimantName, claimantRole, claimantPhone, notes, proof } = claim;
  const proofCount = Array.isArray(proof) ? proof.length : 0;
  const roleLabel = CLAIMANT_ROLE_LABEL[claimantRole] || claimantRole || '—';
  const accountValue = `${esc(user?.email || '—')}${user?.username ? ` <span style="color:#8B7B6E;">(${esc(user.username)})</span>` : ''}`;

  const subject = `Nueva reclamación pendiente: ${business.name}`;
  const html = renderBrandedEmail({
    preheader: `Nueva reclamación pendiente para ${business.name}.`,
    title: 'Nueva reclamación de negocio',
    greeting: 'Un usuario envió una solicitud para reclamar la propiedad de un negocio.',
    details: [
      { label: 'Negocio', value: `<strong>${esc(business.name)}</strong>`, raw: true },
      { label: 'Solicitante', value: claimantName },
      { label: 'Relación', value: roleLabel },
      { label: 'Teléfono', value: claimantPhone },
      { label: 'Cuenta', value: accountValue, raw: true },
      { label: 'Documentos', value: proofCount > 0 ? `${proofCount} archivo(s) adjunto(s)` : 'Sin adjuntos' },
    ],
    cta: { url: adminUrl, label: 'Revisar en el panel' },
    calloutHtml: notes ? `<strong style="color:#1C1410;">Notas del solicitante:</strong><br>${esc(notes)}` : '',
    footerNote: 'Notificación interna del admin',
  });

  await strapi.plugin('email').service('email').send({ to, from, subject, html });
  strapi.log.info(`[claim.notify] Email admin enviado (${to}) — ${claim.documentId}`);
}

async function sendClaimEmail(claim, claimStatus) {
  const { user, business, rejectionReason } = claim;
  const businessName = business.name;
  const isApproved = claimStatus === 'approved';
  const displayName = user.displayName || user.username;
  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';

  const subject = isApproved
    ? `¡Tu solicitud para "${businessName}" fue aprobada!`
    : `Tu solicitud para "${businessName}" fue rechazada`;

  const html = isApproved
    ? renderBrandedEmail({
        preheader: `Tu reclamación de ${businessName} fue aprobada.`,
        title: 'Reclamación aprobada',
        greeting: `Felicidades, <strong style="color:#1C1410;font-weight:600;">${esc(displayName)}</strong>. Tu solicitud para reclamar <strong style="color:#1C1410;font-weight:600;">${esc(businessName)}</strong> fue <strong style="color:#1C1410;">aprobada</strong>.`,
        body: `<p style="margin:0;">Ya puedes iniciar sesión y administrar tu negocio: editar horarios, subir fotos, responder reseñas y más.</p>`,
        cta: { url: `${frontendBase}/panel`, label: 'Ir a mi panel' },
      })
    : renderBrandedEmail({
        preheader: `Tu reclamación de ${businessName} fue rechazada.`,
        title: 'Reclamación rechazada',
        greeting: `Hola, <strong style="color:#1C1410;font-weight:600;">${esc(displayName)}</strong>. Tu solicitud para reclamar <strong style="color:#1C1410;font-weight:600;">${esc(businessName)}</strong> fue rechazada.`,
        body: rejectionReason
          ? `<p style="margin:0 0 8px 0;"><strong style="color:#1C1410;">Motivo:</strong></p><p style="margin:0;">${esc(rejectionReason)}</p>`
          : '',
        calloutHtml: 'Si tienes dudas o quieres aportar documentación adicional, respóndenos a este correo y con gusto revisamos tu caso.',
      });

  try {
    await strapi.plugin('email').service('email').send({
      to: user.email,
      from: process.env.EMAIL_FROM,
      subject,
      html,
    });
    strapi.log.info(`[claim] Email enviado a ${user.email} (${claimStatus})`);
  } catch (err) {
    strapi.log.error(`[claim] Error enviando email a ${user.email}:`, err);
  }
}
