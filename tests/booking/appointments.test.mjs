import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAppointmentService, validateAppointmentInput } from '../../worker/src/appointments.js';
import { createCatalogService } from '../../worker/src/catalog.js';
import { createSlotsService } from '../../worker/src/slots.js';
import { createCustomerResolver } from '../../worker/src/customers.js';
import { createMockSquare } from '../../worker/src/payments/mock.js';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { createMockSetmoreFetch, createMockState } from '../../worker/src/setmore/mock.js';
import { MOCK_ACCOUNT_ID, MOCK_PROVIDER_ID } from '../../worker/src/setmore/fixtures.js';
import { loadConfig } from '../../worker/src/config.js';
import { BookingError, PaymentDeclined, SetmoreUnavailable, toBookingError } from '../../worker/src/errors.js';
import { createClock, createMemoryCache, createMemoryKV } from './helpers/fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'worker/config/services-meta.json'), 'utf8'));
const API = 'https://developer.setmore.com/api/v2';
const KEY = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const IDEM = `idem:${createHash('sha256').update(KEY).digest('hex')}`;
const CONFIG = { ...loadConfig({}), setmoreAccountId: MOCK_ACCOUNT_ID, setmoreProviderId: MOCK_PROVIDER_ID };

const RAW = {
  idempotency_key: KEY,
  service_id: 'svc_lash_lift',
  start_at: '2026-11-23T13:00:00-08:00',
  customer: { first_name: 'Anna', last_name: 'Smith', email: 'anna@example.com', phone: '(425) 845-0045' },
  notes: 'First visit',
  policy_accepted: true,
  turnstile_token: 'turnstile-ok',
  payment: { source_id: 'cnon:card-nonce-ok', verification_token: 'verf-1' }
};

// Real catalog, slots, customer resolver and Setmore client over MockSetmore;
// MockSquare for payments. `intercept(call)` may replace a Setmore answer.
function setup({ scenario = 'normal', squareScenario = 'approve', intercept = () => null, slotsOverride } = {}) {
  const clock = createClock('2026-11-22T20:00:00Z');
  const state = createMockState();
  const mock = createMockSetmoreFetch({ scenario, now: clock.now, state });
  const kv = createMemoryKV();
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const call = { method: (init.method ?? 'GET').toUpperCase(), path: url.pathname.replace('/api/v2', ''), url, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return (await intercept(call, { kv })) ?? mock(input, init);
  };
  const tokenManager = createTokenManager({ refreshToken: 'mock', apiBase: API, fetch, now: clock.now });
  const client = createSetmoreClient({ apiBase: API, tokenManager, fetch, now: clock.now, sleep: async () => {}, random: () => 0.5 });
  const cache = createMemoryCache(clock);
  const catalog = createCatalogService({ client, meta: META, config: CONFIG, cache, now: clock.now });
  const slots = slotsOverride ?? createSlotsService({ client, catalog, config: CONFIG, cache, now: clock.now });
  const customers = createCustomerResolver({ client, kv, secret: 'test-secret', maxPages: 20 });
  const payments = createMockSquare({ scenario: squareScenario });
  const alerts = { sent: [], async notify(type, data) { this.sent.push({ type, ...data }); } };
  const events = [];
  const service = createAppointmentService({
    client, catalog, slots, customers, payments, kv, alerts, config: CONFIG, now: clock.now,
    log: (event, fields) => events.push({ event, ...fields })
  });
  const count = (method, p) => calls.filter((call) => call.method === method && call.path === p).length;
  const record = () => kv.get(IDEM, 'json');
  return { service, payments, alerts, kv, state, calls, count, record, events, clock };
}

const methods = (payments) => payments.calls.map((call) => call.method);

// Asserts the client-facing error code, as the router maps it with toBookingError.
async function rejectsWith(promise, code) {
  let caught;
  await assert.rejects(promise, (err) => { caught = toBookingError(err); return caught.code === code; });
  return caught;
}

