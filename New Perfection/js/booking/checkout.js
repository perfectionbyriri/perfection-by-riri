// Step 4 · deposit and confirm (docs/booking/DESIGN_SPEC.md §4 step 4, §7;
// ARCHITECTURE §8.3, §12.2, §14).
//
// Pure helpers: the request body, error mapping, labels, the review markup
// and the double-submit guard. main.js owns the Square card and Turnstile
// widgets. Every amount shown here comes from the server quote; the UI only
// formats cents and never sends an amount back.

import { escapeHtml } from './html.js';
import { formatDuration } from './render-services.js';
import { formatPhone, phoneDigits } from './validate.js';

export const SQUARE_SDK_URLS = {
  production: 'https://web.squarecdn.com/v1/square.js',
  sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js'
};

export const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function squareSdkUrl(environment) {
  return environment === 'sandbox' ? SQUARE_SDK_URLS.sandbox : SQUARE_SDK_URLS.production;
}

// "$50.00": the deposit total is always shown with cents.
export function formatMoney(cents) {
  const value = Math.max(0, Math.round(Number(cents) || 0));
  return `$${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`;
}

export function payLabel(deposit) {
  return deposit?.required ? `PAY ${formatMoney(deposit.total_cents)} & BOOK` : 'BOOK APPOINTMENT';
}

// The key is created when step 4 opens and kept for every resubmit of that
// attempt (ARCHITECTURE §8.3), so a retry is answered from the server's
// idempotency record instead of charging or booking twice.
export function ensureIdempotencyKey(current, uuid = () => globalThis.crypto.randomUUID()) {
  return current || uuid();
}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

export function buildAppointmentBody(attempt, tokens = {}) {
  const { details = {}, service } = attempt;
  const body = {
    idempotency_key: attempt.idempotencyKey,
    service_id: service.service_id,
    start_at: attempt.startAt,
    customer: {
      first_name: trimmed(details.first_name),
      last_name: trimmed(details.last_name),
      email: trimmed(details.email),
      phone: phoneDigits(details.phone) ?? ''
    },
    notes: trimmed(details.notes),
    policy_accepted: details.policy_accepted === true,
    turnstile_token: tokens.turnstile ?? ''
  };
  if (service.deposit?.required && tokens.payment?.source_id) {
    body.payment = { source_id: tokens.payment.source_id };
    if (tokens.payment.verification_token) body.payment.verification_token = tokens.payment.verification_token;
  }
  return body;
}

const COPY = {
  slotTaken: 'That time was just booked by someone else. Please choose another time — your details are saved.',
  busy: 'Our booking calendar is busy right now. Please try again in a minute, or call (425) 845 0045.',
  declined: 'Your card was declined. Please try another card.',
  failed: "We couldn't complete your booking and your card was not charged. Please try again or call (425) 845 0045.",
  pending: "We couldn't confirm your booking yet. Your card has not been charged. The studio will confirm with you shortly, or call (425) 845 0045.",
  inProgress: 'Your booking is already being processed. Please wait a moment, then try again.',
  network: 'We could not reach the booking calendar. Please check your connection and try again, or call (425) 845 0045.',
  rateLimited: 'Too many attempts. Please wait a few minutes and try again, or call (425) 845 0045.',
  turnstile: 'We could not verify this request. Please try again, or call (425) 845 0045.',
  checkDetails: 'Please check your details and try again.',
  cardAgain: 'Please enter your card details again.'
};

// Codes where the server's outcome is unknown or still running: keep the key
// so a retry is deduplicated. Every other error is a definite failure (the
// server cancelled any card hold), so the next try is a new attempt.
const KEEP_KEY = new Set(['NETWORK', 'IN_PROGRESS', 'BOOKING_PENDING_CONFIRMATION']);

