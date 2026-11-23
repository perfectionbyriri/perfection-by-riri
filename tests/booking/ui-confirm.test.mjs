import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, confirmedPath, fireConfirmation, maskEmail, renderConfirmation, trackFunnel } from '../../New Perfection/js/booking/confirm.js';

// The 201 body of POST /api/booking/appointments (ARCHITECTURE §14) plus the
// chosen service id, which the client knows and the response does not echo.
function result(overrides = {}) {
  return {
    booking: { id: 'bk_123', status: 'CONFIRMED', service_name: 'Lash lift', start_at: '2026-11-27T13:00:00-08:00', end_at: '2026-11-27T14:00:00-08:00' },
    deposit: { status: 'captured', payment_id: 'sq_pay_456', total_cents: 5000, receipt_url: 'https://squareup.com/receipt/preview/sq_pay_456' },
    service_id: 'svc_lash_lift',
    ...overrides
  };
}

function sinks() {
  const gtagCalls = [];
  const dataLayer = [];
  const events = [];
  const store = new Map();
  return {
    gtagCalls, dataLayer, events, store,
    deps: {
      gtag: (...args) => gtagCalls.push(args),
      dataLayer,
      dispatch: (event) => events.push(event),
      storage: { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) }
    }
  };
}

const EXPECTED_DETAIL = {
  booking_id: 'bk_123', payment_id: 'sq_pay_456', deposit_cents: 5000, value: 50, currency: 'USD',
  service_id: 'svc_lash_lift', service_name: 'Lash lift'
};

test('fires purchase and booking_confirmed once per booking id', () => {
  const sink = sinks();
  assert.equal(fireConfirmation(result(), sink.deps), true);
  assert.equal(fireConfirmation(result(), sink.deps), false);
  assert.equal(sink.gtagCalls.length, 1);
  assert.equal(sink.dataLayer.length, 1);
  assert.equal(sink.events.length, 1);
  assert.equal(sink.store.get('purchase_sent:bk_123'), '1');
  assert.deepEqual(sink.gtagCalls[0], ['event', 'purchase', {
    transaction_id: 'bk_123', value: 50, currency: 'USD', items: [{ item_id: 'svc_lash_lift', item_name: 'Lash lift' }]
  }]);
});

test('booking_confirmed detail has booking_id, payment_id, deposit_cents 5000, value 50, currency USD, service_id, service_name', () => {
  const sink = sinks();
  fireConfirmation(result(), sink.deps);
  assert.deepEqual(sink.dataLayer[0], { event: 'booking_confirmed', ...EXPECTED_DETAIL });
});

test('dispatches pbr:booking-confirmed CustomEvent with the same detail', () => {
  const sink = sinks();
  fireConfirmation(result(), sink.deps);
  assert.ok(sink.events[0] instanceof CustomEvent);
  assert.equal(sink.events[0].type, 'pbr:booking-confirmed');
  assert.deepEqual(sink.events[0].detail, EXPECTED_DETAIL);
});

test('a no-deposit booking fires with payment_id null and value 0', () => {
  const sink = sinks();
  const ok = fireConfirmation(result({ deposit: { status: 'none', payment_id: null, total_cents: 0, receipt_url: null } }), sink.deps);
  assert.equal(ok, true);
  assert.equal(sink.dataLayer[0].payment_id, null);
  assert.equal(sink.dataLayer[0].deposit_cents, 0);
  assert.equal(sink.dataLayer[0].value, 0);
});

test('does not fire when deposit.status is pending_capture', () => {
  const sink = sinks();
  assert.equal(fireConfirmation(result({ deposit: { status: 'pending_capture', payment_id: 'sq', total_cents: 5000 } }), sink.deps), false);
  assert.equal(fireConfirmation(result({ booking: { ...result().booking, status: 'PENDING' } }), sink.deps), false);
  assert.equal(sink.gtagCalls.length + sink.dataLayer.length + sink.events.length, 0);
});