test('happy path: authorize → customer → re-check → booking → complete → 201 with payment_id', async () => {
  const { service, payments, state, record, count } = setup();
  const { status, body } = await service.create(RAW);
  assert.equal(status, 201);
  const [booking] = state.bookings.values();
  assert.deepEqual(body, {
    booking: { id: booking.id, status: 'CONFIRMED', service_name: 'Lash Lift', start_at: '2026-11-23T13:00:00-08:00', end_at: '2026-11-23T14:00:00-08:00' },
    deposit: { status: 'captured', payment_id: 'mock_pay_000001', total_cents: 5000, receipt_url: null }
  });
  assert.deepEqual(methods(payments), ['authorize', 'complete']);
  assert.equal(payments.payments.get('mock_pay_000001').status, 'COMPLETED');
  assert.equal(count('GET', '/slots'), 2, 'two fresh checks');
  assert.equal(booking.consumer_ids.length, 1);
  assert.equal(booking.provider_id, MOCK_PROVIDER_ID);
  assert.equal(booking.cost, 115);
  const saved = await record();
  assert.equal(saved.state, 'done');
  assert.equal(saved.payment_id, 'mock_pay_000001');
  assert.equal(saved.booking_id, booking.id);
  assert.deepEqual(saved.result, body);
});

test('slot gone at first check: 409 SLOT_TAKEN with refreshed_week, no authorize call', async () => {
  const { service, payments, record } = setup();
  const err = await rejectsWith(service.create({ ...RAW, start_at: '2026-11-23T13:10:00-08:00' }), 'SLOT_TAKEN');
  assert.equal(err.extra.refreshed_week.week_start, '2026-11-23');
  assert.ok(err.extra.refreshed_week.days[0].slots.length > 0);
  assert.deepEqual(methods(payments), []);
  assert.equal((await record()).state, 'failed');
});

test('slot gone at second check (mock slot_taken): cancel called once, 409 SLOT_TAKEN', async () => {
  const { service, payments, count } = setup({ scenario: 'slot_taken' });
  await rejectsWith(service.create(RAW), 'SLOT_TAKEN');
  assert.deepEqual(methods(payments), ['authorize', 'cancel']);
  assert.equal(count('POST', '/bookings'), 0);
});

test('Setmore conflict on create: cancel called, 409 SLOT_TAKEN', async () => {
  const { service, payments, record } = setup({ scenario: 'slot_taken_on_create' });
  await rejectsWith(service.create(RAW), 'SLOT_TAKEN');
  assert.deepEqual(methods(payments), ['authorize', 'cancel']);
  assert.equal((await record()).state, 'failed');
});

const answer = (status, code) => new Response(JSON.stringify({ errors: [{ code }] }), { status, headers: { 'Content-Type': 'application/json' } });
const onBookingPost = (respond) => (call, ctx) => (call.method === 'POST' && call.path === '/bookings' ? respond(call, ctx) : null);

test('Setmore 4xx rejection on create (parameter_invalid): cancel called, record failed', async () => {
  const { service, payments, record } = setup({ intercept: onBookingPost(() => answer(400, 'parameter_invalid')) });
  await rejectsWith(service.create(RAW), 'UPSTREAM_UNAVAILABLE');
  assert.deepEqual(methods(payments), ['authorize', 'cancel']);
  assert.equal((await record()).state, 'failed');
});

test('Setmore 429 on create: cancel called, 503 UPSTREAM_BUSY', async () => {
  const { service, payments, count } = setup({ intercept: onBookingPost(() => answer(429, 'rate_limited')) });
  const err = await rejectsWith(service.create(RAW), 'UPSTREAM_BUSY');
  assert.equal(err.status, 503);
  assert.deepEqual(methods(payments), ['authorize', 'cancel']);
  assert.equal(count('POST', '/bookings'), 1, 'never retried');
});

test('Setmore 503 on create: NO cancel, 503 BOOKING_PENDING_CONFIRMATION, record stays booking_requested', async () => {
  const { service, payments, record } = setup({ intercept: onBookingPost(() => answer(503, 'unavailable')) });
  const err = await rejectsWith(service.create(RAW), 'BOOKING_PENDING_CONFIRMATION');
  assert.equal(err.status, 503);
  assert.deepEqual(methods(payments), ['authorize']);
  const saved = await record();
  assert.equal(saved.state, 'booking_requested');
  assert.equal(saved.payment_id, 'mock_pay_000001');
  assert.ok(saved.customer_id);
});

test('Setmore timeout on create: NO cancel, record stays booking_requested', async () => {
  const timeout = () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); };
  const { service, payments, record } = setup({ intercept: onBookingPost(timeout) });
  await rejectsWith(service.create(RAW), 'BOOKING_PENDING_CONFIRMATION');
  assert.deepEqual(methods(payments), ['authorize']);
  assert.equal((await record()).state, 'booking_requested');
});

test('state is booking_requested in KV before the Setmore POST is sent', async () => {
  let seen = null;
  const { service } = setup({ intercept: onBookingPost(async (call, { kv }) => { seen = await kv.get(IDEM, 'json'); return null; }) });
  await service.create(RAW);
  assert.equal(seen.state, 'booking_requested');
  assert.equal(seen.payment_id, 'mock_pay_000001');
});