export function mapError(body) {
  const error = body && typeof body.error === 'object' && body.error ? body.error : { code: 'NETWORK' };
  const code = String(error.code || 'NETWORK');
  const base = { code, step: 4, focus: 'banner', inline: false, retry: true, locked: false, keepDetails: true, newKey: !KEEP_KEY.has(code) };
  switch (code) {
    case 'SLOT_TAKEN':
      return { ...base, step: 2, message: COPY.slotTaken, retry: false, refreshedWeek: body.refreshed_week ?? null };
    case 'UPSTREAM_BUSY':
      return { ...base, message: COPY.busy, retryAfterSeconds: error.retry_after_seconds ?? null };
    case 'PAYMENT_DECLINED':
      return { ...base, message: COPY.declined, focus: 'card', inline: true };
    case 'BOOKING_PENDING_CONFIRMATION':
      return { ...base, message: COPY.pending, retry: false, locked: true };
    case 'IN_PROGRESS':
      return { ...base, message: COPY.inProgress };
    case 'RATE_LIMITED':
      return { ...base, message: COPY.rateLimited };
    case 'TURNSTILE_FAILED':
      return { ...base, message: COPY.turnstile };
    case 'NETWORK':
      return { ...base, message: COPY.network };
    case 'VALIDATION_FAILED': {
      const fieldErrors = {};
      let cardError = null;
      for (const [key, message] of Object.entries(error.fields ?? {})) {
        if (key.startsWith('customer.')) fieldErrors[key.slice('customer.'.length)] = String(message);
        else if (key === 'notes' || key === 'policy_accepted') fieldErrors[key] = String(message);
        else if (key.startsWith('payment')) cardError = COPY.cardAgain;
      }
      if (Object.keys(fieldErrors).length) return { ...base, step: 3, focus: 'field', retry: false, message: COPY.checkDetails, fieldErrors };
      if (cardError) return { ...base, focus: 'card', inline: true, message: cardError };
      return { ...base, message: COPY.failed };
    }
    default:
      return { ...base, message: COPY.failed };
  }
}

// Ignores a second submit while one is in flight. lock() keeps it closed for
// good (an unknown booking outcome must not be resubmitted).
export function createSubmitGuard() {
  let busy = false;
  let locked = false;
  return {
    get busy() { return busy; },
    get locked() { return locked; },
    tryStart() {
      if (busy || locked) return false;
      busy = true;
      return true;
    },
    finish() { busy = false; },
    lock() { locked = true; }
  };
}

function row(label, value, className = 'bk-quote-row') {
  return `<div class="${className}"><dt>${label}</dt><dd>${value}</dd></div>`;
}

export function renderReview({ service, details = {}, timeLabel = '' }) {
  const deposit = service.deposit ?? {};
  const name = `${trimmed(details.first_name)} ${trimmed(details.last_name)}`.trim();
  const who = [name, trimmed(details.email), formatPhone(trimmed(details.phone))].filter(Boolean).join(' · ');
  let quote = '';
  if (deposit.required) {
    const fee = deposit.fee_cents > 0
      ? row(`Card processing fee (${(deposit.fee_basis_points / 100).toString()}%)`, formatMoney(deposit.fee_cents))
      : '';
    quote = '<dl class="bk-quote">'
      + row('Deposit', formatMoney(deposit.deposit_cents)) + fee
      + row('Due today', formatMoney(deposit.total_cents), 'bk-quote-row bk-quote-total')
      + '</dl><p class="bk-fine">Remaining balance is paid at the studio.</p>';
  } else {
    quote = '<p class="bk-fine">No deposit is needed for this service. You pay at the studio.</p>';
  }
  const card = deposit.required
    ? '<div class="bk-review-block"><h3 class="bk-review-label">Card</h3>'
      + '<div class="bk-card-field" id="bk-card"></div>'
      + '<p class="bk-field-error" id="bk-card-error" role="alert" hidden></p></div>'
    : '';
  return '<form class="bk-form" id="bk-checkout" novalidate>'
    + '<div class="bk-review-block"><h3 class="bk-review-label">Review</h3>'
    + `<p class="bk-review-line bk-review-service">${escapeHtml(service.name)} · ${formatDuration(service.duration_minutes)}</p>`
    + `<p class="bk-review-line">${escapeHtml(timeLabel)} Pacific Time</p>`
    + `<p class="bk-review-line">${escapeHtml(who)}</p></div>`
    + quote + card
    + '<div class="bk-turnstile" id="bk-turnstile"></div>'
    + `<button type="submit" class="button button-gold bk-pay" data-label="${escapeHtml(payLabel(deposit))}">${escapeHtml(payLabel(deposit))}</button>`
    + (deposit.required ? '<p class="bk-fine bk-secured">Payment secured by Square.</p>' : '')
    + '</form>';
}
