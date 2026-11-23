import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SQUARE_SDK_URLS, TURNSTILE_URL, buildAppointmentBody, createSubmitGuard, ensureIdempotencyKey,
  mapError, payLabel, renderReview, squareSdkUrl
} from '../../New Perfection/js/booking/checkout.js';

const DEPOSIT = { required: true, deposit_cents: 5000, fee_cents: 0, total_cents: 5000, fee_basis_points: 0 };
const NO_DEPOSIT = { required: false, deposit_cents: 0, fee_cents: 0, total_cents: 0, fee_basis_points: 0 };
const lashLift = { service_id: 'svc_lash_lift', name: 'Lash lift', duration_minutes: 60, price_cents: 9500, deposit: DEPOSIT };
const shaping = { service_id: 'svc_eyebrow_shaping', name: 'Eyebrow shaping', duration_minutes: 30, price_cents: 4500, deposit: NO_DEPOSIT };
const details = {
  first_name: ' Anna ', last_name: 'Smith', email: ' Anna@Example.com ', phone: '(425) 845 0045', notes: '  First visit ', policy_accepted: true
};
const UUID = '6f1c2a4e-8b0d-4c3e-9f1a-2b3c4d5e6f70';

function attempt(service = lashLift) {
  return { idempotencyKey: UUID, service, startAt: '2026-11-27T13:00:00-08:00', details };
}

test('buildAppointmentBody sends the D§14 request with trimmed details and a digits-only phone', () => {
  const body = buildAppointmentBody(attempt(), { turnstile: 'ts-token', payment: { source_id: 'cnon:abc', verification_token: 'verf:xyz' } });
  assert.deepEqual(body, {
    idempotency_key: UUID,
    service_id: 'svc_lash_lift',
    start_at: '2026-11-27T13:00:00-08:00',
    customer: { first_name: 'Anna', last_name: 'Smith', email: 'Anna@Example.com', phone: '4258450045' },
    notes: 'First visit',
    policy_accepted: true,
    turnstile_token: 'ts-token',
    payment: { source_id: 'cnon:abc', verification_token: 'verf:xyz' }
  });
});

test('buildAppointmentBody never includes an amount, even when the state carries one', () => {
  const tampered = { ...attempt(), amount_cents: 1, total_cents: 1 };
  const body = buildAppointmentBody(tampered, { turnstile: 't', payment: { source_id: 'cnon:abc' } });
  assert.doesNotMatch(JSON.stringify(body), /amount|total|cents|price|fee/);
});

test('buildAppointmentBody omits payment for a no-deposit service', () => {
  const body = buildAppointmentBody(attempt(shaping), { turnstile: 't', payment: { source_id: 'cnon:ignored' } });
  assert.equal('payment' in body, false);
  assert.equal(body.service_id, 'svc_eyebrow_shaping');
});

test('one idempotency key survives every resubmit of the same attempt', () => {
  let calls = 0;
  const uuid = () => { calls += 1; return calls === 1 ? UUID : 'second-uuid'; };
  const key = ensureIdempotencyKey(null, uuid);
  assert.equal(key, UUID);
  assert.equal(ensureIdempotencyKey(key, uuid), UUID);
  const first = buildAppointmentBody({ ...attempt(), idempotencyKey: key }, { turnstile: 'a' });
  const second = buildAppointmentBody({ ...attempt(), idempotencyKey: key }, { turnstile: 'b' });
  assert.equal(first.idempotency_key, second.idempotency_key);
  assert.equal(calls, 1);
});

test('SLOT_TAKEN returns to step 2 with the D§7 banner, refreshed times and the form kept', () => {
  const refreshed = { week_start: '2026-11-23', days: [] };
  const mapped = mapError({ error: { code: 'SLOT_TAKEN', message: 'x' }, refreshed_week: refreshed });
  assert.equal(mapped.step, 2);
  assert.equal(mapped.message, 'That time was just booked by someone else. Please choose another time — your details are saved.');
  assert.equal(mapped.focus, 'banner');
  assert.equal(mapped.keepDetails, true);
  assert.equal(mapped.refreshedWeek, refreshed);
  assert.equal(mapped.newKey, true);
});