test('customer resolution fails: cancel called', async () => {
  const { service, payments, count, record } = setup({
    intercept: (call) => (call.method === 'POST' && call.path === '/customers' ? answer(503, 'unavailable') : null)
  });
  await assert.rejects(service.create(RAW), SetmoreUnavailable);
  assert.deepEqual(methods(payments), ['authorize', 'cancel']);
  assert.equal(count('POST', '/bookings'), 0);
  assert.equal((await record()).state, 'failed');
});

test('a failed cancel raises payment_cancel_failed', async () => {
  const { service, payments, alerts } = setup({ scenario: 'slot_taken' });
  payments.cancel = async () => { throw new Error('square down'); };
  await rejectsWith(service.create(RAW), 'SLOT_TAKEN');
  assert.deepEqual(alerts.sent.map((alert) => [alert.type, alert.paymentId]), [['payment_cancel_failed', 'mock_pay_000001']]);
});

test('payment declined: 402 PAYMENT_DECLINED, no customer created, no booking', async () => {
  const { service, count, record } = setup({ squareScenario: 'decline' });
  await assert.rejects(service.create(RAW), (err) => err instanceof PaymentDeclined && err.category === 'CARD_DECLINED');
  assert.equal(count('GET', '/customers'), 0);
  assert.equal(count('POST', '/customers'), 0);
  assert.equal(count('POST', '/bookings'), 0);
  assert.equal((await record()).state, 'failed');
});

test('complete fails: 201 with deposit.status pending_capture and capture_failed_booking_kept alert', async () => {
  const { service, alerts, record, state } = setup({ squareScenario: 'complete_fails' });
  const { status, body } = await service.create(RAW);
  assert.equal(status, 201);
  assert.equal(body.deposit.status, 'pending_capture');
  assert.equal(body.deposit.payment_id, 'mock_pay_000001');
  const [booking] = state.bookings.values();
  assert.deepEqual(alerts.sent, [{ type: 'capture_failed_booking_kept', bookingId: booking.id, paymentId: 'mock_pay_000001' }]);
  const saved = await record();
  assert.equal(saved.state, 'capture_pending');
  assert.equal(saved.complete_attempts, 1);
  assert.deepEqual(saved.alerted, ['capture_failed_booking_kept']);
});

test('post-check overlap: 201 and double_booking_detected alert, no cancel', async () => {
  const { service, payments, alerts, state } = setup({ scenario: 'double_booked_after_create' });
  const { status, body } = await service.create(RAW);
  assert.equal(status, 201);
  assert.deepEqual(methods(payments), ['authorize', 'complete']);
  const other = [...state.bookings.values()].find((item) => item.id !== body.booking.id);
  assert.deepEqual(alerts.sent, [{ type: 'double_booking_detected', bookingId: body.booking.id, paymentId: 'mock_pay_000001', extra: { other_booking_ids: [other.id] } }]);
});

test('no-deposit service: no payment calls, deposit.status none, payment_id null', async () => {
  const { service, payments, state } = setup();
  const { status, body } = await service.create({ ...RAW, service_id: 'svc_lash_removal', payment: undefined });
  assert.equal(status, 201);
  assert.deepEqual(methods(payments), []);
  assert.deepEqual(body.deposit, { status: 'none', payment_id: null, total_cents: 0, receipt_url: null });
  const [booking] = state.bookings.values();
  assert.ok(!booking.notes.includes('Square'));
});

test('a deposit service without payment details fails validation before any upstream call', async () => {
  const { service, calls } = setup();
  const err = await rejectsWith(service.create({ ...RAW, payment: undefined }), 'VALIDATION_FAILED');
  assert.ok(err.fields.payment);
  assert.equal(calls.filter((call) => call.path !== '/services' && call.path !== '/categories' && call.path !== '/staff' && !call.path.includes('oauth2')).length, 0);
});

test('same idempotency key while in progress → 409 IN_PROGRESS', async () => {
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const slotsOverride = {
    async isSlotAvailable() {
      entered();
      await new Promise((resolve) => { release = resolve; });
      return { available: false, refreshedWeek: null };
    },
    async purgeWeek() {}
  };
  const { service, payments } = setup({ slotsOverride });
  const first = service.create(RAW);
  await enteredPromise;
  await rejectsWith(service.create(RAW), 'IN_PROGRESS');
  release();
  await rejectsWith(first, 'SLOT_TAKEN');
  assert.deepEqual(methods(payments), []);
});

