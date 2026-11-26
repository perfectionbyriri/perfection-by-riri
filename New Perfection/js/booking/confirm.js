// Step 5 · confirmation, conversion hook and calendar file
// (docs/booking/DESIGN_SPEC.md §4 step 5; ARCHITECTURE §10).
//
// fireConfirmation runs exactly once per booking id, and only for a confirmed
// booking whose deposit was captured (or not needed). Funnel events carry the
// service id only: never a name, email or phone.

import { escapeHtml } from './html.js';
import { formatMoney, heroPhotoFor, splitTimeLabel } from './checkout.js';
import { POLICY_TEXT } from './render-details.js';
import { formatDuration } from './render-services.js';

const STUDIO_TZ = 'America/Los_Angeles';
const ADDRESS_STREET = '18205 Alderwood Mall Pkwy A, Suite 918';
const ADDRESS_CITY = 'Lynnwood, WA 98037';
const ADDRESS = `${ADDRESS_STREET}, ${ADDRESS_CITY}`;
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

export function renderConfirmation({ result, service = null, firstName = '', email = '', timeLabel = '', policyText = POLICY_TEXT }) {
  const { booking, deposit } = result;
  const photo = heroPhotoFor(service);
  const { focal } = photo;
  const { datePart, timePart } = splitTimeLabel(timeLabel);
  const metaParts = [];
  if (Number.isFinite(Number(service?.duration_minutes)) && Number(service.duration_minutes) > 0) {
    metaParts.push(formatDuration(service.duration_minutes));
  }
  if (Number.isFinite(Number(service?.price_cents)) && Number(service.price_cents) > 0) {
    metaParts.push(formatMoney(service.price_cents));
  }
  const serviceMeta = metaParts.length ? `<span class="bk-cinema-sub">${escapeHtml(metaParts.join(' · '))}</span>` : '';

  let depositLine = '';
  if (deposit?.status === 'captured') {
    const masked = maskEmail(email);
    depositLine = `<span class="bk-cinema-sub">Deposit paid ${formatMoney(deposit.total_cents)}${masked ? ` · Receipt from Square sent to <span class="bk-confirm-email">${escapeHtml(masked)}</span>` : ''}</span>`;
  } else if (deposit?.status === 'pending_capture') {
    depositLine = '<span class="bk-cinema-sub">Your booking is confirmed. The studio will finalize your deposit shortly.</span>';
  }
  const name = String(firstName).trim();
  return '<div class="bk-confirm bk-cinema">'
    + '<div class="bk-cinema-hero bk-cinema-hero--confirm">'
    + `<img class="bk-cinema-photo" src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.alt ?? '')}" style="object-position: ${escapeHtml(focal)}" loading="eager" decoding="async">`
    + '<div class="bk-cinema-hero-inner">'
    + '<div class="bk-cinema-hero-lead">'
    + '<p class="bk-eyebrow">You&rsquo;re booked &middot; Lynnwood, WA</p>'
    + `<h2 class="bk-step-title bk-confirm-title" tabindex="-1">See you soon${name ? `,<br><em>${escapeHtml(name)}.</em>` : '.'}</h2>`
    + '<div class="bk-actions bk-confirm-actions">'
    + '<button type="button" class="button button-gold" data-action="add-to-calendar">Add to calendar</button>'
    + `<a class="button button-outline" href="${DIRECTIONS_URL}" target="_blank" rel="noopener noreferrer">Directions</a>`
    + '</div>'
    + '</div>'
    + '<p class="bk-cinema-caption">Personal by design.<br>Perfection in the details.</p>'
    + '</div></div>'
    + '<div class="bk-cinema-grid">'
    + '<div class="bk-cinema-col">'
    + '<div class="bk-cinema-col-head"><h3 class="bk-cinema-col-label">Treatment</h3></div>'
    + `<p class="bk-confirm-service bk-cinema-col-title">${escapeHtml(booking.service_name)}</p>`
    + serviceMeta
    + '</div>'
    + '<div class="bk-cinema-col">'
    + '<div class="bk-cinema-col-head"><h3 class="bk-cinema-col-label">Date &amp; time</h3></div>'
    + `<p class="bk-confirm-line bk-cinema-col-title bk-cinema-col-title--gold">${escapeHtml(datePart).replace(/ (\d+)$/, '&nbsp;$1')}</p>`
    + `<span class="bk-cinema-sub">${escapeHtml(timePart)}</span>`
    + '</div>'
    + '<div class="bk-cinema-col">'
    + '<div class="bk-cinema-col-head"><h3 class="bk-cinema-col-label">Studio location</h3></div>'
    + `<p class="bk-confirm-line bk-cinema-info-title">${escapeHtml(ADDRESS_STREET).replace(/Suite (\d+)/, 'Suite&nbsp;$1')}</p>`
    + `<span class="bk-cinema-sub">${escapeHtml(ADDRESS_CITY)}</span>`
    + '</div>'
    + '<div class="bk-cinema-col">'
    + `<div class="bk-cinema-col-head"><h3 class="bk-cinema-col-label">${depositLine ? 'Deposit &amp; changes' : 'Questions or changes'}</h3></div>`
    + depositLine
    + '<p class="bk-confirm-line bk-cinema-info-title">Need to change or cancel?</p>'
    + '<span class="bk-cinema-sub">Call <a href="tel:+14258450045">(425) 845 0045</a>.</span>'
    + (booking.id ? `<p class="bk-fine bk-confirm-ref">Booking reference: <span class="bk-confirm-ref-id">${escapeHtml(booking.id)}</span></p>` : '')
    + '</div>'
    + '</div>'
    + `<p class="bk-fine bk-cinema-policy">Booking policy: ${escapeHtml(policyText || POLICY_TEXT)}</p>`
    + '</div>';
}
