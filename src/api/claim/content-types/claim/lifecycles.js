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

    if (params.data?.claimStatus !== 'approved') return;

    try {
      const claim = await strapi.documents('api::claim.claim').findOne({
        documentId: result.documentId,
        populate: ['user', 'business'],
      });

      if (!claim?.user || !claim?.business) {
        strapi.log.warn('[claim] Claim aprobado sin user o business relacionado — verifica que el claim tenga usuario y negocio asignados');
        return;
      }

      const businessOwnerRole = await strapi.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { name: 'BusinessOwner' } });

      if (!businessOwnerRole) {
        strapi.log.warn('[claim] Rol BusinessOwner no encontrado, verifica que exista en el panel');
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
        },
      });

      strapi.log.info(
        `[claim] Usuario ${claim.user.id} asignado como BusinessOwner del negocio ${claim.business.documentId}`
      );
    } catch (err) {
      strapi.log.error('[claim] Error al procesar aprobación del claim:', err);
    }
  },
};