test('UPSTREAM_BUSY shows the busy copy with the phone and a Try again action', () => {
  const mapped = mapError({ error: { code: 'UPSTREAM_BUSY', retry_after_seconds: 30 } });
  assert.equal(mapped.step, 4);
  assert.equal(mapped.message, 'Our booking calendar is busy right now. Please try again in a minute, or call (425) 845 0045.');
  assert.equal(mapped.retry, true);
  assert.equal(mapped.focus, 'banner');
});

test('PAYMENT_DECLINED is an inline card error and the next card gets a new attempt key', () => {
  const mapped = mapError({ error: { code: 'PAYMENT_DECLINED', decline_reason: 'CARD_DECLINED' } });
  assert.equal(mapped.step, 4);
  assert.equal(mapped.focus, 'card');
  assert.equal(mapped.inline, true);
  assert.equal(mapped.message, 'Your card was declined. Please try another card.');
  assert.equal(mapped.newKey, true);
});

test('BOOKING_PENDING_CONFIRMATION locks the form with no retry', () => {
  const mapped = mapError({ error: { code: 'BOOKING_PENDING_CONFIRMATION' } });
  assert.equal(mapped.message, "We couldn't confirm your booking yet. Your card has not been charged. The studio will confirm with you shortly, or call (425) 845 0045.");
  assert.equal(mapped.retry, false);
  assert.equal(mapped.locked, true);
  assert.equal(mapped.newKey, false);
});

test('a network failure or IN_PROGRESS keeps the same key, so a retry cannot double-book', () => {
  assert.equal(mapError({ error: { code: 'NETWORK' } }).newKey, false);
  assert.equal(mapError({ error: { code: 'IN_PROGRESS' } }).newKey, false);
  assert.equal(mapError({ error: { code: 'NETWORK' } }).retry, true);
});

