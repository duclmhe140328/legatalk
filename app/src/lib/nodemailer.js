'use strict';

const nodemailer = require('nodemailer');
const { isValidEmail } = require('../Validator');
const config = require('../config');
const Logger = require('../Logger');
const log = new Logger('NodeMailer');

const APP_NAME = (config.ui?.brand?.app?.name || 'Legatalk').trim();

// =============================
// THEME & LAYOUT CONFIG
// =============================
const THEME = {
  brandName: APP_NAME,
  brandColor: '#6C5CE7',          // Tím LegaTalk (đổi tùy thích)
  brandTextColor: '#ffffff',
  cardBg: '#ffffff',
  bg: '#F6F9FC',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB'
};

// =============================
// EMAIL CONFIG
// =============================
const emailConfig = config.integrations?.email || {};
const EMAIL_ALERT = !!emailConfig.alert;
const EMAIL_NOTIFY = !!emailConfig.notify;
const EMAIL_HOST = emailConfig.host || '';
const EMAIL_PORT = Number(emailConfig.port) || 0;
const EMAIL_USERNAME = emailConfig.username || '';
const EMAIL_PASSWORD = emailConfig.password || '';
const EMAIL_FROM = emailConfig.from || emailConfig.username || `no-reply@${(emailConfig.host || 'localhost')}`;
const EMAIL_SEND_TO = emailConfig.sendTo || '';

if ((EMAIL_ALERT || EMAIL_NOTIFY) && EMAIL_HOST && EMAIL_PORT && EMAIL_USERNAME && EMAIL_PASSWORD && EMAIL_SEND_TO) {
  log.info('Email', {
    alert: EMAIL_ALERT,
    notify: EMAIL_NOTIFY,
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    username: EMAIL_USERNAME,
    from: EMAIL_FROM,
    to: EMAIL_SEND_TO
  });
}

const IS_TLS_PORT = EMAIL_PORT === 465;
const transport = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: EMAIL_PORT,
  secure: IS_TLS_PORT, // 465 = SSL/TLS, 587 = STARTTLS
  auth: {
    user: EMAIL_USERNAME,
    pass: EMAIL_PASSWORD
  }
});

// =============================
// PUBLIC API
// =============================

function sendEmailAlert(event, data) {
  if (!EMAIL_ALERT || !hasBaseConfig() || !EMAIL_SEND_TO) return;

  log.info('sendEmailAlert', { event, data });

  let subject = false;
  let body = false;

  switch (event) {
    case 'join':
      subject = getJoinRoomSubject(data);
      body = getJoinRoomBody(data);
      break;
    case 'widget':
      subject = getWidgetRoomSubject(data);
      body = getWidgetRoomBody(data);
      break;
    case 'alert':
      subject = getAlertSubject(data);
      body = getAlertBody(data);
      break;
    default:
      break;
  }

  if (subject && body) {
    sendEmail(subject, body);
    return true;
  }
  return false;
}

function sendEmailNotifications(event, data, notifications) {
  if (!EMAIL_NOTIFY || !hasBaseConfig()) return;

  log.info('sendEmailNotifications', { event, data, notifications });

  let subject = false;
  let body = false;

  switch (event) {
    case 'join':
      subject = getJoinRoomSubject(data);
      body = getJoinRoomBody(data);
      break;
    // có thể bổ sung case khác...
    default:
      break;
  }

  const emailSendTo = notifications?.mode?.email;

  if (subject && body && isValidEmail(emailSendTo)) {
    sendEmail(subject, body, emailSendTo);
    return true;
  }
  log.error('sendEmailNotifications: Invalid email', { email: emailSendTo });
  return false;
}

function sendEmail(subject, html, emailSendTo = false) {
  const to = emailSendTo || EMAIL_SEND_TO;

  const plain = htmlToText(html); // fallback text

  transport
    .sendMail({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      text: plain
    })
    .catch((err) => log.error(err));
}

// =============================
// EMAIL TEMPLATES (ĐẸP)
// =============================

function getJoinRoomSubject(data) {
  const { room_id } = data || {};
  return `${APP_NAME} • New user joined room ${safe(room_id)}`;
}

