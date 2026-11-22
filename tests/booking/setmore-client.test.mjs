import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import {
  SetmoreBusy, SetmoreAuthError, SetmoreConflict, SetmoreRejected, SetmoreUnavailable,
  SetmoreNotFound, SetmoreInvalidResponse
} from '../../worker/src/errors.js';
import { createClock, createFetchRecorder } from './helpers/fakes.mjs';

const API = 'https://developer.setmore.com/api/v2';

function fakeTokens() {
  let n = 0;
  const manager = {
    invalidated: 0,
    async getToken() { return `token-${n + 1}`; },
    async invalidate() { manager.invalidated += 1; n += 1; }
  };
  return manager;
}

function sequence(...responses) {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)];
}

function setup(routes, { clock = createClock() } = {}) {
  const recorder = createFetchRecorder(routes);
  const sleeps = [];
  const tokenManager = fakeTokens();
  const client = createSetmoreClient({
    apiBase: API, tokenManager, fetch: recorder.fetch, now: clock.now,
    sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5
  });
  return { client, recorder, sleeps, tokenManager, clock };
}

const OK_SERVICES = { body: { data: [{ id: 'svc_1', title: 'Lash Lift' }] } };
const TOO_MANY = { status: 429, body: { errors: [{ code: 'rate_limited' }] } };

test('retries a GET after 429 and succeeds', async () => {
  const { client, recorder, sleeps } = setup({ 'GET /api/v2/services': sequence(TOO_MANY, OK_SERVICES) });
  const services = await client.listServices();
  assert.equal(services[0].id, 'svc_1');
  assert.equal(recorder.calls.length, 2);
  assert.deepEqual(sleeps, [400]);
});

test('backoff jitter stays within ±20%', async () => {
  const recorder = createFetchRecorder({ 'GET /api/v2/services': sequence(TOO_MANY, TOO_MANY, OK_SERVICES) });
  const sleeps = [];
  const client = createSetmoreClient({
    apiBase: API, tokenManager: fakeTokens(), fetch: recorder.fetch, now: createClock().now,
    sleep: async (ms) => { sleeps.push(ms); }, random: () => 1
  });
  await client.listServices();
  assert.deepEqual(sleeps, [480, 1440]);
});

test('honours Retry-After up to 3 s', async () => {
  const short = setup({ 'GET /api/v2/services': sequence({ ...TOO_MANY, headers: { 'Retry-After': '2' } }, OK_SERVICES) });
  await short.client.listServices();
  assert.deepEqual(short.sleeps, [2000]);
  const long = setup({ 'GET /api/v2/services': sequence({ ...TOO_MANY, headers: { 'Retry-After': '30' } }, OK_SERVICES) });
  await long.client.listServices();
  assert.deepEqual(long.sleeps, [3000]);
});

test('gives up after two retries with SetmoreBusy', async () => {
  const { client, recorder } = setup({ 'GET /api/v2/services': TOO_MANY });
  await assert.rejects(client.listServices(), SetmoreBusy);
  assert.equal(recorder.calls.length, 3);
});

test('enters cooldown after a final 429', async () => {
  const { client, recorder, clock } = setup({ 'GET /api/v2/services': TOO_MANY });
  await assert.rejects(client.listServices(), SetmoreBusy);
  const before = recorder.calls.length;
  clock.advance(9000);
  await assert.rejects(client.listServices(), (err) => err instanceof SetmoreBusy && err.retryAfterSeconds === 1);
  assert.equal(recorder.calls.length, before);
  clock.advance(1000);
  await assert.rejects(client.listServices(), SetmoreBusy);
  assert.ok(recorder.calls.length > before);
});

test('retries a GET after 5xx and after a timeout', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const { client, recorder } = setup({ 'GET /api/v2/services': sequence({ status: 503, body: {} }, timeout, OK_SERVICES) });
  await client.listServices();
  assert.equal(recorder.calls.length, 3);
});

