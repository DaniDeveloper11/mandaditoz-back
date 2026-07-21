'use strict';
const { factories } = require('@strapi/strapi');

function getSecondaryJoinTableName() {
  try {
    const meta = strapi.db.metadata.get('api::business.business');
    return meta.attributes.secondaryCategories.joinTable.name;
  } catch {
    return 'businesses_secondary_categories_lnk';
  }
}

async function getTotalsByDocumentIds(documentIds) {
  const map = new Map();
  if (!documentIds?.length) return map;
  const secondaryTable = getSecondaryJoinTableName();
  const placeholders = documentIds.map(() => '?').join(',');
  const [{ rows }] = await Promise.all([
    strapi.db.connection.raw(
      `SELECT c.document_id AS "documentId",
              COUNT(DISTINCT u.business_id)::int AS total
         FROM categories c
         LEFT JOIN (
           SELECT category_id, business_id FROM businesses_category_lnk
           UNION
           SELECT category_id, business_id FROM ${secondaryTable}
         ) u ON u.category_id = c.id
        WHERE c.document_id IN (${placeholders})
        GROUP BY c.document_id`,
      documentIds
    ),
  ]);
  for (const r of rows) map.set(r.documentId, Number(r.total) || 0);
  return map;
}

function collectDocumentIds(data) {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map((item) => item?.documentId).filter(Boolean);
  }
  return data.documentId ? [data.documentId] : [];
}

function attachTotals(data, totalsMap) {
  if (!data) return;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item?.documentId) {
        item.totalBusinessCount = totalsMap.get(item.documentId) ?? 0;
      }
    }
  } else if (data.documentId) {
    data.totalBusinessCount = totalsMap.get(data.documentId) ?? 0;
  }
}

module.exports = factories.createCoreController('api::category.category', ({ strapi }) => ({
  async find(ctx) {
    const response = await super.find(ctx);
    const totals = await getTotalsByDocumentIds(collectDocumentIds(response.data));
    attachTotals(response.data, totals);
    return response;
  },

  async findOne(ctx) {
    const response = await super.findOne(ctx);
    const totals = await getTotalsByDocumentIds(collectDocumentIds(response.data));
    attachTotals(response.data, totals);
    return response;
  },
}));
