'use strict';
const { factories } = require('@strapi/strapi');

const SUBJECT_LABELS = {
  general: 'Consulta general',
  negocio: 'Ayuda para mi negocio',
  reporte: 'Reportar contenido',
  prensa: 'Prensa / medios',
  sugerencia: 'Sugerencia',
};

function getClientIp(ctx) {
  const forwarded = ctx.request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return ctx.request.ip || 'unknown';
}

module.exports = factories.createCoreController('api::contact-message.contact-message', ({ strapi }) => ({
  async submit(ctx) {
    const body = ctx.request.body?.data ?? {};

    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const phone = String(body.phone ?? '').trim();
    const subject = String(body.subject ?? 'general').trim();
    const message = String(body.message ?? '').trim();
    const cityId = body.city ?? body.cityDocumentId ?? null;

    if (name.length < 2) return ctx.badRequest('Nombre inválido');
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return ctx.badRequest('Email inválido');
    if (!SUBJECT_LABELS[subject]) return ctx.badRequest('Asunto inválido');
    if (message.length < 10) return ctx.badRequest('El mensaje es demasiado corto');
    if (message.length > 2000) return ctx.badRequest('El mensaje es demasiado largo');
    if (body.termsAccepted !== true) return ctx.badRequest('Debes aceptar la Política de privacidad');

    const created = await strapi.documents('api::contact-message.contact-message').create({
      data: {
        name,
        email,
        phone: phone || null,
        subject,
        message,
        city: cityId || null,
        messageStatus: 'new',
        sourceIp: getClientIp(ctx),
        userAgent: String(ctx.request.headers['user-agent'] ?? '').slice(0, 300),
      },
    });

    const to = process.env.CONTACT_INBOX || process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM;
    if (to) {
      try {
        await strapi.plugin('email').service('email').send({
          to,
          replyTo: email,
          subject: `[Mandaditoz] ${SUBJECT_LABELS[subject]} — ${name}`,
          text:
            `Nombre: ${name}\n` +
            `Email: ${email}\n` +
            `Teléfono: ${phone || '—'}\n` +
            `Asunto: ${SUBJECT_LABELS[subject]}\n\n` +
            `Mensaje:\n${message}\n`,
        });
      } catch (err) {
        strapi.log.warn(`[contact-message] no se pudo enviar email de notificación: ${err.message}`);
      }
    }

    ctx.body = { ok: true, documentId: created.documentId };
  },
}));
