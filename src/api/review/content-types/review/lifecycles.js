'use strict';

const { recalcBusinessRating } = require('../../../../utils/denorm');

function extractRelationId(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    if (raw.id) return raw.id;
    if (raw.documentId) return raw.documentId;
    if (Array.isArray(raw.set) && raw.set[0]) return raw.set[0].id ?? raw.set[0].documentId ?? null;
    if (Array.isArray(raw.connect) && raw.connect[0]) return raw.connect[0].id ?? raw.connect[0].documentId ?? null;
  }
  return null;
}

async function resolveBusinessIdFromAny(raw) {
  const id = extractRelationId(raw);
  if (!id) return null;
  if (typeof id === 'number' || /^\d+$/.test(String(id))) return Number(id);
  // documentId → id
  const row = await strapi.db.query('api::business.business').findOne({ where: { documentId: id } });
  return row?.id ?? null;
}

async function getReviewBusinessId(reviewId) {
  if (!reviewId) return null;
  const [{ rows }] = await Promise.all([
    strapi.db.connection.raw(
      `SELECT business_id FROM reviews_business_lnk WHERE review_id = ? LIMIT 1`,
      [reviewId]
    ),
  ]);
  return rows[0]?.business_id ?? null;
}

/**
 * Programa un recount usando setImmediate para dejar que Strapi
 * termine de persistir las tablas link antes de leerlas.
 */
function scheduleRecalc(businessId) {
  if (!businessId) return;
  setImmediate(async () => {
    try {
      await recalcBusinessRating(businessId);
    } catch (err) {
      strapi.log.error('[review recalc deferred] error:', err);
    }
  });
}

module.exports = {
  async beforeUpdate(event) {
    const { data } = event.params;
    if (data && ('comment' in data || 'title' in data || 'rating' in data)) {
      data.editedAt = new Date();
    }
  },

  async afterCreate(event) {
    try {
      // El link puede no estar persistido aún → intentar por link, si no por data.business.
      let businessId = await getReviewBusinessId(event.result.id);
      if (!businessId) businessId = await resolveBusinessIdFromAny(event.params?.data?.business);
      scheduleRecalc(businessId);
    } catch (err) {
      strapi.log.error('[review.afterCreate] recalc error:', err);
    }
  },

  async afterUpdate(event) {
    try {
      let businessId = await getReviewBusinessId(event.result.id);
      if (!businessId) businessId = await resolveBusinessIdFromAny(event.params?.data?.business);
      scheduleRecalc(businessId);
    } catch (err) {
      strapi.log.error('[review.afterUpdate] recalc error:', err);
    }
  },

  async beforeDelete(event) {
    const { where } = event.params;
    const reviewId = where?.id;
    if (!reviewId) return;
    event.state = event.state || {};
    event.state.deletedReviewBusinessId = await getReviewBusinessId(reviewId);
  },

  async afterDelete(event) {
    try {
      scheduleRecalc(event.state?.deletedReviewBusinessId);
    } catch (err) {
      strapi.log.error('[review.afterDelete] recalc error:', err);
    }
  },
};
