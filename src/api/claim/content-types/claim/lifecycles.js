'use strict';

const { renderBrandedEmail, esc } = require('../../../../utils/email-template');
const { promoteToBusinessOwner } = require('../../../../utils/roles');

/**
 * `ownershipStatus` del negocio se DERIVA, no se fija a mano en cada rama:
 *   - tiene owner                 -> claimed
 *   - algún reclamo `pending`     -> pending_claim
 *   - nada de lo anterior         -> unclaimed
 *
 * Fijarlo a mano dejaba negocios atorados: un reclamo `cancelled` no lo
 * liberaba nunca, rechazar uno de dos reclamos pendientes lo devolvía a
 * `unclaimed` con el otro esperando, y un reclamo nuevo sobre un negocio que ya
 * tenía dueño lo bajaba de `claimed` a `pending_claim`. Importa más de lo que
 * parece: `ownershipStatus !== 'unclaimed'` es el candado de un solo uso de los
 * enlaces de invitación (controllers/claim.js), así que un negocio atorado
 * también deja inservible su enlace.
 */
async function sincronizarPropiedad(businessDocumentId) {
  if (!businessDocumentId) return;
  const business = await strapi.documents('api::business.business').findOne({
    documentId: businessDocumentId,
    fields: ['ownershipStatus'],
    populate: { owner: { fields: ['id'] } },
  });
  if (!business) return;

  let estado = 'unclaimed';
  if (business.owner) {
    estado = 'claimed';
  } else {
    const pendientes = await strapi.documents('api::claim.claim').count({
      filters: { business: { documentId: businessDocumentId }, claimStatus: 'pending' },
    });
    if (pendientes > 0) estado = 'pending_claim';
  }

  if (business.ownershipStatus !== estado) {
    await strapi.documents('api::business.business').update({
      documentId: businessDocumentId,
      data: { ownershipStatus: estado },
    });
    strapi.log.info(`[claim] Negocio ${businessDocumentId}: ${business.ownershipStatus} -> ${estado}`);
  }
}

// Estado y negocio del reclamo ANTES del cambio. El panel de Strapi manda todos
// los campos en cada guardado, claimStatus incluido: sin comparar contra el
// valor previo, editar las notas de un reclamo aprobado lo "aprobaba" otra vez
// y reenviaba el correo al dueño.
async function leerPrevio(where) {
  const previo = await strapi.db.query('api::claim.claim').findOne({
    where,
    select: ['claimStatus'],
    populate: { business: { select: ['documentId'] } },
  });
  return { status: previo?.claimStatus ?? null, businessDocumentId: previo?.business?.documentId ?? null };
}