test('a GET timeout on every attempt becomes SetmoreUnavailable', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const { client } = setup({ 'GET /api/v2/services': () => timeout });
  await assert.rejects(client.listServices(), SetmoreUnavailable);
});

test('never retries a POST on 429', async () => {
  const { client, recorder } = setup({ 'POST /api/v2/bookings': TOO_MANY });
  await assert.rejects(client.createBooking({ type: 'APPOINTMENT' }), SetmoreBusy);
  assert.equal(recorder.calls.length, 1);
});

test('never retries a POST on 5xx and reports an unknown outcome', async () => {
  const { client, recorder } = setup({ 'POST /api/v2/bookings': { status: 502, body: {} } });
  await assert.rejects(client.createBooking({ type: 'APPOINTMENT' }), SetmoreUnavailable);
  assert.equal(recorder.calls.length, 1);
});

test('a POST timeout reports an unknown outcome without retrying', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const { client, recorder } = setup({ 'POST /api/v2/bookings': () => timeout });
  await assert.rejects(client.createBooking({ type: 'APPOINTMENT' }), SetmoreUnavailable);
  assert.equal(recorder.calls.length, 1);
});

test('refreshes the token once on 401 and retries', async () => {
  const { client, recorder, tokenManager } = setup({
    'GET /api/v2/services': (url, init) => (init.headers.Authorization === 'Bearer token-1'
      ? { status: 401, body: { errors: [{ code: 'token_expired' }] } }
      : OK_SERVICES)
  });
  await client.listServices();
  assert.equal(recorder.calls.length, 2);
  assert.equal(tokenManager.invalidated, 1);
  assert.equal(recorder.calls[1].init.headers.Authorization, 'Bearer token-2');
});

test('a second 401 throws SetmoreAuthError', async () => {
  const { client } = setup({ 'GET /api/v2/services': { status: 401, body: {} } });
  await assert.rejects(client.listServices(), SetmoreAuthError);
});

test('a POST is retried once after 401 because it was not processed', async () => {
  const { client, recorder } = setup({ 'POST /api/v2/bookings': sequence({ status: 401, body: {} }, { body: { data: { id: 'bk_1' } } }) });
  assert.deepEqual(await client.createBooking({ type: 'APPOINTMENT' }), { id: 'bk_1' });
  assert.equal(recorder.calls.length, 2);
});

test('maps resource_conflict to SetmoreConflict', async () => {
  const conflict = setup({ 'POST /api/v2/bookings': { status: 400, body: { errors: [{ code: 'resource_conflict' }] } } });
  await assert.rejects(conflict.client.createBooking({}), SetmoreConflict);
  const http409 = setup({ 'POST /api/v2/bookings': { status: 409, body: {} } });
  await assert.rejects(http409.client.createBooking({}), SetmoreConflict);
});

test('maps other 4xx with an error body to SetmoreRejected with the upstream code', async () => {
  const { client } = setup({ 'POST /api/v2/bookings': { status: 400, body: { errors: [{ code: 'parameter_invalid' }] } } });
  await assert.rejects(client.createBooking({}), (err) => err instanceof SetmoreRejected && err.upstreamCode === 'parameter_invalid');
});

test('maps 404 to SetmoreNotFound', async () => {
  const { client } = setup({});
  await assert.rejects(client.getCustomer('missing'), SetmoreNotFound);
});

test('non-JSON success becomes SetmoreInvalidResponse', async () => {
  const { client } = setup({ 'GET /api/v2/services': () => new Response('<html>', { status: 200 }) });
  await assert.rejects(client.listServices(), SetmoreInvalidResponse);
});