test('a failure after authorization says the card was not charged', () => {
  const mapped = mapError({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
  assert.equal(mapped.message, "We couldn't complete your booking and your card was not charged. Please try again or call (425) 845 0045.");
  assert.equal(mapped.step, 4);
});

test('VALIDATION_FAILED on customer fields goes back to step 3 with field errors', () => {
  const mapped = mapError({ error: { code: 'VALIDATION_FAILED', fields: { 'customer.email': 'Please enter a valid email address.' } } });
  assert.equal(mapped.step, 3);
  assert.deepEqual(mapped.fieldErrors, { email: 'Please enter a valid email address.' });
});

test('an unknown or missing error body falls back to safe copy without echoing it', () => {
  const mapped = mapError({ error: { code: 'WHATEVER', message: '<script>' } });
  assert.equal(mapped.step, 4);
  assert.doesNotMatch(mapped.message, /script/);
  assert.equal(mapError(undefined).step, 4);
});

test('the button label comes from total_cents, or reads BOOK APPOINTMENT with no deposit', () => {
  assert.equal(payLabel(DEPOSIT), 'PAY $50.00 & BOOK');
  assert.equal(payLabel({ ...DEPOSIT, fee_cents: 150, total_cents: 5150 }), 'PAY $51.50 & BOOK');
  assert.equal(payLabel(NO_DEPOSIT), 'BOOK APPOINTMENT');
});

test('a no-deposit service hides the card block and labels the button BOOK APPOINTMENT', () => {
  const html = renderReview({ service: shaping, details, timeLabel: 'Thursday, November 27 · 1:00 PM' });
  assert.doesNotMatch(html, /id="bk-card"/);
  assert.doesNotMatch(html, /Payment secured by Square/);
  assert.match(html, /<button type="submit" class="button button-gold bk-pay"[^>]*>BOOK APPOINTMENT<\/button>/);
  assert.match(html, /id="bk-turnstile"/);
});

test('the review shows the server quote, the card field and no fee line at 0%', () => {
  const html = renderReview({ service: lashLift, details, timeLabel: 'Thursday, November 27 · 1:00 PM' });
  assert.match(html, /Lash lift · 1 hr/);
  assert.match(html, /Thursday, November 27<\/p><span class="bk-cinema-sub">1:00 PM Pacific Time<\/span>/);
  assert.match(html, /Anna Smith<\/p><span class="bk-cinema-sub bk-cinema-sub--contact">Anna@Example\.com<br>\(425\) 845 0045<\/span>/);
  assert.match(html, /Due today[\s\S]*\$50\.00/);
  assert.match(html, /<div class="bk-card-field" id="bk-card"><\/div>/);
  assert.match(html, />PAY \$50\.00 &amp; BOOK</);
  assert.match(html, /Payment secured by Square\./);
  assert.doesNotMatch(html, /Card processing fee/);
  const withFee = renderReview({ service: { ...lashLift, deposit: { ...DEPOSIT, fee_cents: 150, total_cents: 5150, fee_basis_points: 300 } }, details, timeLabel: 'x' });
  assert.match(withFee, /Card processing fee \(3%\)[\s\S]*\$1\.50/);
});

test('renderReview renders the Cinematic Hero Scene with editorial hero photo, 4-column strip, Edit links and unified Back/Pay bar', () => {
  const withBeforeAfterPhoto = {
    ...shaping,
    photo: { src: '/images/Brow%20Lamination%20%26%20Tint/brow-lamination-tint.webp', alt: 'Before/After collage', focal: '50% 35%' }
  };
  const html = renderReview({ service: withBeforeAfterPhoto, details, timeLabel: 'Tuesday, December 15 · 4:30 PM' });
  assert.match(html, /class="bk-cinema-hero"/);
  // Uses the wide editorial hero photo rather than the service's square before/after collage
  assert.match(html, /src="\/images\/hero\/hero-lash\.webp"/);
  assert.match(html, /object-position:\s*78% 42%/);
  assert.match(html, /Your appointment,<br><em>considered\.<\/em>/);
  assert.match(html, /Personal by design\.<br>Perfection in the details\./);
  assert.match(html, /class="bk-cinema-grid"/);
  assert.match(html, /data-goto-step="1"/);
  assert.match(html, /data-goto-step="2"/);
  assert.match(html, /data-goto-step="3"/);
  assert.match(html, /Service price: \$45\.00/);
  assert.match(html, /\$0\.00/);
  assert.match(html, /class="bk-actions bk-cinema-bar"[\s\S]*data-action="back"[\s\S]*class="button button-gold bk-pay"/);
});

test('the submit guard ignores a second submit while the first is in flight', () => {
  const guard = createSubmitGuard();
  assert.equal(guard.tryStart(), true);
  assert.equal(guard.tryStart(), false);
  assert.equal(guard.busy, true);
  guard.finish();
  assert.equal(guard.tryStart(), true);
  guard.lock();
  guard.finish();
  assert.equal(guard.tryStart(), false, 'a locked guard never reopens');
});

test('the Square SDK URL follows checkout.square.environment', () => {
  assert.equal(squareSdkUrl('production'), 'https://web.squarecdn.com/v1/square.js');
  assert.equal(squareSdkUrl('sandbox'), 'https://sandbox.web.squarecdn.com/v1/square.js');
  assert.equal(squareSdkUrl('anything-else'), SQUARE_SDK_URLS.production);
  assert.equal(TURNSTILE_URL, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
});

test('renderReview picks the editorial hero photo that matches the service group', () => {
  const cases = [
    ['brows', '/images/hero/brow-hero.webp', 'Close-up of laminated and shaped brows'],
    ['permanent-makeup', '/images/hero/pmu-hero.webp', 'Permanent makeup with ombré brows, eyeliner and lip blush'],
    ['lash-lift', '/images/hero/hero-lashlift.webp', 'Close-up of naturally lifted lashes'],
    ['lash-refills', '/images/hero/hero-lash.webp', 'Close-up of a woman with softly closed eyes and long, delicate lash extensions'],
    [undefined, '/images/hero/hero-lash.webp', 'Close-up of a woman with softly closed eyes and long, delicate lash extensions']
  ];
  for (const [group, src, alt] of cases) {
    const html = renderReview({ service: { ...shaping, group }, details, timeLabel: 'Tuesday, December 15 · 4:30 PM' });
    assert.match(html, new RegExp(`class="bk-cinema-photo" src="${src.replace(/[.]/g, '\\.')}" alt="${alt}"`), `group ${group}`);
  }
});
