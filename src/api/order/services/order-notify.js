'use strict';

const { renderBrandedEmail, esc } = require('../../../utils/email-template');
const { STATUS_LABELS } = require('../../../utils/order-status');

const UID = 'api::order.order';

const NOTIFY_POPULATE = {
  lines: true,
  business: { select: ['id', 'documentId', 'name', 'slug', 'email', 'orderNotifyEmail', 'prepTimeMinutes'] },
  customer: { select: ['id', 'email', 'displayName'] },
};

function pesos(cents) {
  return (Number(cents || 0) / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

function frontendBase() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** URL del link mágico: la credencial va en la ruta, no en un query param. */
function manageUrl(order) {
  return `${frontendBase()}/pedido/gestion/${encodeURIComponent(order.ownerToken)}`;
}

function trackUrl(order) {
  return `${frontendBase()}/pedido/${encodeURIComponent(order.orderNumber)}`;
}

/** A dónde llega el aviso: el correo dedicado a pedidos gana al general. */
function notifyEmailOf(business) {
  return business?.orderNotifyEmail || business?.email || null;
}

/** El ticket, en HTML de tabla porque los clientes de correo no hacen flexbox. */
function renderLines(order) {
  const rows = (order.lines ?? [])
    .map(
      (l) => `
        <tr>
          <td style="padding:8px 12px 8px 0;font-size:14px;color:#1C1410;vertical-align:top;">
            <strong>${l.quantity}×</strong> ${esc(l.name)}
            ${l.notes ? `<br><span style="font-size:12px;color:#6B625C;">↳ ${esc(l.notes)}</span>` : ''}
          </td>
          <td style="padding:8px 0;font-size:14px;color:#1C1410;text-align:right;white-space:nowrap;vertical-align:top;">
            ${pesos(l.lineTotalCents)}
          </td>
        </tr>`
    )
    .join('');

  const envio = order.deliveryFeeCents > 0
    ? `<tr>
         <td style="padding:6px 12px 6px 0;font-size:14px;color:#6B625C;">Envío</td>
         <td style="padding:6px 0;font-size:14px;color:#6B625C;text-align:right;">${pesos(order.deliveryFeeCents)}</td>
       </tr>`
    : '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 20px 0;">
      ${rows}
      <tr><td colspan="2" style="border-top:1px solid #E8E2DC;padding:0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td style="padding:6px 12px 6px 0;font-size:14px;color:#6B625C;">Subtotal</td>
        <td style="padding:6px 0;font-size:14px;color:#6B625C;text-align:right;">${pesos(order.subtotalCents)}</td>
      </tr>
      ${envio}
      <tr>
        <td style="padding:6px 12px 6px 0;font-size:16px;color:#1C1410;"><strong>Total</strong></td>
        <td style="padding:6px 0;font-size:16px;color:#1C1410;text-align:right;"><strong>${pesos(order.totalCents)}</strong></td>
      </tr>
    </table>
  `;
}

async function sendEmail({ to, subject, html }) {
  if (!to) return false;
  await strapi.plugin('email').service('email').send({
    to,
    from: process.env.EMAIL_FROM,
    subject,
    html,
  });
  return true;
}

async function loadOrder(strapi, documentId) {
  return strapi.db.query(UID).findOne({
    where: { documentId },
    populate: NOTIFY_POPULATE,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Pedido nuevo
// ─────────────────────────────────────────────────────────────────────────

/**
 * Avisa al negocio y confirma al comensal.
 *
 * Se llama SIEMPRE después de que el pedido ya está guardado. Si esto falla,
 * `notifiedAt` se queda en null y el cron de recordatorio lo levanta — pero el
 * pedido nunca se pierde por un problema de correo.
 */
async function notifyNewOrder(strapi, documentId) {
  const order = await loadOrder(strapi, documentId);
  if (!order) return;

  const business = order.business;
  const to = notifyEmailOf(business);

  const modalidad = order.fulfillment === 'delivery' ? 'Entrega a domicilio' : 'Pasan a recoger';

  const detalles = [
    { label: 'Pedido', value: `<strong>${esc(order.orderNumber)}</strong>`, raw: true },
    { label: 'Cliente', value: order.customerName },
    { label: 'WhatsApp', value: order.customerPhone },
    { label: 'Modalidad', value: modalidad },
  ];
  if (order.fulfillment === 'delivery' && order.deliveryAddress) {
    detalles.push({ label: 'Dirección', value: order.deliveryAddress });
  }
  if (order.customerNotes) {
    detalles.push({ label: 'Notas', value: order.customerNotes });
  }

  const htmlNegocio = renderBrandedEmail({
    preheader: `Pedido ${order.orderNumber} por ${pesos(order.totalCents)}. Acéptalo de un toque.`,
    title: '¡Tienes un pedido nuevo!',
    greeting: `Llegó un pedido para <strong style="color:#1C1410;font-weight:600;">${esc(business?.name ?? 'tu negocio')}</strong>.`,
    details: detalles,
    body: renderLines(order),
    cta: { url: manageUrl(order), label: 'Aceptar pedido' },
    calloutHtml: 'Este enlace abre el pedido directo, sin contraseña. Vence en 24 horas.',
    footerNote: 'Si no puedes prepararlo, ábrelo y recházalo para avisarle al cliente.',
  });

  let notified = false;
  try {
    notified = await sendEmail({
      to,
      subject: `Pedido nuevo ${order.orderNumber} — ${pesos(order.totalCents)}`,
      html: htmlNegocio,
    });
    if (!to) {
      strapi.log.warn(`[order.notify] ${order.orderNumber}: el negocio ${business?.slug} no tiene correo para avisos`);
    }
  } catch (err) {
    strapi.log.error(`[order.notify] error avisando al negocio de ${order.orderNumber}:`, err);
  }

  if (notified) {
    await strapi.db.query(UID).update({
      where: { id: order.id },
      data: { notifiedAt: new Date() },
    });
  }

  // Confirmación al comensal. Que falle no debe afectar al aviso del negocio.
  try {
    const htmlCliente = renderBrandedEmail({
      preheader: `Recibimos tu pedido ${order.orderNumber}.`,
      title: 'Recibimos tu pedido',
      greeting: `Hola <strong style="color:#1C1410;font-weight:600;">${esc(order.customerName)}</strong>, tu pedido a <strong style="color:#1C1410;font-weight:600;">${esc(business?.name ?? '')}</strong> ya le llegó al negocio.`,
      body: renderLines(order),
      cta: { url: trackUrl(order), label: 'Ver mi pedido' },
      calloutHtml: `Te avisamos en cuanto lo acepten. El pago es <strong style="color:#1C1410;">directo con el negocio</strong>, no por la app.`,
    });
    await sendEmail({
      to: order.customer?.email,
      subject: `Tu pedido ${order.orderNumber} en ${business?.name ?? 'Mandaditoz'}`,
      html: htmlCliente,
    });
  } catch (err) {
    strapi.log.error(`[order.notify] error confirmando a el/la comensal de ${order.orderNumber}:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Cambios de estado
// ─────────────────────────────────────────────────────────────────────────

const CUSTOMER_MESSAGES = {
  accepted: {
    title: '¡Tu pedido fue aceptado!',
    line: (o) => `El negocio ya lo está preparando. Calcula unos <strong style="color:#1C1410;">${o.business?.prepTimeMinutes ?? 20} minutos</strong>.`,
  },
  ready: {
    title: 'Tu pedido está listo',
    line: (o) => o.fulfillment === 'pickup'
      ? 'Ya puedes pasar por él.'
      : 'Va en camino a tu dirección.',
  },
  delivered: {
    title: 'Pedido entregado',
    line: () => '¡Buen provecho! Si te gustó, deja una reseña — le ayuda mucho al negocio.',
  },
  rejected: {
    title: 'El negocio no pudo tomar tu pedido',
    line: (o) => o.rejectionReason
      ? `Motivo: <strong style="color:#1C1410;">${esc(o.rejectionReason)}</strong>`
      : 'No te preocupes, no se te cobró nada.',
  },
  cancelled: {
    title: 'Pedido cancelado',
    line: () => 'El pedido quedó cancelado. No se te cobró nada.',
  },
};

/**
 * Avisa del cambio de estado a quien corresponde.
 * `accepted`, `ready`, `delivered` y `rejected` le importan al comensal.
 * `cancelled` por el comensal le importa al negocio, que quizá ya empezó.
 */
async function notifyStatusChange(strapi, documentId, nextStatus) {
  const order = await loadOrder(strapi, documentId);
  if (!order) return;

  if (nextStatus === 'cancelled') {
    // Se le avisa al negocio: puede tener el pedido a medio preparar.
    try {
      const html = renderBrandedEmail({
        preheader: `El pedido ${order.orderNumber} fue cancelado.`,
        title: 'Pedido cancelado',
        greeting: `El cliente canceló el pedido <strong style="color:#1C1410;font-weight:600;">${esc(order.orderNumber)}</strong>.`,
        details: [
          { label: 'Cliente', value: order.customerName },
          { label: 'Total', value: pesos(order.totalCents) },
        ],
      });
      await sendEmail({
        to: notifyEmailOf(order.business),
        subject: `Pedido cancelado ${order.orderNumber}`,
        html,
      });
    } catch (err) {
      strapi.log.error(`[order.notify] error avisando cancelación de ${order.orderNumber}:`, err);
    }
    return;
  }

  const copy = CUSTOMER_MESSAGES[nextStatus];
  if (!copy) return;

  try {
    const html = renderBrandedEmail({
      preheader: `Tu pedido ${order.orderNumber}: ${STATUS_LABELS[nextStatus] ?? nextStatus}.`,
      title: copy.title,
      greeting: `Hola <strong style="color:#1C1410;font-weight:600;">${esc(order.customerName)}</strong>, novedades de tu pedido <strong style="color:#1C1410;font-weight:600;">${esc(order.orderNumber)}</strong> en ${esc(order.business?.name ?? '')}.`,
      body: `<p style="margin:0 0 12px 0;">${copy.line(order)}</p>`,
      cta: { url: trackUrl(order), label: 'Ver mi pedido' },
    });
    await sendEmail({
      to: order.customer?.email,
      subject: `Tu pedido ${order.orderNumber}: ${STATUS_LABELS[nextStatus] ?? nextStatus}`,
      html,
    });
  } catch (err) {
    strapi.log.error(`[order.notify] error avisando estado de ${order.orderNumber}:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Recordatorio (lo dispara el cron)
// ─────────────────────────────────────────────────────────────────────────

/** Segundo toque al negocio cuando un pedido lleva demasiado sin aceptarse. */
async function sendPendingReminder(strapi, documentId) {
  const order = await loadOrder(strapi, documentId);
  if (!order || order.orderStatus !== 'new') return false;

  const minutos = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000);

  const html = renderBrandedEmail({
    preheader: `El pedido ${order.orderNumber} lleva ${minutos} minutos esperando.`,
    title: 'Tienes un pedido esperando',
    greeting: `El pedido <strong style="color:#1C1410;font-weight:600;">${esc(order.orderNumber)}</strong> lleva <strong style="color:#1C1410;">${minutos} minutos</strong> sin respuesta.`,
    details: [
      { label: 'Cliente', value: order.customerName },
      { label: 'WhatsApp', value: order.customerPhone },
      { label: 'Total', value: pesos(order.totalCents) },
    ],
    body: renderLines(order),
    cta: { url: manageUrl(order), label: 'Aceptar pedido' },
    calloutHtml: 'Si no puedes prepararlo, recházalo para que el cliente no siga esperando.',
  });

  try {
    await sendEmail({
      to: notifyEmailOf(order.business),
      subject: `⏰ Pedido ${order.orderNumber} sin responder`,
      html,
    });
    return true;
  } finally {
    // Se marca SIEMPRE, salga o no el correo: es "ya se intentó una vez", no
    // "ya se entregó". Si se marcara solo al tener éxito, un proveedor de
    // correo caído dejaría al cron reintentando los mismos pedidos cada 5
    // minutos para siempre, llenando el log y sin avanzar nunca.
    await strapi.db.query(UID).update({
      where: { id: order.id },
      data: { reminderSentAt: new Date() },
    });
  }
}

module.exports = {
  notifyNewOrder,
  notifyStatusChange,
  sendPendingReminder,
  // exportados para pruebas
  pesos,
  manageUrl,
  notifyEmailOf,
};
