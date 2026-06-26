'use strict';

module.exports = {
  async afterUpdate(event) {
    const { result, params } = event;

    // Solo actuar cuando este update específicamente aprueba el claim
    if (params.data?.status !== 'approved') return;

    const claim = await strapi.documents('api::claim.claim').findOne({
      documentId: result.documentId,
      populate: ['user', 'business'],
    });

    if (!claim?.user || !claim?.business) {
      strapi.log.warn('[claim] Claim aprobado sin user o business relacionado');
      return;
    }

    const businessOwnerRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { name: 'BusinessOwner' } });

    if (!businessOwnerRole) {
      strapi.log.warn('[claim] Rol BusinessOwner no encontrado, verifica que exista en el panel');
      return;
    }

    await strapi.query('plugin::users-permissions.user').update({
      where: { id: claim.user.id },
      data: { role: businessOwnerRole.id },
    });

    await strapi.documents('api::business.business').update({
      documentId: claim.business.documentId,
      data: {
        owner: claim.user.id,
        ownershipStatus: 'claimed',
      },
    });

    strapi.log.info(
      `[claim] Usuario ${claim.user.id} asignado como BusinessOwner del negocio ${claim.business.documentId}`
    );
  },
};
