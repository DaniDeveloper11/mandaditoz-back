'use strict';

const { recalcBusinessRating, runAfterCommit } = require('../../../../utils/denorm');

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
 * Programa el recount para despues del COMMIT de la transaccion del document
 * service. Antes se hacia con `setImmediate` a secas y el recalc podia correr
 * con la transaccion todavia abierta: leia por fuera de ella y guardaba el
 * conteo previo al cambio (publicar una resena desde el admin dejaba el
 * negocio en 0 resenas). El businessId tambien se resuelve ahi dentro, porque
 * la fila de reviews_business_lnk de una resena recien creada tampoco es
 * visible hasta el commit.
 */
function scheduleRecalc({ reviewId, rawBusiness, businessId }) {
  runAfterCommit(async () => {
    let id = businessId ?? null;
    if (!id) id = await getReviewBusinessId(reviewId);
    if (!id) id = await resolveBusinessIdFromAny(rawBusiness);
    if (!id) return;
    await recalcBusinessRating(id);
  });
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    if (!data) return;

    // Inyecta author desde el request context autenticado.
    // Se hace aquí (no en el controller) para que la validación de content-API
    // no rechace la key "author" antes de llegar al Document Service.
    if (!data.author) {
      const ctx = strapi.requestContext.get();
      const userId = ctx?.state?.user?.id;
      if (userId) data.author = userId;
    }

    if (!data.reviewStatus) data.reviewStatus = 'published';
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    if (data && ('comment' in data || 'title' in data || 'rating' in data)) {
      data.editedAt = new Date();
    }
  },

  async afterCreate(event) {
    scheduleRecalc({
      reviewId: event.result?.id,
      rawBusiness: event.params?.data?.business,
    });
  },

  async afterUpdate(event) {
    scheduleRecalc({
      reviewId: event.result?.id,
      rawBusiness: event.params?.data?.business,
    });
  },

  async beforeDelete(event) {
    const { where } = event.params;
    const reviewId = where?.id;
    if (!reviewId) return;
    event.state = event.state || {};
    event.state.deletedReviewBusinessId = await getReviewBusinessId(reviewId);
  },

  async afterDelete(event) {
    scheduleRecalc({ businessId: event.state?.deletedReviewBusinessId });
  },
};
