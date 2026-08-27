'use strict';

const { factories } = require('@strapi/strapi');

const { priceCart } = require('../services/order-pricing');
const { notifyNewOrder, notifyStatusChange } = require('../services/order-notify');
const { extractRelationRef, refToWhere } = require('../../../utils/menu-ownership');
const { isBusinessOpenById } = require('../../../utils/is-open');
const { normalizeMxPhone } = require('../../../utils/phone');
const {
  buildStatusPatch,
  canCustomerCancel,
  CUSTOMER_CANCEL_WINDOW_MS,
} = require('../../../utils/order-status');
const {
  generateUniqueOrderNumber,
  generateOwnerToken,
  ownerTokenExpiryFrom,
  isOwnerTokenExpired,
} = require('../../../utils/order-token');

const UID = 'api::order.order';

/**
 * Lo que el comensal y el dueño necesitan ver de un pedido.
 *
 * Ojo con el vocabulario: la API de documentos y la content-API usan `fields`;
 * `select` es del query engine (`strapi.db.query`). Mezclarlos devuelve
 * "Campo inválido: select at business".
 */
const ORDER_POPULATE = {
  lines: true,
  business: { fields: ['documentId', 'name', 'slug', 'prepTimeMinutes'] },
};

/**
 * Carga el negocio con lo necesario para validar un pedido.
 * `owner` se popula porque las rutas del panel comparan contra él.
 */
async function loadBusiness(strapi, ref) {
  if (ref == null) return null;
  return strapi.db.query('api::business.business').findOne({
    where: refToWhere(ref),
    select: [
      'id', 'documentId', 'name', 'slug', 'email', 'businessStatus', 'archivedAt',
      'acceptsOrders', 'ordersPausedUntil', 'fulfillmentModes',
      'deliveryFeeCents', 'minOrderCents', 'prepTimeMinutes',
      'orderNotifyEmail', 'orderNotifyPhone',
    ],
    populate: { owner: { select: ['id'] } },
  });
}

