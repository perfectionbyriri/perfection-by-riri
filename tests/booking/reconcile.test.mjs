import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStaleAuthorizations } from '../../worker/src/reconcile.js';
import { SetmoreUnavailable } from '../../worker/src/errors.js';
import { createClock, createMemoryKV } from './helpers/fakes.mjs';

const CONFIG = { setmoreProviderId: 'staff_riri', studioTimezone: 'America/Los_Angeles' };
const NOW = '2026-11-22T20:00:00Z';
const OLD = '2026-11-22T19:45:00.000Z';
const FRESH = '2026-11-22T19:55:00.000Z';

function record(overrides = {}) {
  return {
    state: 'payment_authorized', payment_id: 'pay_1', booking_id: null, customer_id: 'cus_1', service_id: 'svc_lash_lift',
    start_at: '2026-11-23T13:00:00-08:00', result: null, created_at: OLD, updated_at: OLD, complete_attempts: 0, alerted: [],
    ...overrides
  };
}

function setup({ bookings = [], lookup, completeFails = false, cancelFails = false } = {}) {
  const clock = createClock(NOW);
  const kv = createMemoryKV();
  const calls = [];
  const payments = {
    async cancel(id) { calls.push(['cancel', id]); if (cancelFails) throw new Error('down'); },
    async complete(id) { calls.push(['complete', id]); if (completeFails) throw new Error('down'); }
  };
  const lookups = [];
  const client = {
    async listBookingsByStaff(query) {
      lookups.push(query);
      if (lookup) return lookup(query);
      return bookings;
    }
  };
  const alerts = { sent: [], async notify(type, data) { this.sent.push({ type, ...data }); } };
  const run = () => reconcileStaleAuthorizations({ kv, payments, client, alerts, config: CONFIG, now: clock.now });
  const put = (key, value) => kv.put(key, JSON.stringify(value));
  const get = (key) => kv.get(key, 'json');
  return { kv, calls, lookups, alerts, run, put, get, clock };
}

const BOOKING = {
  id: 'bkg_1', provider_id: 'staff_riri', consumer_ids: ['cus_1'], service_id: 'svc_lash_lift',
  start_at: '2026-11-23T13:00:00-08:00', end_at: '2026-11-23T14:00:00-08:00', status: 'CONFIRMED'
};

test('payment_authorized older than 10 min: cancel called, state failed', async () => {
  const { run, put, get, calls, alerts } = setup();
  await put('idem:a', record());
  const summary = await run();
  assert.deepEqual(calls, [['cancel', 'pay_1']]);
  assert.equal((await get('idem:a')).state, 'failed');
  assert.deepEqual(alerts.sent.map((alert) => alert.type), ['orphan_authorization_cancelled']);
  assert.deepEqual(summary, { cancelled: 1, completed: 0, reviewed: 0, alerted: 1 });
});

test('started older than 10 min becomes failed with nothing to cancel', async () => {
  const { run, put, get, calls } = setup();
  await put('idem:a', record({ state: 'started', payment_id: null }));
  await run();
  assert.deepEqual(calls, []);
  assert.equal((await get('idem:a')).state, 'failed');
});

test('booking_requested and Setmore lookup finds the booking: complete called, never cancel, state done', async () => {
  const { run, put, get, calls, lookups } = setup({ bookings: [{ ...BOOKING, id: 'bkg_other', consumer_ids: ['cus_2'] }, BOOKING] });
  await put('idem:a', record({ state: 'booking_requested' }));
  const summary = await run();
  assert.deepEqual(calls, [['complete', 'pay_1']]);
  const saved = await get('idem:a');
  assert.equal(saved.state, 'done');
  assert.equal(saved.booking_id, 'bkg_1');
  assert.deepEqual(lookups, [{ staffId: 'staff_riri', startAt: '2026-11-23T00:00:00-08:00', endAt: '2026-11-24T00:00:00-08:00' }]);
  assert.equal(summary.completed, 1);
});

test('booking_requested matches the booking by instant, not by string', async () => {
  const { run, put, get } = setup({ bookings: [{ ...BOOKING, start_at: '2026-11-23T21:00:00Z' }] });
  await put('idem:a', record({ state: 'booking_requested' }));
  await run();
  assert.equal((await get('idem:a')).state, 'done');
});

test('a cancelled Setmore booking does not count as found', async () => {
  const { run, put, get, calls } = setup({ bookings: [{ ...BOOKING, status: 'CANCELLED' }] });
  await put('idem:a', record({ state: 'booking_requested' }));
  await run();
  assert.deepEqual(calls, []);
  assert.equal((await get('idem:a')).state, 'needs_review');
});