function getJoinRoomBody(data = {}) {
  const { peer_name, room_id, domain = '', os, browser } = data;

  const currentDataTime = getCurrentDateTime();
  const localDomains = ['localhost', '127.0.0.1'];
  const isLocal = localDomains.some((d) => (domain || '').includes(d));
  const currentDomain = isLocal ? `${domain}:${config.server?.listen?.port}` : domain;
  const roomJoinBase = currentDomain ? `https://${currentDomain}/join/` : '';
  const joinUrl = roomJoinBase && room_id ? `${roomJoinBase}${room_id}` : '';

  const title = 'New participant joined';
  const preview = `${peer_name || 'A user'} joined room ${room_id || ''}`;

  const rows = [
    row('User', peer_name),
    row('OS', os),
    row('Browser', browser),
    row('Room', joinUrl ? link(joinUrl, joinUrl) : room_id),
    row('Date & Time', currentDataTime)
  ];

  const cta = joinUrl
    ? ctaButton('Open Room', joinUrl)
    : '';

  return layoutEmail({
    title,
    preview,
    lead: 'A new participant has joined your room.',
    rows,
    extra: cta
  });
}

function getWidgetRoomSubject(data) {
  const { room_id } = data || {};
  return `${APP_NAME} WIDGET • User waiting in room ${safe(room_id)}`;
}

function getWidgetRoomBody(data = {}) {
  const body = getJoinRoomBody(data);
  // Có thể tùy biến khác biệt nhỏ nếu muốn
  return body;
}

function getAlertSubject(data = {}) {
  const { subject } = data;
  return subject || `${APP_NAME} • Alert`;
}

function getAlertBody(data = {}) {
  const { body } = data;
  const currentDataTime = getCurrentDateTime();

  const title = '🚨 Alert notification';
  const preview = 'System alert from ' + APP_NAME;

  const badge = `
    <tr>
      <td style="padding:0 0 16px 0;">
        <div style="
          display:inline-block;
          background:#FEE2E2;
          color:#B91C1C;
          font-weight:600;
          padding:6px 10px;
          border-radius:999px;
          font-size:12px;
        ">ALERT</div>
      </td>
    </tr>
  `;

  const rows = [
    row('Message', body),
    row('Date & Time', currentDataTime)
  ];

  return layoutEmail({
    title,
    preview,
    lead: 'Please review the alert below.',
    rows,
    beforeRows: badge
  });
}

// =============================
// LAYOUT HELPERS (Reusable)
// =============================

