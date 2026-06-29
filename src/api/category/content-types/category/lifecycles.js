'use strict';

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

async function getParentById(parentIdRaw) {
  const parentId = extractRelationId(parentIdRaw);
  if (!parentId) return null;
  const isNumeric = typeof parentId === 'number' || /^\d+$/.test(String(parentId));
  const sql = isNumeric
    ? `SELECT id, slug, depth, path FROM categories WHERE id = ? LIMIT 1`
    : `SELECT id, slug, depth, path FROM categories WHERE document_id = ? LIMIT 1`;
  const [{ rows }] = await Promise.all([
    strapi.db.connection.raw(sql, [parentId]),
  ]);
  return rows[0] || null;
}

async function getParentIdFromLink(categoryId) {
  if (!categoryId) return null;
  const [{ rows }] = await Promise.all([
    strapi.db.connection.raw(
      `SELECT inv_category_id AS parent_id FROM categories_parent_lnk WHERE category_id = ? LIMIT 1`,
      [categoryId]
    ),
  ]);
  return rows[0]?.parent_id ?? null;
}

async function getDescendantIds(rootId) {
  if (!rootId) return [];
  const [{ rows }] = await Promise.all([
    strapi.db.connection.raw(
      `WITH RECURSIVE tree AS (
         SELECT category_id FROM categories_parent_lnk WHERE inv_category_id = ?
         UNION
         SELECT l.category_id FROM categories_parent_lnk l
         JOIN tree t ON l.inv_category_id = t.category_id
       )
       SELECT category_id FROM tree`,
      [rootId]
    ),
  ]);
  return rows.map(r => r.category_id);
}

function computeDepthAndPath(parentRow, ownSlug) {
  if (!parentRow) return { depth: 0, path: ownSlug || '' };
  const parentPath = parentRow.path || parentRow.slug || '';
  return {
    depth: (parentRow.depth || 0) + 1,
    path: parentPath ? `${parentPath}/${ownSlug || ''}` : ownSlug || '',
  };
}

async function refreshSubtreePaths(rootId) {
  const [{ rows: rootRows }] = await Promise.all([
    strapi.db.connection.raw(
      `SELECT id, slug, path, depth FROM categories WHERE id = ? LIMIT 1`,
      [rootId]
    ),
  ]);
  const root = rootRows[0];
  if (!root) return;

  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    const [{ rows: children }] = await Promise.all([
      strapi.db.connection.raw(
        `SELECT c.id, c.slug
         FROM categories c
         JOIN categories_parent_lnk l ON l.category_id = c.id
         WHERE l.inv_category_id = ?`,
        [node.id]
      ),
    ]);
    for (const child of children) {
      const depth = (node.depth || 0) + 1;
      const path = node.path ? `${node.path}/${child.slug}` : child.slug;
      await strapi.db.connection.raw(
        `UPDATE categories SET depth = ?, path = ? WHERE id = ?`,
        [depth, path, child.id]
      );
      stack.push({ id: child.id, slug: child.slug, depth, path });
    }
  }
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    const parent = await getParentById(data?.parent);
    const { depth, path } = computeDepthAndPath(parent, data.slug);
    data.depth = depth;
    data.path = path;
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    const categoryId = where?.id;
    if (!categoryId) return;

    const incomingParent = data?.parent;
    let newParentId;
    if (incomingParent === undefined) {
      newParentId = await getParentIdFromLink(categoryId);
    } else if (incomingParent === null) {
      newParentId = null;
    } else {
      newParentId = extractRelationId(incomingParent);
    }

    if (newParentId === categoryId) {
      throw new Error('Una categoría no puede ser su propio padre.');
    }

    if (newParentId) {
      const descendants = await getDescendantIds(categoryId);
      if (descendants.includes(newParentId)) {
        throw new Error(
          'No se puede asignar como padre a una categoría descendiente (ciclo detectado).'
        );
      }
    }

    const parent = await getParentById(newParentId);
    let resolvedSlug = data.slug;
    if (!resolvedSlug) {
      const [{ rows }] = await Promise.all([
        strapi.db.connection.raw(
          `SELECT slug FROM categories WHERE id = ? LIMIT 1`,
          [categoryId]
        ),
      ]);
      resolvedSlug = rows[0]?.slug || '';
    }
    const { depth, path } = computeDepthAndPath(parent, resolvedSlug);
    data.depth = depth;
    data.path = path;
  },

  async afterUpdate(event) {
    try {
      await refreshSubtreePaths(event.result.id);
    } catch (err) {
      strapi.log.error('[category.afterUpdate] refresh subtree error:', err);
    }
  },
};