test('booking_requested and lookup finds nothing: NO cancel, state needs_review, booking_outcome_unknown alert once', async () => {
  const { run, put, get, calls, alerts, clock } = setup({ bookings: [] });
  await put('idem:a', record({ state: 'booking_requested' }));
  const summary = await run();
  assert.deepEqual(calls, []);
  const saved = await get('idem:a');
  assert.equal(saved.state, 'needs_review');
  assert.deepEqual(saved.alerted, ['booking_outcome_unknown']);
  assert.deepEqual(alerts.sent, [{ type: 'booking_outcome_unknown', bookingId: null, paymentId: 'pay_1' }]);
  assert.equal(summary.reviewed, 1);
  clock.advance(15 * 60000);
  await run();
  assert.equal(alerts.sent.length, 1, 'needs_review is skipped on later runs');
});

test('booking_requested and lookup fails (503): NO cancel, state needs_review', async () => {
  const { run, put, get, calls } = setup({ lookup: () => { throw new SetmoreUnavailable(); } });
  await put('idem:a', record({ state: 'booking_requested' }));
  await run();
  assert.deepEqual(calls, []);
  assert.equal((await get('idem:a')).state, 'needs_review');
});

test('booking_created: complete retried, never cancel; success → done', async () => {
  const { run, put, get, calls } = setup();
  await put('idem:a', record({ state: 'booking_created', booking_id: 'bkg_1' }));
  await run();
  assert.deepEqual(calls, [['complete', 'pay_1']]);
  assert.equal((await get('idem:a')).state, 'done');
});

test('capture_pending success updates the stored result to captured', async () => {
  const result = { booking: { id: 'bkg_1' }, deposit: { status: 'pending_capture', payment_id: 'pay_1', total_cents: 5000, receipt_url: null } };
  const { run, put, get } = setup();
  await put('idem:a', record({ state: 'capture_pending', booking_id: 'bkg_1', complete_attempts: 1, alerted: ['capture_failed_booking_kept'], result }));
  await run();
  const saved = await get('idem:a');
  assert.equal(saved.state, 'done');
  assert.equal(saved.result.deposit.status, 'captured');
});

test('capture_pending with complete failing 3 times: never cancel, capture_failed_booking_kept alert sent once, complete_attempts capped at 3', async () => {
  const { run, put, get, calls, alerts, clock } = setup({ completeFails: true });
  await put('idem:a', record({ state: 'capture_pending', booking_id: 'bkg_1', complete_attempts: 0 }));
  for (let i = 0; i < 5; i += 1) {
    await run();
    clock.advance(15 * 60000);
  }
  assert.deepEqual(calls, [['complete', 'pay_1'], ['complete', 'pay_1'], ['complete', 'pay_1']]);
  const saved = await get('idem:a');
  assert.equal(saved.complete_attempts, 3);
  assert.equal(saved.state, 'capture_pending');
  assert.deepEqual(alerts.sent.map((alert) => alert.type), ['capture_failed_booking_kept']);
});

test('a booking without a deposit is marked done without payment calls', async () => {
  const { run, put, get, calls } = setup({ bookings: [BOOKING] });
  await put('idem:a', record({ state: 'booking_requested', payment_id: null }));
  await run();
  assert.deepEqual(calls, []);
  assert.equal((await get('idem:a')).state, 'done');
});

test('cancel is never called for any state except payment_authorized', async () => {
  for (const state of ['started', 'booking_requested', 'booking_created', 'capture_pending', 'done', 'failed', 'needs_review']) {
    const { run, put, calls } = setup({ completeFails: true, bookings: [] });
    await put('idem:a', record({ state, booking_id: state.startsWith('booking_c') || state === 'capture_pending' ? 'bkg_1' : null }));
    await run();
    assert.ok(!calls.some(([method]) => method === 'cancel'), state);
  }
});

test('fresh record (5 min) is untouched', async () => {
  const { run, put, get, calls } = setup();
  await put('idem:a', record({ updated_at: FRESH }));
  await run();
  assert.deepEqual(calls, []);
  assert.equal((await get('idem:a')).state, 'payment_authorized');
});

test('done, failed and needs_review are skipped', async () => {
  const { run, put, get, calls, lookups } = setup();
  for (const state of ['done', 'failed', 'needs_review']) await put(`idem:${state}`, record({ state }));
  await run();
  assert.deepEqual(calls, []);
  assert.deepEqual(lookups, []);
  for (const state of ['done', 'failed', 'needs_review']) assert.equal((await get(`idem:${state}`)).updated_at, OLD);
});

test('cancel failure raises payment_cancel_failed', async () => {
  const { run, put, get, alerts } = setup({ cancelFails: true });
  await put('idem:a', record());
  await run();
  assert.deepEqual(alerts.sent, [{ type: 'payment_cancel_failed', bookingId: null, paymentId: 'pay_1' }]);
  const saved = await get('idem:a');
  assert.equal(saved.state, 'payment_authorized', 'retried on the next run');
  assert.deepEqual(saved.alerted, ['payment_cancel_failed']);
});

test('records outside the idem: prefix are ignored', async () => {
  const { run, kv, calls } = setup();
  await kv.put('cust:e:abc', 'cus_1');
  await run();
  assert.deepEqual(calls, []);
});