function pesos(cents) {
  return (cents / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/** Modalidades que el negocio acepta. Por omisión, solo recoger. */
function fulfillmentModesOf(business) {
  const modes = business?.fulfillmentModes;
  if (Array.isArray(modes) && modes.length) {
    return modes.filter((m) => m === 'pickup' || m === 'delivery');
  }
  return ['pickup'];
}

function isPaused(business, now) {
  if (!business?.ordersPausedUntil) return false;
  return new Date(business.ordersPausedUntil).getTime() > now.getTime();
}

module.exports = factories.createCoreController(UID, ({ strapi }) => ({

  // ───────────────────────────────────────────────────────────────────────
  // Crear pedido
  // ───────────────────────────────────────────────────────────────────────
  async create(ctx) {
    const user = ctx.state.user;
    // Ésta es la puerta de verdad. El middleware `auth` del frontend es solo
    // UX: se salta con un curl.
    if (!user) return ctx.unauthorized('Necesitas una cuenta para hacer un pedido.');

    const body = ctx.request.body?.data ?? ctx.request.body ?? {};
    const now = new Date();

    // ── El negocio ────────────────────────────────────────────────────────
    const business = await loadBusiness(strapi, extractRelationRef(body.business));
    if (!business || business.archivedAt || business.businessStatus !== 'published') {
      return ctx.notFound('Ese negocio no está disponible.');
    }
    if (!business.acceptsOrders) {
      return ctx.badRequest('Este negocio todavía no recibe pedidos por la app.');
    }
    if (isPaused(business, now)) {
      return ctx.badRequest('El negocio pausó los pedidos por ahora. Intenta más tarde.');
    }

    // ── Modalidad ─────────────────────────────────────────────────────────
    const fulfillment = body.fulfillment === 'delivery' ? 'delivery' : 'pickup';
    const modes = fulfillmentModesOf(business);
    if (!modes.includes(fulfillment)) {
      return ctx.badRequest(
        fulfillment === 'delivery'
          ? 'Este negocio no hace entregas a domicilio, solo para recoger.'
          : 'Este negocio solo entrega a domicilio.'
      );
    }

    const deliveryAddress = String(body.deliveryAddress ?? '').trim().slice(0, 400);
    if (fulfillment === 'delivery' && deliveryAddress.length < 8) {
      return ctx.badRequest('Escribe la dirección de entrega.');
    }

    // ── Correo sin verificar: el primer pedido pasa, el segundo no ────────
    // Se cuentan TODOS los pedidos, incluidos los cancelados: si solo se
    // contaran los vigentes, cancelar sería una forma de reiniciar el contador.
    if (!user.emailVerified) {
      const previousOrders = await strapi.db.query(UID).count({ where: { customer: user.id } });
      if (previousOrders >= 1) {
        return ctx.badRequest(
          'Confirma tu correo para seguir pidiendo. Te mandamos el enlace cuando creaste tu cuenta; puedes pedir otro desde tu perfil.',
          { code: 'EMAIL_NOT_VERIFIED' }
        );
      }
    }

    // ── Precios: se releen de la base, nunca del cliente ──────────────────
    let priced;
    try {
      priced = await priceCart(strapi, business, body.lines);
    } catch (err) {
      if (err.name === 'ApplicationError') return ctx.badRequest(err.message);
      throw err;
    }

    const { lines, subtotalCents } = priced;

    if (subtotalCents <= 0) {
      return ctx.badRequest('El pedido no tiene importe.');
    }

    const minOrderCents = Number(business.minOrderCents ?? 0);
    // El mínimo se mide sobre la comida, no sobre el total: cobrar el envío
    // para alcanzar el mínimo sería trampa.
    if (minOrderCents > 0 && subtotalCents < minOrderCents) {
      return ctx.badRequest(`El pedido mínimo de este negocio es ${pesos(minOrderCents)}.`);
    }

    const deliveryFeeCents = fulfillment === 'delivery' ? Number(business.deliveryFeeCents ?? 0) : 0;
    const totalCents = subtotalCents + deliveryFeeCents;

    // ── ¿Está abierto? ────────────────────────────────────────────────────
    // Se calcula en el servidor con zona horaria explícita. Ver utils/is-open.js:
    // reusar el computeIsOpen del frontend rechazaría pedidos ~6 h al día.
    const open = await isBusinessOpenById(strapi, business.id, now);
    if (open === false) {
      return ctx.badRequest('El negocio está cerrado en este momento.');
    }
    // open === null (sin horarios cargados) se deja pasar a propósito: es más
    // caro perder una venta real que aceptar un pedido que el negocio puede
    // rechazar de un toque.

    // ── Datos de contacto ─────────────────────────────────────────────────
    const customerName = String(body.customerName ?? user.displayName ?? user.username ?? '').trim().slice(0, 120);
    if (customerName.length < 2) {
      return ctx.badRequest('Falta tu nombre para el pedido.');
    }

    const phoneSource = body.customerPhone ?? user.phone;
    const mx = normalizeMxPhone(phoneSource);
    if (!mx) {
      return ctx.badRequest('Necesitamos tu WhatsApp a 10 dígitos para que el negocio pueda contactarte.');
    }

    // ── Persistir. Solo DESPUÉS se intenta avisar ─────────────────────────
    const orderNumber = await generateUniqueOrderNumber(strapi);
    const ownerToken = generateOwnerToken();

    const created = await strapi.documents(UID).create({
      data: {
        orderNumber,
        business: business.id,
        customer: user.id,
        lines,
        fulfillment,
        orderStatus: 'new',
        subtotalCents,
        deliveryFeeCents,
        totalCents,
        customerName,
        customerPhone: mx.e164,
        deliveryAddress: fulfillment === 'delivery' ? deliveryAddress : null,
        customerNotes: String(body.customerNotes ?? '').trim().slice(0, 500) || null,
        ownerToken,
        ownerTokenExpiresAt: ownerTokenExpiryFrom(now),
        statusHistory: [{ status: 'new', at: now.toISOString(), by: 'customer' }],
      },
      populate: ORDER_POPULATE,
    });

    strapi.log.info(`[order] ${orderNumber} creado — negocio ${business.slug}, total ${pesos(totalCents)}`);

    // El pedido YA está guardado. Si el correo falla se pierde el aviso,
    // nunca el pedido: `notifiedAt` queda en null para poder detectarlo.
    setImmediate(() => {
      notifyNewOrder(strapi, created.documentId).catch((err) =>
        strapi.log.error(`[order] error avisando del pedido ${orderNumber}:`, err)
      );
    });

    const sanitized = await this.sanitizeOutput(created, ctx);
    return this.transformResponse(sanitized);
  },

  // ───────────────────────────────────────────────────────────────────────
  // Lecturas
  // ───────────────────────────────────────────────────────────────────────

  /**
   * GET /orders — siempre y solo los pedidos del usuario en sesión.
   *
   * No usa `super.find`: la content-API rechaza filtrar por `customer` porque
   * es una relación a users-permissions.user, y Strapi bloquea esas relaciones
   * en filtros y populate ("Campo inválido: customer"). Da igual: esto no es un
   * listado genérico que deba respetar filtros arbitrarios del cliente, es
   * "mis pedidos" — y armarlo con el query engine deja explícito que el
   * usuario nunca puede ampliar el conjunto que ve.
   */
  async find(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const page = Math.max(1, Number(ctx.query?.pagination?.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(ctx.query?.pagination?.pageSize ?? 25) || 25));

    const where = { customer: user.id };
    if (ctx.query?.status === 'open') {
      where.orderStatus = { $in: ['new', 'accepted', 'ready'] };
    }

    const [orders, total] = await Promise.all([
      strapi.db.query(UID).findMany({
        where,
        populate: {
          lines: true,
          business: { select: ['id', 'documentId', 'name', 'slug', 'prepTimeMinutes'] },
        },
        orderBy: { createdAt: 'desc' },
        offset: (page - 1) * pageSize,
        limit: pageSize,
      }),
      strapi.db.query(UID).count({ where }),
    ]);

    const sanitized = await this.sanitizeOutput(orders, ctx);
    return this.transformResponse(sanitized, {
      pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total },
    });
  },

  /** GET /orders/:documentId — el comensal dueño del pedido, o el del negocio. */
  async findOne(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const order = await strapi.db.query(UID).findOne({
      where: { documentId: ctx.params.id },
      populate: {
        lines: true,
        customer: { select: ['id'] },
        business: { select: ['id', 'documentId', 'name', 'slug', 'prepTimeMinutes'], populate: { owner: { select: ['id'] } } },
      },
    });

    if (!order) return ctx.notFound('Pedido no encontrado.');

    const isCustomer = order.customer?.id === user.id;
    const isOwner = order.business?.owner?.id === user.id;
    // 404 y no 403: confirmar que el pedido existe ya es filtrar información.
    if (!isCustomer && !isOwner) return ctx.notFound('Pedido no encontrado.');

    const sanitized = await this.sanitizeOutput(order, ctx);
    return this.transformResponse(sanitized);
  },

  /** GET /orders/business/:documentId — el panel del día del dueño. */
  async findForBusiness(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const business = await loadBusiness(strapi, ctx.params.documentId);
    if (!business) return ctx.notFound('Negocio no encontrado.');
    if (business.owner?.id !== user.id) {
      return ctx.forbidden('No administras este negocio.');
    }

    const { status, since } = ctx.query ?? {};
    const where = { business: business.id };

    if (status === 'open') {
      where.orderStatus = { $in: ['new', 'accepted', 'ready'] };
    } else if (typeof status === 'string' && status) {
      where.orderStatus = status;
    }

    if (since) {
      const from = new Date(since);
      if (!Number.isNaN(from.getTime())) where.createdAt = { $gte: from };
    }

    const orders = await strapi.db.query(UID).findMany({
      where,
      populate: { lines: true },
      orderBy: { createdAt: 'desc' },
      limit: 200,
    });

    const sanitized = await this.sanitizeOutput(orders, ctx);
    return this.transformResponse(sanitized);
  },

  // ───────────────────────────────────────────────────────────────────────
  // Cambios de estado con sesión
  // ───────────────────────────────────────────────────────────────────────

  /** POST /orders/:documentId/cancel — el comensal se arrepiente. */
  async cancel(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const order = await strapi.db.query(UID).findOne({
      where: { documentId: ctx.params.id },
      populate: { customer: { select: ['id'] } },
    });

    if (!order) return ctx.notFound('Pedido no encontrado.');
    if (order.customer?.id !== user.id) return ctx.notFound('Pedido no encontrado.');

    if (!canCustomerCancel(order)) {
      const minutos = Math.round(CUSTOMER_CANCEL_WINDOW_MS / 60000);
      return ctx.badRequest(
        order.orderStatus === 'new'
          ? `Ya pasaron más de ${minutos} minutos. Llámale al negocio para cancelar.`
          : 'El negocio ya empezó tu pedido. Llámale para cancelarlo.'
      );
    }

    return applyStatus(this, ctx, strapi, order, 'cancelled', 'customer');
  },

  /** POST /orders/:documentId/status — el dueño desde el panel, con sesión. */
  async statusAsOwner(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized();

    const order = await strapi.db.query(UID).findOne({
      where: { documentId: ctx.params.id },
      populate: { business: { select: ['id'], populate: { owner: { select: ['id'] } } } },
    });

    if (!order) return ctx.notFound('Pedido no encontrado.');
    if (order.business?.owner?.id !== user.id) return ctx.notFound('Pedido no encontrado.');

    const next = String(ctx.request.body?.status ?? ctx.request.body?.data?.status ?? '').trim();
    const reason = ctx.request.body?.reason ?? ctx.request.body?.data?.reason ?? null;

    return applyStatus(this, ctx, strapi, order, next, 'owner', reason);
  },

  // ───────────────────────────────────────────────────────────────────────
  // Link mágico: sin sesión, el token ES la credencial
  // ───────────────────────────────────────────────────────────────────────

  /** GET /orders/token/:token */
  async findByToken(ctx) {
    const order = await loadOrderByToken(strapi, ctx.params.token);
    if (!order) return ctx.notFound('Este enlace no es válido.');

    if (isOwnerTokenExpired(order)) {
      return ctx.gone?.('Este enlace ya venció.') ?? ctx.badRequest('Este enlace ya venció.');
    }

    return ctx.send({ data: publicOrderView(order) });
  },

  /** POST /orders/token/:token/status  — aceptar, rechazar, listo, entregado. */
  async statusByToken(ctx) {
    const order = await loadOrderByToken(strapi, ctx.params.token);
    if (!order) return ctx.notFound('Este enlace no es válido.');

    if (isOwnerTokenExpired(order)) {
      return ctx.badRequest('Este enlace ya venció. Entra a tu panel para gestionar el pedido.');
    }

    const next = String(ctx.request.body?.status ?? ctx.request.body?.data?.status ?? '').trim();
    const reason = ctx.request.body?.reason ?? ctx.request.body?.data?.reason ?? null;

    return applyStatus(this, ctx, strapi, order, next, 'owner', reason, { asTokenView: true });
  },
}));

// ─────────────────────────────────────────────────────────────────────────
// Helpers compartidos por las rutas de estado
// ─────────────────────────────────────────────────────────────────────────

async function loadOrderByToken(strapi, token) {
  const value = String(token ?? '').trim();
  // Los tokens son de 43+ caracteres base64url. Descartar lo que ni siquiera
  // tiene la forma evita ir a la base por cada intento de fuerza bruta.
  if (value.length < 20 || value.length > 64) return null;

  return strapi.db.query('api::order.order').findOne({
    where: { ownerToken: value },
    populate: {
      lines: true,
      business: { select: ['id', 'documentId', 'name', 'slug', 'prepTimeMinutes'] },
    },
  });
}

/**
 * Vista del pedido para el link mágico.
 * Se arma a mano en vez de con sanitizeOutput porque quien la ve no tiene
 * sesión: se expone exactamente lo que el negocio necesita para decidir, nada más.
 */
function publicOrderView(order) {
  return {
    documentId: order.documentId,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    fulfillment: order.fulfillment,
    lines: (order.lines ?? []).map((l) => ({
      name: l.name,
      quantity: l.quantity,
      notes: l.notes,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents,
    })),
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    totalCents: order.totalCents,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    deliveryAddress: order.deliveryAddress,
    customerNotes: order.customerNotes,
    createdAt: order.createdAt,
    acceptedAt: order.acceptedAt,
    readyAt: order.readyAt,
    deliveredAt: order.deliveredAt,
    rejectionReason: order.rejectionReason,
    business: order.business
      ? { name: order.business.name, slug: order.business.slug, prepTimeMinutes: order.business.prepTimeMinutes }
      : null,
  };
}

async function applyStatus(controller, ctx, strapi, order, nextStatus, actor, reason = null, { asTokenView = false } = {}) {
  let patch;
  try {
    patch = buildStatusPatch(order, nextStatus, actor, { reason });
  } catch (err) {
    if (err.code === 'INVALID_TRANSITION') return ctx.badRequest(err.message);
    throw err;
  }

  const updated = await strapi.documents('api::order.order').update({
    documentId: order.documentId,
    data: patch,
    populate: {
      lines: true,
      business: { fields: ['documentId', 'name', 'slug', 'prepTimeMinutes'] },
    },
  });

  strapi.log.info(`[order] ${order.orderNumber}: ${order.orderStatus} → ${nextStatus} (por ${actor})`);

  setImmediate(() => {
    notifyStatusChange(strapi, updated.documentId, nextStatus).catch((err) =>
      strapi.log.error(`[order] error avisando el cambio de estado de ${order.orderNumber}:`, err)
    );
  });

  if (asTokenView) {
    return ctx.send({ data: publicOrderView(updated) });
  }

  const sanitized = await controller.sanitizeOutput(updated, ctx);
  return controller.transformResponse(sanitized);
}