test('encodes the offset in start_at and end_at', async () => {
  const { client, recorder } = setup({ 'GET /api/v2/slots': { body: { data: { days: {} } } } });
  await client.getSlots({
    accountId: 'acc', providerId: 'p1', duration: 60, timezone: 'America/Los_Angeles',
    startAt: '2026-11-23T00:00:00-08:00', endAt: '2026-11-30T00:00:00+05:30'
  });
  const search = recorder.calls[0].url.search;
  assert.match(search, /start_at=2026-11-23T00%3A00%3A00-08%3A00/);
  assert.match(search, /end_at=2026-11-30T00%3A00%3A00%2B05%3A30/);
  assert.match(search, /provider_id=p1/);
  assert.match(search, /account_id=acc/);
  assert.match(search, /duration=60/);
  assert.match(search, /timezone=America%2FLos_Angeles/);
  assert.match(search, /slot_limit=100/);
  assert.match(search, /double_booking=false/);
});

test('getSlots returns data.days and rejects a missing days object', async () => {
  const ok = setup({ 'GET /api/v2/slots': { body: { data: { days: { '2026-11-30': [] } } } } });
  assert.deepEqual(await ok.client.getSlots({ accountId: 'a', providerId: 'p', duration: 60, startAt: 's', endAt: 'e', timezone: 'UTC' }), { '2026-11-30': [] });
  const bad = setup({ 'GET /api/v2/slots': { body: { data: {} } } });
  await assert.rejects(bad.client.getSlots({ accountId: 'a', providerId: 'p', duration: 60, startAt: 's', endAt: 'e', timezone: 'UTC' }), SetmoreInvalidResponse);
});

test('listAll follows the cursor to the last page', async () => {
  const { client, recorder } = setup({
    'GET /api/v2/categories': (url) => (url.searchParams.get('cursor') === 'c2'
      ? { body: { data: [{ id: 'cat_2' }] } }
      : { body: { data: [{ id: 'cat_1' }], cursor: 'c2' } })
  });
  assert.deepEqual((await client.listCategories()).map((c) => c.id), ['cat_1', 'cat_2']);
  assert.equal(recorder.calls.length, 2);
});

test('listAll refuses more than 10 pages', async () => {
  const { client } = setup({ 'GET /api/v2/staff': { body: { data: [{ id: 's' }], cursor: 'again' } } });
  await assert.rejects(client.listStaff(), SetmoreUnavailable);
});

test('listBookingsByStaff filters by provider and date window', async () => {
  const { client, recorder } = setup({ 'GET /api/v2/bookings/staffs/p1': { body: { data: [{ id: 'bk_1' }] } } });
  const bookings = await client.listBookingsByStaff({ staffId: 'p1', startAt: '2026-11-30T00:00:00-08:00', endAt: '2026-12-01T00:00:00-08:00' });
  assert.equal(bookings[0].id, 'bk_1');
  assert.equal(recorder.calls[0].url.searchParams.get('start_at'), '2026-11-30T00:00:00-08:00');
  assert.equal(recorder.calls[0].url.searchParams.get('end_at'), '2026-12-01T00:00:00-08:00');
});

test('listCustomersPage returns items and the next cursor', async () => {
  const { client, recorder } = setup({ 'GET /api/v2/customers': { body: { data: [{ id: 'cus_1' }], cursor: 'n2' } } });
  assert.deepEqual(await client.listCustomersPage('n1'), { items: [{ id: 'cus_1' }], cursor: 'n2' });
  assert.equal(recorder.calls[0].url.searchParams.get('cursor'), 'n1');
  assert.equal(recorder.calls[0].url.searchParams.get('limit'), '100');
});

test('POST sends a JSON body with the bearer token', async () => {
  const { client, recorder } = setup({ 'POST /api/v2/customers': { body: { data: { id: 'cus_9' } } } });
  assert.deepEqual(await client.createCustomer({ first_name: 'A' }), { id: 'cus_9' });
  assert.deepEqual(recorder.calls[0].body, { first_name: 'A' });
  assert.equal(recorder.calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(recorder.calls[0].init.headers.Authorization, 'Bearer token-1');
});