module.exports = {
  async beforeUpdate(event) {
    const { params } = event;
    event.state.previo = await leerPrevio(params.where);

    const newStatus = params.data?.claimStatus;
    const cambio = newStatus && newStatus !== event.state.previo.status;
    if (cambio && (newStatus === 'approved' || newStatus === 'rejected' || newStatus === 'cancelled')) {
      params.data.reviewedAt = new Date();
    }
  },

  async beforeDelete(event) {
    event.state.previo = await leerPrevio(event.params.where);
  },

  async afterDelete(event) {
    try {
      await sincronizarPropiedad(event.state.previo?.businessDocumentId);
    } catch (err) {
      strapi.log.error('[claim] Error sincronizando negocio tras borrar reclamo:', err);
    }
  },

  async afterCreate(event) {
    const { result } = event;

    const claim = await strapi.documents('api::claim.claim').findOne({
      documentId: result.documentId,
      populate: ['business', 'user', 'proof'],
    });

    if (!claim?.business) {
      strapi.log.warn('[claim] Claim creado sin business relacionado');
      return;
    }

    // Normalmente queda en pending_claim; si el negocio ya tiene dueño se
    // queda en claimed (el reclamo espera revisión sin degradar al dueño).
    await sincronizarPropiedad(claim.business.documentId);

    try {
      await sendAdminClaimNotification(claim);
    } catch (err) {
      strapi.log.error('[claim] Error enviando aviso al admin:', err);
    }
  },

  async afterUpdate(event) {
    const { result, params } = event;
    const newStatus = params.data?.claimStatus;
    const previo = event.state.previo ?? {};

    if (!newStatus || newStatus === previo.status) return;

    try {
      const claim = await strapi.documents('api::claim.claim').findOne({
        documentId: result.documentId,
        populate: { user: true, business: { populate: ['owner'] } },
      });

      if (!claim?.user || !claim?.business) {
        strapi.log.warn('[claim] Claim sin user o business relacionado');
        return;
      }

      if (newStatus === 'rejected' || newStatus === 'cancelled') {
        // Rechazar (o cancelar) es el botón de deshacer. Como los reclamos por
        // invitación se aprueban solos, aquí ya suele haber un dueño puesto:
        // hay que quitarlo, no solo liberar el estado.
        //
        // Solo se quita si el dueño actual es el de ESTE reclamo: si no, se
        // está rechazando a un segundo pretendiente y el dueño legítimo no se
        // toca.
        const owner = claim.business.owner;
        if (owner && owner.id === claim.user.id) {
          await strapi.documents('api::business.business').update({
            documentId: claim.business.documentId,
            data: { owner: null, isVerified: false, verifiedAt: null, ownershipStatus: 'unclaimed' },
          });
          strapi.log.info(`[claim] Negocio ${claim.business.documentId} revocado tras ${newStatus}`);
        }
      }

      if (newStatus === 'approved') {
        await promoteToBusinessOwner(strapi, claim.user.id);

        await strapi.documents('api::business.business').update({
          documentId: claim.business.documentId,
          data: {
            owner: claim.user.id,
            ownershipStatus: 'claimed',
            isVerified: true,
            verifiedAt: new Date(),
          },
        });

        strapi.log.info(
          `[claim] Usuario ${claim.user.id} asignado como BusinessOwner del negocio ${claim.business.documentId}`
        );
      }

      // Cubre también volver un reclamo a `pending` desde el panel, y que otro
      // reclamo pendiente del mismo negocio lo mantenga en pending_claim.
      await sincronizarPropiedad(claim.business.documentId);

      // `cancelled` no avisa: lo usa el admin para limpiar, no es una decisión
      // sobre la solicitud de esa persona.
      if (newStatus === 'approved' || newStatus === 'rejected') {
        await sendClaimEmail(claim, newStatus);
      }

    } catch (err) {
      strapi.log.error('[claim] Error al procesar claim:', err);
    }
  },
};

const CLAIMANT_ROLE_LABEL = {
  owner: 'Dueño',
  manager: 'Encargado',
  employee: 'Empleado',
  other: 'Otro',
};

async function sendAdminClaimNotification(claim) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    strapi.log.warn(
      '[claim.notify] ADMIN_NOTIFICATION_EMAIL no configurado; se omite email al admin'
    );
    return;
  }

  const from = process.env.EMAIL_FROM;
  const adminBase = process.env.PUBLIC_ADMIN_URL || 'http://localhost:1337/admin';
  const adminUrl = `${adminBase}/content-manager/collection-types/api::claim.claim/${claim.documentId}`;

  const { business, user, claimantName, claimantRole, claimantPhone, notes, proof, claimSource } = claim;
  const porInvitacion = claimSource === 'outreach_token';
  const proofCount = Array.isArray(proof) ? proof.length : 0;
  const roleLabel = CLAIMANT_ROLE_LABEL[claimantRole] || claimantRole || '—';
  const accountValue = `${esc(user?.email || '—')}${user?.username ? ` <span style="color:#8B7B6E;">(${esc(user.username)})</span>` : ''}`;

  const subject = porInvitacion
    ? `Negocio reclamado: ${business.name}`
    : `Nueva reclamación pendiente: ${business.name}`;

  const html = renderBrandedEmail({
    preheader: porInvitacion
      ? `${business.name} ya tiene dueño.`
      : `Nueva reclamación pendiente para ${business.name}.`,
    title: porInvitacion ? 'Negocio reclamado' : 'Nueva reclamación de negocio',
    greeting: porInvitacion
      ? 'Alguien abrió su enlace de invitación y tomó control de su ficha. <strong style="color:#1C1410;">No tienes que hacer nada</strong>: esto es solo para que lo sepas.'
      : 'Un usuario envió una solicitud para reclamar la propiedad de un negocio.',
    details: [
      { label: 'Negocio', value: `<strong>${esc(business.name)}</strong>`, raw: true },
      { label: 'Solicitante', value: claimantName },
      { label: 'Relación', value: roleLabel },
      { label: 'Teléfono', value: claimantPhone },
      { label: 'Cuenta', value: accountValue, raw: true },
      // Un reclamo por invitación llegó por un enlace mandado al teléfono que ya
      // estaba publicado en la ficha: eso es la evidencia, y convierte la
      // aprobación en una decisión de segundos en vez de una investigación.
      {
        label: 'Origen',
        value: porInvitacion
          ? '<strong style="color:#1C1410;">Enlace de invitación</strong> (enviado al teléfono de la ficha)'
          : 'Formulario público de la ficha',
        raw: true,
      },
      ...(porInvitacion && business.outreachPhone
        ? [{ label: 'Invitación enviada a', value: business.outreachPhone }]
        : []),
      { label: 'Documentos', value: proofCount > 0 ? `${proofCount} archivo(s) adjunto(s)` : 'Sin adjuntos' },
    ],
    cta: { url: adminUrl, label: porInvitacion ? 'Ver el reclamo' : 'Revisar en el panel' },
    calloutHtml: porInvitacion
      ? '<strong style="color:#1C1410;">¿No era esta persona?</strong><br>Abre el reclamo y cámbialo a <strong>rejected</strong>: eso le quita la propiedad del negocio y lo deja libre para volver a invitarlo.'
      : (notes ? `<strong style="color:#1C1410;">Notas del solicitante:</strong><br>${esc(notes)}` : ''),
    footerNote: 'Notificación interna del admin',
  });

  await strapi.plugin('email').service('email').send({ to, from, subject, html });
  strapi.log.info(`[claim.notify] Email admin enviado (${to}) — ${claim.documentId}`);
}

