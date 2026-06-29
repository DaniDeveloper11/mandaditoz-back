'use strict';

const {
  recalcCategoryBusinessCount,
  recalcCityBusinessCount,
  recalcTagBusinessCount,
  getBusinessLinks,
} = require('../../../../utils/denorm');

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
    if (data?.ownershipStatus === 'claimed' && !data.owner) {
      throw new Error(
        'No se puede crear un negocio con ownershipStatus="claimed" sin owner.'
      );
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    const businessId = where?.id;
    await assertOwnershipInvariant(businessId, data);
    if (businessId) {
      event.state = event.state || {};
      event.state.previousBusinessLinks = await getBusinessLinks(businessId);
    }
  },

  async afterCreate(event) {
    scheduleRecalc(event.result.id);
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