function layoutEmail({ title, preview, lead, rows, extra = '', beforeRows = '' }) {
  // Lưu ý: dùng table để tương thích email client
  // Có preheader (preview) ẩn
  return `
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safe(title)}</title>
    <style>
      /* Reset cơ bản cho email */
      body, table, td, a { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji', 'Segoe UI Symbol'; }
      img { border:0; outline:none; text-decoration:none; }
      table { border-collapse:collapse !important; }
      body { margin:0 !important; padding:0 !important; background:${THEME.bg}; color:${THEME.text}; }
      a { text-decoration:none; }
      /* Mobile */
      @media only screen and (max-width: 600px) {
        .container { width: 100% !important; border-radius: 0 !important; }
        .px-24 { padding-left:16px !important; padding-right:16px !important; }
      }
      /* Dark mode (khả dụng ở nhiều client hiện đại) */
      @media (prefers-color-scheme: dark) {
        body { background:#0b0f14 !important; color:#e5e7eb !important; }
        .card { background:#121821 !important; border-color:#1f2937 !important; }
        .muted { color:#9ca3af !important; }
        .brand { background:#4338CA !important; }
      }
    </style>
  </head>
  <body>
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; line-height:1px; height:0;">
      ${safe(preview || '')}
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" width="600" class="container" cellspacing="0" cellpadding="0" border="0" style="width:600px; max-width:600px;">
            <!-- Header / Brand -->
            <tr>
              <td class="px-24" style="padding:0 24px 16px 24px;">
                <table role="presentation" width="100%">
                  <tr>
                    <td align="left" style="padding:8px 0 0 0;">
                      <div class="brand" style="
                        display:inline-block;
                        background:${THEME.brandColor};
                        color:${THEME.brandTextColor};
                        padding:10px 14px;
                        border-radius:12px;
                        font-weight:700;
                        font-size:14px;
                        letter-spacing:0.3px;
                      ">${safe(THEME.brandName)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td class="px-24" style="padding:0 24px 24px 24px;">
                <table role="presentation" width="100%" class="card" style="
                  background:${THEME.cardBg};
                  border:1px solid ${THEME.border};
                  border-radius:16px;
                  box-shadow:0 6px 20px rgba(17, 24, 39, 0.08);
                ">
                  <tr>
                    <td style="padding:24px 24px 8px 24px;">
                      <h1 style="margin:0; font-size:20px; line-height:28px;">${safe(title)}</h1>
                      <p class="muted" style="margin:8px 0 0 0; font-size:14px; color:${THEME.muted};">${safe(lead || '')}</p>
                    </td>
                  </tr>

                  ${beforeRows}

                  <tr>
                    <td style="padding:8px 24px 8px 24px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        ${rows.join('\n')}
                      </table>
                    </td>
                  </tr>

                  ${extra ? `
                    <tr>
                      <td style="padding:8px 24px 24px 24px;">
                        ${extra}
                      </td>
                    </tr>` : ''}

                  <tr>
                    <td style="padding:0 24px 20px 24px;">
                      <hr style="border:none; border-top:1px solid ${THEME.border}; margin:0;">
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:0 24px 24px 24px;">
                      <p class="muted" style="margin:0; font-size:12px; color:${THEME.muted};">
                        You’re receiving this because you enabled email ${EMAIL_ALERT ? 'alerts' : ''}${EMAIL_ALERT && EMAIL_NOTIFY ? ' and ' : ''}${EMAIL_NOTIFY ? 'notifications' : ''} in ${safe(APP_NAME)}.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td class="px-24" align="center" style="padding:0 24px 24px 24px;">
                <p class="muted" style="margin:0; font-size:12px; color:${THEME.muted};">
                  © ${new Date().getFullYear()} ${safe(APP_NAME)}. All rights reserved.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}

function row(label, value) {
  const v = value == null || value === '' ? '—' : value;
  return `
    <tr>
      <td style="width:160px; vertical-align:top; padding:10px 12px; font-size:14px; font-weight:600; border-bottom:1px solid ${THEME.border};">${safe(label)}</td>
      <td style="vertical-align:top; padding:10px 12px; font-size:14px; border-bottom:1px solid ${THEME.border}; word-break:break-word;">${v}</td>
    </tr>
  `;
}

function link(href, text) {
  const t = safe(text || href);
  const h = safe(href);
  return `<a href="${h}" style="color:${THEME.brandColor}; text-decoration:underline;">${t}</a>`;
}

function ctaButton(text, href) {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td align="left">
          <a href="${safe(href)}"
             style="display:inline-block; padding:12px 18px; font-weight:700; font-size:14px; border-radius:10px; background:${THEME.brandColor}; color:${THEME.brandTextColor};">
            ${safe(text)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

// =============================
// UTILS
// =============================

function hasBaseConfig() {
  return EMAIL_HOST && EMAIL_PORT && EMAIL_USERNAME && EMAIL_PASSWORD;
}

function getCurrentDateTime() {
  const currentTime = new Date().toLocaleString('en-US', log.tzOptions);
  const milliseconds = String(new Date().getMilliseconds()).padStart(3, '0');
  return `${currentTime}:${milliseconds}`;
}

function safe(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Rất đơn giản – bóc text từ HTML cho trường `text` (fallback).
 * Giữ lại URL & khoảng trắng cơ bản.
 */
function htmlToText(html = '') {
  try {
    const tmp = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<\/?(table|tr|td|div|p|h1|h2|h3|br|hr)>/gi, '\n')
      .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return tmp;
  } catch {
    return '';
  }
}

module.exports = {
  sendEmailAlert,
  sendEmailNotifications
};
