'use strict';

const VALID_TYPES = ['profile_view', 'phone_click', 'whatsapp_click'];
const SESSION_DEDUPE_WINDOW_MS = 30 * 60 * 1000; // 30 min
const VALID_RANGES = { '7d': 7, '30d': 30, '90d': 90 };

module.exports = {
  /**
   * POST /api/business-events
   * Público. Registra un evento con dedupe por (business, type, sessionId) en 30 min.
   */
  async track(ctx) {
    const body = ctx.request.body?.data ?? ctx.request.body ?? {};
    const type = String(body.type ?? '').trim();
    const businessDocumentId = String(body.business ?? body.businessDocumentId ?? '').trim();
    const sessionId = String(body.sessionId ?? '').trim().slice(0, 64);

    if (!VALID_TYPES.includes(type)) return ctx.badRequest('Tipo de evento inválido');
    if (!businessDocumentId) return ctx.badRequest('business requerido');
    if (!sessionId) return ctx.badRequest('sessionId requerido');

    const business = await strapi
      .documents('api::business.business')
      .findOne({ documentId: businessDocumentId, fields: ['id', 'businessStatus'] });

    if (!business || business.businessStatus !== 'published') {
      return ctx.notFound('Negocio no encontrado');
    }

    const since = new Date(Date.now() - SESSION_DEDUPE_WINDOW_MS);
    const existing = await strapi.db.query('api::business-event.business-event').findOne({
      where: {
        business: business.id,
        type,
        sessionId,
        occurredAt: { $gte: since },
      },
    });

    if (existing) {
      ctx.body = { ok: true, deduped: true };
      return;
    }

    const now = new Date();
    await strapi.documents('api::business-event.business-event').create({
      data: {
        business: businessDocumentId,
        type,
        sessionId,
        occurredAt: now,
      },
    });

    ctx.body = { ok: true, deduped: false };
  },

  /**
   * GET /api/business-events/stats/:documentId?range=30d
   * Requiere ser owner del negocio. Devuelve counts agrupados por type.
   */
  async statsForBusiness(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const documentId = ctx.params.documentId;
    if (!documentId) return ctx.badRequest('documentId requerido');

    const rangeKey = String(ctx.query.range ?? '30d');
    const days = VALID_RANGES[rangeKey] ?? 30;

    const business = await strapi.documents('api::business.business').findOne({
      documentId,
      fields: ['id'],
      populate: { owner: { fields: ['id'] } },
    });

    if (!business) return ctx.notFound('Negocio no encontrado');
    if (business.owner?.id !== user.id) return ctx.forbidden('No eres dueño de este negocio');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const knex = strapi.db.connection;
    const rows = await knex('business_events as e')
      .join('business_events_business_lnk as l', 'l.business_event_id', 'e.id')
      .select('e.type')
      .count('* as count')
      .where('l.business_id', business.id)
      .andWhere('e.occurred_at', '>=', since)
      .groupBy('e.type');

    const counts = Object.fromEntries(VALID_TYPES.map(t => [t, 0]));
    for (const r of rows) counts[r.type] = Number(r.count);

    ctx.body = {
      data: {
        range: rangeKey,
        since: since.toISOString(),
        counts,
      },
    };
  },
};