async function sendClaimEmail(claim, claimStatus) {
  const { user, business, rejectionReason } = claim;
  const businessName = business.name;
  const isApproved = claimStatus === 'approved';
  const displayName = user.displayName || user.username;
  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';

  const subject = isApproved
    ? `¡Tu solicitud para "${businessName}" fue aprobada!`
    : `Tu solicitud para "${businessName}" fue rechazada`;

  const html = isApproved
    ? renderBrandedEmail({
        preheader: `Tu reclamación de ${businessName} fue aprobada.`,
        title: 'Reclamación aprobada',
        greeting: `Felicidades, <strong style="color:#1C1410;font-weight:600;">${esc(displayName)}</strong>. Tu solicitud para reclamar <strong style="color:#1C1410;font-weight:600;">${esc(businessName)}</strong> fue <strong style="color:#1C1410;">aprobada</strong>.`,
        body: `<p style="margin:0;">Ya puedes completar tu ficha: sube tu logo, pon tus horarios, tu WhatsApp y tus fotos. Entre más completa, más te encuentran.</p>`,
        // Directo a la edición de SU negocio, no a un panel donde tenga que
        // buscarlo: el objetivo de aprobar el reclamo es que complete la ficha.
        cta: { url: `${frontendBase}/negocios/${business.slug}/edit`, label: 'Completar mi ficha' },
      })
    : renderBrandedEmail({
        preheader: `Tu reclamación de ${businessName} fue rechazada.`,
        title: 'Reclamación rechazada',
        greeting: `Hola, <strong style="color:#1C1410;font-weight:600;">${esc(displayName)}</strong>. Tu solicitud para reclamar <strong style="color:#1C1410;font-weight:600;">${esc(businessName)}</strong> fue rechazada.`,
        body: rejectionReason
          ? `<p style="margin:0 0 8px 0;"><strong style="color:#1C1410;">Motivo:</strong></p><p style="margin:0;">${esc(rejectionReason)}</p>`
          : '',
        calloutHtml: 'Si tienes dudas o quieres aportar documentación adicional, respóndenos a este correo y con gusto revisamos tu caso.',
      });

  try {
    await strapi.plugin('email').service('email').send({
      to: user.email,
      from: process.env.EMAIL_FROM,
      subject,
      html,
    });
    strapi.log.info(`[claim] Email enviado a ${user.email} (${claimStatus})`);
  } catch (err) {
    strapi.log.error(`[claim] Error enviando email a ${user.email}:`, err);
  }
}