test('fires even when storage throws (private mode), and still only once per page', () => {
  const sink = sinks();
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const deps = { ...sink.deps, storage: broken };
  assert.equal(fireConfirmation(result(), deps), true);
  assert.equal(fireConfirmation(result(), deps), false);
  assert.equal(sink.dataLayer.length, 1);
});

test('buildIcs uses TZID America/Los_Angeles and the booking start/end', () => {
  const ics = buildIcs(result().booking, { now: new Date('2026-11-22T20:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nBEGIN:VTIMEZONE\r\nTZID:America\/Los_Angeles\r\n/);
  assert.match(ics, /\r\nDTSTART;TZID=America\/Los_Angeles:20261127T130000\r\n/);
  assert.match(ics, /\r\nDTEND;TZID=America\/Los_Angeles:20261127T140000\r\n/);
  assert.match(ics, /\r\nUID:bk_123@perfectionbyriri\.com\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261122T200000Z\r\n/);
  assert.match(ics, /\r\nSUMMARY:Lash lift · Perfection by Riri\r\n/);
  assert.match(ics, /\r\nLOCATION:18205 Alderwood Mall Pkwy A\\, Suite 918\\, Lynnwood\\, WA 98037\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.doesNotMatch(ics, /[^\r]\n/, 'CRLF line endings only');
});

test('trackFunnel sends booking_view_service, booking_select_slot, booking_begin_checkout and booking_slot_conflict with service_id only (no PII)', () => {
  const calls = [];
  const gtag = (...args) => calls.push(args);
  for (const name of ['booking_view_service', 'booking_select_slot', 'booking_begin_checkout', 'booking_slot_conflict']) {
    assert.equal(trackFunnel(name, { service_id: 'svc_lash_lift', email: 'anna@example.com', phone: '4258450045', first_name: 'Anna' }, gtag), true);
  }
  assert.deepEqual(calls.map((call) => call[1]), ['booking_view_service', 'booking_select_slot', 'booking_begin_checkout', 'booking_slot_conflict']);
  for (const call of calls) assert.deepEqual(call[2], { service_id: 'svc_lash_lift' });
  assert.equal(trackFunnel('purchase', { service_id: 'x' }, gtag), false);
  assert.equal(trackFunnel('booking_view_service', { service_id: 'x' }, undefined), false);
  assert.equal(calls.length, 4);
});

test('the confirmed URL is /book/confirmed/?ref=<booking id>', () => {
  assert.equal(confirmedPath('bk_123'), '/book/confirmed/?ref=bk_123');
  assert.equal(confirmedPath('a b&c'), '/book/confirmed/?ref=a%20b%26c');
});

test('maskEmail keeps only the local part', () => {
  assert.equal(maskEmail('anna@example.com'), 'anna@…');
  assert.equal(maskEmail('nope'), '');
});

test('the confirmation view follows D§4 step 5', () => {
  const html = renderConfirmation({ result: result(), firstName: 'Anna', email: 'anna@example.com', timeLabel: 'Thursday, November 27 · 1:00 PM' });
  assert.match(html, /You&rsquo;re booked/);
  assert.match(html, /<h2 class="bk-step-title bk-confirm-title" tabindex="-1">See you soon,<br><em>Anna\.<\/em><\/h2>/);
  assert.match(html, /Lash lift/);
  assert.match(html, /Thursday, November&nbsp;27<\/p><span class="bk-cinema-sub">1:00 PM Pacific Time<\/span>/);
  assert.match(html, /Studio location<\/h3><\/div><p class="bk-confirm-line bk-cinema-info-title">18205 Alderwood Mall Pkwy A, Suite&nbsp;918<\/p><span class="bk-cinema-sub">Lynnwood, WA 98037<\/span>/);
  assert.doesNotMatch(html, /Perfection by Riri · Lynnwood, WA/);
  assert.match(html, /href="https:\/\/maps\.app\.goo\.gl\/2zzJp92GvUAGifaV8\?g_st=ic"[^>]*>Directions<\/a>/);
  assert.match(html, /Deposit paid \$50\.00 · Receipt from Square sent to anna@…/);
  assert.match(html, /data-action="add-to-calendar"[^>]*>Add to calendar</);
  assert.match(html, /Need to change or cancel\?[\s\S]*Call <a href="tel:\+14258450045">\(425\) 845 0045<\/a>\./);
  assert.match(html, /Cancellations made on the same day as your appointment will result in the forfeiture of your \$50 deposit\./);
});

test('the confirmation view drops the deposit line for a no-deposit booking and escapes names', () => {
  const html = renderConfirmation({
    result: result({ deposit: { status: 'none', payment_id: null, total_cents: 0 } }),
    firstName: '<Anna>', email: 'anna@example.com', timeLabel: 'x'
  });
  assert.doesNotMatch(html, /Deposit paid/);
  assert.match(html, /See you soon,<br><em>&lt;Anna&gt;\.<\/em>/);
});

test('renderConfirmation renders the Cinematic Hero Scene with editorial hero photo, 4-column strip and Suite 918 address', () => {
  const service = {
    service_id: 'svc_lash_lift',
    name: 'Lash lift',
    duration_minutes: 60,
    price_cents: 9500,
    photo: { src: '/images/Lash%20Lift/lash-lift.webp', alt: 'Lash lift result', focal: '50% 40%' }
  };
  const html = renderConfirmation({
    result: result(),
    service,
    firstName: 'Anna',
    email: 'anna@example.com',
    timeLabel: 'Thursday, November 27 · 1:00 PM'
  });
  assert.match(html, /class="bk-cinema-hero bk-cinema-hero--confirm"/);
  assert.match(html, /src="\/images\/hero\/hero-lash\.webp"/);
  assert.match(html, /object-position:\s*78% 42%/);
  assert.match(html, /Personal by design\.<br>Perfection in the details\./);
  assert.match(html, /class="bk-cinema-grid"/);
  assert.match(html, /18205 Alderwood Mall Pkwy A, Suite&nbsp;918/);
  assert.match(html, /1 hr · \$95\.00/);
});

test('renderConfirmation picks the editorial hero photo that matches the service group', () => {
  const brows = { service_id: 'svc_eyebrow_shaping', name: 'Eyebrow shaping', duration_minutes: 30, price_cents: 4500, group: 'brows' };
  assert.match(renderConfirmation({ result: result(), service: brows }), /class="bk-cinema-photo" src="\/images\/hero\/brow-hero\.webp" alt="Close-up of laminated and shaped brows"/);
  const pmu = { ...brows, group: 'permanent-makeup' };
  assert.match(renderConfirmation({ result: result(), service: pmu }), /src="\/images\/hero\/pmu-hero\.webp"/);
});

test('renderConfirmation shows Directions once and labels the deposit column for what it holds', () => {
  const paid = renderConfirmation({ result: result(), firstName: 'Anna', email: 'anna@example.com', timeLabel: 'Thursday, November 27 · 1:00 PM' });
  assert.equal(paid.match(/maps\.app\.goo\.gl/g).length, 1, 'one Directions link');
  assert.match(paid, /<h3 class="bk-cinema-col-label">Deposit &amp; changes<\/h3>[\s\S]*Deposit paid \$50\.00[\s\S]*Need to change or cancel\?/);
  assert.doesNotMatch(paid, /Questions or changes/);
  const noDeposit = renderConfirmation({ result: result({ deposit: { status: 'none' } }), timeLabel: 'Thursday, November 27 · 1:00 PM' });
  assert.match(noDeposit, /<h3 class="bk-cinema-col-label">Questions or changes<\/h3>/);
  assert.doesNotMatch(noDeposit, /Deposit &amp; changes/);
});
