'use strict';

/**
 * La máquina de estados del pedido vive AQUÍ Y SOLO AQUÍ.
 *
 * Hay cuatro caminos distintos que cambian el estado de un pedido (link mágico,
 * panel del dueño con sesión, cancelación del comensal y el cron). Si cada uno
 * valida por su cuenta, en tres meses habrá cuatro reglas ligeramente distintas
 * y un pedido entregado que se puede "aceptar" otra vez.
 */

const ORDER_STATUSES = ['new', 'accepted', 'ready', 'delivered', 'rejected', 'cancelled'];

const TERMINAL_STATUSES = new Set(['delivered', 'rejected', 'cancelled']);

/** Ventana en la que el comensal puede cancelar por su cuenta. */
const CUSTOMER_CANCEL_WINDOW_MS = 20 * 60 * 1000;

/**
 * transición permitida: TRANSITIONS[desde][hacia] = [actores que pueden hacerla]
 *
 * `accepted → delivered` es válido a propósito, sin pasar por `ready`: obligar
 * a un restaurantero ocupado a dar dos toques en vez de uno es cómo se
 * abandonan los estados y se acaba con un tablero lleno de pedidos "aceptados"
 * que en realidad ya se entregaron.
 */
const TRANSITIONS = {
  new: {
    accepted:  ['owner'],
    rejected:  ['owner'],
    cancelled: ['customer', 'owner', 'system'],
  },
  accepted: {
    ready:     ['owner'],
    delivered: ['owner'],
    cancelled: ['owner'],
  },
  ready: {
    delivered: ['owner'],
    cancelled: ['owner'],
  },
  delivered: {},
  rejected: {},
  cancelled: {},
};

const STATUS_LABELS = {
  new: 'nuevo',
  accepted: 'aceptado',
  ready: 'listo',
  delivered: 'entregado',
  rejected: 'rechazado',
  cancelled: 'cancelado',
};

/** Marca de tiempo que se sella al entrar a cada estado. */
const STATUS_TIMESTAMP = {
  accepted: 'acceptedAt',
  ready: 'readyAt',
  delivered: 'deliveredAt',
};

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

function canTransition(from, to, actor) {
  const actors = TRANSITIONS[from]?.[to];
  return Array.isArray(actors) && actors.includes(actor);
}

/**
 * Error legible para el usuario final, no para el log.
 * El dueño que toca "Aceptar" dos veces desde el mismo correo debe entender
 * qué pasó, no ver "invalid transition".
 */
function transitionError(from, to) {
  // El caso más común no es un error de programación: es el dueño tocando dos
  // veces el botón del correo, o abriendo el link mágico en dos pestañas.
  if (from === to) {
    return `Este pedido ya está ${STATUS_LABELS[from]}.`;
  }
  if (isTerminal(from)) {
    return `Este pedido ya está ${STATUS_LABELS[from]} y no se puede modificar.`;
  }
  return `No se puede pasar un pedido de "${STATUS_LABELS[from]}" a "${STATUS_LABELS[to]}".`;
}

/**
 * ¿El comensal todavía puede cancelar?
 * Solo mientras nadie lo aceptó y dentro de la ventana: una vez que el negocio
 * lo aceptó ya hay comida en la plancha y cancelar sale caro para alguien real.
 */
function canCustomerCancel(order, now = new Date()) {
  if (!order || order.orderStatus !== 'new') return false;
  const createdAt = new Date(order.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return now.getTime() - createdAt <= CUSTOMER_CANCEL_WINDOW_MS;
}

/**
 * Construye el parche de datos para pasar `order` a `nextStatus`.
 * No escribe nada: devuelve el objeto para que lo aplique el llamador.
 *
 * @throws {Error} con `code = 'INVALID_TRANSITION'` si la transición no procede.
 */
function buildStatusPatch(order, nextStatus, actor, { reason = null, now = new Date() } = {}) {
  const from = order.orderStatus;

  if (!ORDER_STATUSES.includes(nextStatus)) {
    const err = new Error(`Estado desconocido: ${nextStatus}`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  if (!canTransition(from, nextStatus, actor)) {
    const err = new Error(transitionError(from, nextStatus));
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];

  const patch = {
    orderStatus: nextStatus,
    statusHistory: [...history, { status: nextStatus, at: now.toISOString(), by: actor }],
  };

  const stamp = STATUS_TIMESTAMP[nextStatus];
  if (stamp) patch[stamp] = now;

  if (isTerminal(nextStatus)) {
    patch.closedAt = now;
    // El link mágico deja de servir al cerrar el pedido: la credencial no debe
    // sobrevivir al motivo por el que se emitió.
    patch.ownerTokenExpiresAt = now;
  }

  if (nextStatus === 'rejected' && reason) {
    patch.rejectionReason = String(reason).slice(0, 200);
  }

  return patch;
}

module.exports = {
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  CUSTOMER_CANCEL_WINDOW_MS,
  TRANSITIONS,
  STATUS_LABELS,
  isTerminal,
  canTransition,
  canCustomerCancel,
  buildStatusPatch,
};
