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
      populate: ['business'],
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