test('same idempotency key after success → 200 with the stored body, no new calls', async () => {
  const { service, payments, calls } = setup();
  const created = await service.create(RAW);
  const before = { setmore: calls.length, square: payments.calls.length };
  const repeat = await service.create(RAW);
  assert.equal(repeat.status, 200);
  assert.deepEqual(repeat.body, created.body);
  assert.deepEqual({ setmore: calls.length, square: payments.calls.length }, before);
});

test('a failed attempt may be retried with the same key', async () => {
  const { service } = setup();
  await rejectsWith(service.create({ ...RAW, start_at: '2026-11-23T13:10:00-08:00' }), 'SLOT_TAKEN');
  assert.equal((await service.create(RAW)).status, 201);
});

test('start_at in Z form matches the PST slot', async () => {
  const { service, state } = setup();
  const { body } = await service.create({ ...RAW, start_at: '2026-11-23T21:00:00Z' });
  assert.equal(body.booking.start_at, '2026-11-23T13:00:00-08:00');
  assert.equal([...state.bookings.values()][0].start_at, '2026-11-23T13:00:00-08:00');
});

test('amount_cents in the request is ignored; authorize receives the server quote 5000', async () => {
  const { service, payments } = setup();
  const { body } = await service.create({ ...RAW, amount_cents: 1, deposit: { total_cents: 1 }, payment: { ...RAW.payment, amount_cents: 1 } });
  assert.equal(payments.calls[0].amountCents, 5000);
  assert.equal(body.deposit.total_cents, 5000);
});

test('end_at is computed from the catalog duration', async () => {
  const { service, state } = setup();
  const { body } = await service.create({ ...RAW, service_id: 'svc_classic_full_extension', end_at: '2026-11-23T13:15:00-08:00' });
  assert.equal(body.booking.end_at, '2026-11-23T15:00:00-08:00');
  assert.equal([...state.bookings.values()][0].end_at, '2026-11-23T15:00:00-08:00');
});

test('booking notes contain the Square payment id and no fee clause when fee is 0', async () => {
  const { service, state } = setup();
  await service.create(RAW);
  const [booking] = state.bookings.values();
  assert.equal(booking.notes, 'First visit\n\nDeposit paid online via Square: $50.00. Square payment mock_pay_000001. Booked on perfectionbyriri.com.');
  assert.ok(!/fee/i.test(booking.notes));
});

test('idempotency record never contains email or phone, and lives 72 h', async () => {
  const { service, kv } = setup();
  await service.create(RAW);
  const entry = kv.entries().find((item) => item.key === IDEM);
  for (const raw of ['anna@example.com', '4258450045', '845-0045', 'Anna', 'Smith']) assert.ok(!entry.value.includes(raw), raw);
  assert.equal(entry.options.expirationTtl, 259200);
});

test('validateAppointmentInput normalizes input and drops unknown fields', () => {
  const input = validateAppointmentInput({ ...RAW, customer: { ...RAW.customer, email: ' Anna@Example.COM ', first_name: ' Anna ' }, extra: 'x' });
  assert.deepEqual(input, {
    idempotencyKey: KEY,
    serviceId: 'svc_lash_lift',
    startAt: '2026-11-23T13:00:00-08:00',
    customer: { firstName: 'Anna', lastName: 'Smith', email: 'anna@example.com', phone: '+14258450045' },
    notes: 'First visit',
    payment: { sourceId: 'cnon:card-nonce-ok', verificationToken: 'verf-1' }
  });
});

test('validateAppointmentInput reports every invalid field', () => {
  let caught;
  assert.throws(() => validateAppointmentInput({
    idempotency_key: 'not-a-uuid', service_id: '', start_at: 'tomorrow',
    customer: { first_name: '', last_name: 'x'.repeat(61), email: 'anna@', phone: '12345' },
    notes: 'n'.repeat(501), policy_accepted: false, payment: { source_id: '' }
  }), (err) => { caught = err; return err instanceof BookingError && err.code === 'VALIDATION_FAILED'; });
  assert.deepEqual(Object.keys(caught.fields).sort(), [
    'customer.email', 'customer.first_name', 'customer.last_name', 'customer.phone', 'idempotency_key', 'notes',
    'payment.source_id', 'policy_accepted', 'service_id', 'start_at'
  ]);
  assert.throws(() => validateAppointmentInput(null), BookingError);
  assert.throws(() => validateAppointmentInput({ ...RAW, customer: { ...RAW.customer, email: `${'a'.repeat(250)}@b.co` } }), BookingError);
});
