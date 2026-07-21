'use strict';

const BRAND = {
  primary: '#1D5A8A',
  text: '#1C1410',
  textSoft: '#6B5B4E',
  textMuted: '#8B7B6E',
  bgPage: '#F5F3EE',
  bgCard: '#FFFFFF',
  bgCallout: '#FBF8F1',
  border: '#ECE6DA',
  borderSoft: '#F0E9DA',
};

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderButton({ url, label }) {
  if (!url || !label) return '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" bgcolor="${BRAND.primary}" style="border-radius:8px;">
          <a href="${esc(url)}"
             style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;letter-spacing:-0.01em;font-family:${FONT_STACK};">
            ${esc(label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function renderKeyValueTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const trs = rows
    .filter((r) => r && r.label)
    .map(
      (r) => `
        <tr>
          <td style="padding:6px 16px 6px 0;font-size:13px;color:${BRAND.textSoft};vertical-align:top;white-space:nowrap;">${esc(r.label)}</td>
          <td style="padding:6px 0;font-size:14px;color:${BRAND.text};">${r.raw ? r.value : esc(r.value ?? '—')}</td>
        </tr>`
    )
    .join('');
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 24px 0;border-top:1px solid ${BRAND.border};border-bottom:1px solid ${BRAND.border};">
      ${trs}
    </table>
  `;
}

function renderCallout(html, tone = 'neutral') {
  if (!html) return '';
  const bg = tone === 'neutral' ? BRAND.bgCallout : BRAND.bgCallout;
  return `
    <tr>
      <td style="background-color:${bg};border:1px solid ${BRAND.borderSoft};border-radius:8px;padding:14px 16px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.textSoft};font-family:${FONT_STACK};">
          ${html}
        </p>
      </td>
    </tr>
  `;
}

/**
 * Renderiza un correo transaccional con el shell de marca Mandaditoz.
 *
 * @param {object} opts
 * @param {string} opts.preheader  Texto oculto que aparece como preview en la bandeja.
 * @param {string} opts.title      Encabezado H1 del correo.
 * @param {string} [opts.greeting] Párrafo introductorio (HTML permitido, usar esc() antes).
 * @param {string} [opts.body]     Párrafos adicionales (HTML permitido).
 * @param {object} [opts.cta]      { url, label } — botón principal.
 * @param {Array}  [opts.details]  Tabla de detalles [{ label, value, raw? }].
 * @param {string} [opts.calloutHtml] Aviso destacado al final (dentro de card gris).
 * @param {string} [opts.footerNote]  Nota footer secundaria (bajo la tarjeta).
 */
function renderBrandedEmail({
  preheader = '',
  title,
  greeting = '',
  body = '',
  cta = null,
  details = null,
  calloutHtml = '',
  footerNote = '',
}) {
  const detailsHtml = renderKeyValueTable(details);
  const buttonHtml = cta ? renderButton(cta) : '';
  const fallbackLink = cta
    ? `
      <tr>
        <td align="left">
          <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:${BRAND.textSoft};font-family:${FONT_STACK};">
            O copia y pega este enlace en tu navegador:
          </p>
          <p style="margin:0 0 28px 0;font-size:13px;line-height:1.5;word-break:break-all;font-family:${FONT_STACK};">
            <a href="${esc(cta.url)}" style="color:${BRAND.primary};text-decoration:underline;">${esc(cta.url)}</a>
          </p>
        </td>
      </tr>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<style>
  @media only screen and (max-width: 480px) {
    .container { width: 100% !important; padding: 24px 20px !important; }
    .btn a { display: block !important; }
    h1 { font-size: 22px !important; }
  }
  a { color: ${BRAND.primary}; }
</style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bgPage};font-family:${FONT_STACK};color:${BRAND.text};">
  <span style="display:none!important;opacity:0;visibility:hidden;height:0;width:0;font-size:0;color:transparent;">${esc(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.bgPage};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" class="container" width="480" cellpadding="0" cellspacing="0" border="0"
               style="width:480px;max-width:480px;background-color:${BRAND.bgCard};border-radius:12px;border:1px solid ${BRAND.border};padding:40px;">

          <tr>
            <td align="left" style="padding-bottom:32px;">
              <span style="font-size:16px;font-weight:600;letter-spacing:-0.01em;color:${BRAND.primary};font-family:${FONT_STACK};">
                mandaditoz
              </span>
            </td>
          </tr>

          <tr>
            <td align="left">
              <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${BRAND.text};font-family:${FONT_STACK};">
                ${esc(title)}
              </h1>
              ${greeting ? `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${BRAND.textSoft};font-family:${FONT_STACK};">${greeting}</p>` : ''}
              ${body ? `<div style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:${BRAND.textSoft};font-family:${FONT_STACK};">${body}</div>` : ''}
            </td>
          </tr>

          ${detailsHtml ? `<tr><td>${detailsHtml}</td></tr>` : ''}

          ${
            buttonHtml
              ? `<tr>
                   <td align="left" class="btn" style="padding:8px 0 24px 0;">
                     ${buttonHtml}
                   </td>
                 </tr>`
              : ''
          }

          ${fallbackLink}

          ${calloutHtml ? renderCallout(calloutHtml) : ''}

        </table>

        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;">
          <tr>
            <td align="center" style="padding:20px 16px 0;">
              <p style="margin:0;font-size:12px;color:${BRAND.textMuted};line-height:1.6;font-family:${FONT_STACK};">
                ${footerNote ? `${esc(footerNote)}<br>` : ''}Mandaditoz &middot; Directorio de negocios locales<br>
                <a href="mailto:hola@mandaditoz.com" style="color:${BRAND.textMuted};text-decoration:underline;">hola@mandaditoz.com</a>
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { renderBrandedEmail, esc, BRAND };
