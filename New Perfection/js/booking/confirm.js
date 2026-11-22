// Step 5 · confirmation, conversion hook and calendar file
// (docs/booking/DESIGN_SPEC.md §4 step 5; ARCHITECTURE §10).
//
// fireConfirmation runs exactly once per booking id, and only for a confirmed
// booking whose deposit was captured (or not needed). Funnel events carry the
// service id only: never a name, email or phone.

import { escapeHtml } from './html.js';
import { formatMoney } from './checkout.js';
import { POLICY_TEXT } from './render-details.js';

const STUDIO_TZ = 'America/Los_Angeles';
const ADDRESS = '18205 Alderwood Mall Pkwy A, Suite 918, Lynnwood, WA 98037';
const DIRECTIONS_URL = 'https://maps.app.goo.gl/2zzJp92GvUAGifaV8?g_st=ic';
const FUNNEL_EVENTS = new Set(['booking_view_service', 'booking_select_slot', 'booking_begin_checkout', 'booking_slot_conflict']);

export function trackFunnel(name, params = {}, gtag = globalThis.gtag) {
  if (!FUNNEL_EVENTS.has(name) || typeof gtag !== 'function') return false;
  try {
    gtag('event', name, { service_id: String(params.service_id ?? '') });
  } catch {
    return false;
  }
  return true;
}

export function isConversion(result) {
  return result?.booking?.status === 'CONFIRMED' && ['captured', 'none'].includes(result?.deposit?.status);
}

// Remembers fired ids per storage object for this page, so a storage that
// throws (private mode, blocked cookies) still cannot double-fire.
const firedOnPage = new WeakMap();
const NO_STORAGE = {};

export function fireConfirmation(result, { gtag, dataLayer, dispatch, storage } = {}) {
  if (!isConversion(result)) return false;
  const bookingId = String(result.booking.id);
  const flag = `purchase_sent:${bookingId}`;
  const memoryKey = storage ?? NO_STORAGE;
  if (!firedOnPage.has(memoryKey)) firedOnPage.set(memoryKey, new Set());
  const memory = firedOnPage.get(memoryKey);
  if (memory.has(bookingId)) return false;
  try {
    if (storage?.getItem(flag)) return false;
  } catch { /* storage unavailable: the page memory still guards */ }
  memory.add(bookingId);
  try { storage?.setItem(flag, '1'); } catch { /* see above */ }

  const depositCents = result.deposit.status === 'none' ? 0 : Number(result.deposit.total_cents) || 0;
  const detail = {
    booking_id: bookingId,
    payment_id: result.deposit.payment_id ?? null,
    deposit_cents: depositCents,
    value: depositCents / 100,
    currency: 'USD',
    service_id: result.service_id,
    service_name: result.booking.service_name
  };
  try {
    gtag?.('event', 'purchase', {
      transaction_id: bookingId, value: detail.value, currency: 'USD',
      items: [{ item_id: detail.service_id, item_name: detail.service_name }]
    });
  } catch { /* analytics must never break the confirmation */ }
  try { dataLayer?.push({ event: 'booking_confirmed', ...detail }); } catch { /* same */ }
  try { dispatch?.(new CustomEvent('pbr:booking-confirmed', { detail })); } catch { /* same */ }
  return true;
}

export function confirmedPath(bookingId) {
  return `/book/confirmed/?ref=${encodeURIComponent(bookingId)}`;
}

export function maskEmail(email) {
  const at = String(email ?? '').trim().indexOf('@');
  return at > 0 ? `${String(email).trim().slice(0, at)}@…` : '';
}

// "2026-11-27T13:00:00-08:00" → "20261127T130000": the BFF returns studio
// wall time with its offset, so the local part is already Pacific.
const icsLocal = (iso) => String(iso).slice(0, 19).replace(/[-:]/g, '');
const icsUtc = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 folds lines longer than 75 octets; a continuation line starts
// with one space, which counts toward its 75.
const encoder = new TextEncoder();
function fold(line) {
  const parts = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length ? 74 : 75;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${STUDIO_TZ}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'TZNAME:PDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'TZNAME:PST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
  'END:VTIMEZONE'
];

export function buildIcs(booking, { now = new Date() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Perfection by Riri//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${icsText(booking.id)}@perfectionbyriri.com`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART;TZID=${STUDIO_TZ}:${icsLocal(booking.start_at)}`,
    `DTEND;TZID=${STUDIO_TZ}:${icsLocal(booking.end_at)}`,
    `SUMMARY:${icsText(`${booking.service_name} · Perfection by Riri`)}`,
    `LOCATION:${icsText(ADDRESS)}`,
    `DESCRIPTION:${icsText('Need to change or cancel? Call (425) 845 0045.')}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function renderConfirmation({ result, firstName = '', email = '', timeLabel = '', policyText = POLICY_TEXT }) {
  const { booking, deposit } = result;
  let depositLine = '';
  if (deposit?.status === 'captured') {
    const masked = maskEmail(email);
    depositLine = `<p class="bk-confirm-line">Deposit paid ${formatMoney(deposit.total_cents)}${masked ? ` · Receipt from Square sent to ${escapeHtml(masked)}` : ''}</p>`;
  } else if (deposit?.status === 'pending_capture') {
    depositLine = '<p class="bk-confirm-line">Your booking is confirmed. The studio will finalize your deposit shortly.</p>';
  }
  const name = String(firstName).trim();
  return '<div class="bk-confirm">'
    + '<p class="bk-eyebrow">You&rsquo;re booked</p>'
    + `<h2 class="bk-step-title bk-confirm-title" tabindex="-1">See you soon${name ? `, <em>${escapeHtml(name)}.</em>` : '.'}</h2>`
    + `<p class="bk-confirm-service">${escapeHtml(booking.service_name)}</p>`
    + `<p class="bk-confirm-line">${escapeHtml(timeLabel)} Pacific Time</p>`
    + `<p class="bk-confirm-line">Perfection by Riri · Lynnwood, WA <a href="${DIRECTIONS_URL}" target="_blank" rel="noopener noreferrer">Directions</a></p>`
    + depositLine
    + '<div class="bk-actions bk-confirm-actions"><button type="button" class="button button-outline" data-action="add-to-calendar">Add to calendar</button></div>'
    + '<p class="bk-confirm-line">Need to change or cancel? Call <a href="tel:+14258450045">(425) 845 0045</a>.</p>'
    + `<p class="bk-fine">Booking policy: ${escapeHtml(policyText || POLICY_TEXT)}</p>`
    + '</div>';
}
