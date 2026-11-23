import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { runRead } from '../../worker/tools/setmore-verify.js';
import { createClock, createFetchRecorder } from './helpers/fakes.mjs';

const API = 'https://developer.setmore.com/api/v2';
const PROVIDER = 'prov-1';
const CONFIG = { setmoreAccountId: 'acct-1', setmoreProviderId: PROVIDER, studioTimezone: 'America/Los_Angeles' };
const META = { version: 1, groups: [], services: [{ service_id: 'svc_lip_blushing' }, { service_id: 'svc_brow_tint' }] };
const SERVICES = [
  { id: 'real-lip', title: 'Lip Blushing', duration: 60, cost: 450, buffer: { before: 0, after: 0 }, provider_ids: [PROVIDER], visibility: 'PUBLIC' },
  { id: 'real-tint', title: 'Brow Tint', duration: 30, cost: 30, buffer: { before: 0, after: 0 }, provider_ids: [PROVIDER], visibility: 'PUBLIC' }
];
// Studio date 2026-11-22 (Sunday); the run covers four weeks from that date.
const BOOKING = {
  id: 'booking-secret-id', consumer_ids: ['c-secret'], title: 'Jane Doe', service_id: 'real-lip',
  start_at: '2026-11-24T10:00:00-08:00', end_at: '2026-11-24T11:00:00-08:00', status: 'CONFIRMED'
};

const CUSTOMERS_PAGE_1 = [
  {
    id: 'cust-secret-1',
    first_name: 'Alice',
    last_name: 'Secret',
    email_addresses: [{ value: 'alice@secret.example' }],
    phone_numbers: [{ value: '+14255550199' }]
  }
];

function setup({ slotsFor = () => ({}), services = SERVICES, bookings = [BOOKING], customers } = {}) {
  const clock = createClock('2026-11-22T20:00:00Z');
  const defaultCustomers = () => ({ body: { data: CUSTOMERS_PAGE_1 } });
  const recorder = createFetchRecorder({
    'GET /api/v2/o/oauth2/token': { body: { data: { token: { access_token: 'access', expires_in: 3600 } } } },
    'GET /api/v2/services': { body: { data: services } },
    [`GET /api/v2/bookings/staffs/${PROVIDER}`]: { body: { data: bookings } },
    'GET /api/v2/slots': (url) => ({ body: { data: { days: slotsFor(url) } } }),
    'GET /api/v2/customers': (url) => (customers ? customers(url, clock) : defaultCustomers())
  });
  const tokenManager = createTokenManager({ refreshToken: 'refresh', apiBase: API, fetch: recorder.fetch, now: clock.now });
  const client = createSetmoreClient({ apiBase: API, tokenManager, fetch: recorder.fetch, now: clock.now, sleep: async () => {} });
  const lines = [];
  const log = (line) => lines.push(String(line));
  return { recorder, client, clock, lines, log };
}

const freeSlot = { '2026-11-24': [{ start_at: '2026-11-24T13:00:00-08:00', end_at: '2026-11-24T14:00:00-08:00' }] };
const takenSlot = { '2026-11-24': [{ start_at: '2026-11-24T10:00:00-08:00', end_at: '2026-11-24T11:00:00-08:00' }] };

test('runRead reports no conflicts when slots avoid bookings', async () => {
  const { client, clock, log } = setup({ slotsFor: () => freeSlot });
  const result = await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  assert.equal(result.ok, true);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.catalog.map.length, 2);
  assert.equal(result.bufferHonoured, null);
});

test('runRead reports a conflict and ok=false when a slot overlaps a confirmed booking', async () => {
  const { client, clock, log } = setup({ slotsFor: () => takenSlot });
  const result = await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  assert.equal(result.ok, false);
  assert.ok(result.conflicts.some((c) => c.working_hours === false && c.date === '2026-11-24' && c.start === '10:00'));
});

test('runRead fails when a whitelisted service is missing in Setmore', async () => {
  const { client, clock, log } = setup({ slotsFor: () => freeSlot, services: [SERVICES[0]] });
  const result = await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  assert.equal(result.ok, false);
  assert.deepEqual(result.catalog.unmatched, ['svc_brow_tint']);
});

test('runRead calls /slots with working_hours false and true for each distinct duration over 4 weeks', async () => {
  const { client, clock, log, recorder } = setup({ slotsFor: () => freeSlot });
  await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  const slotCalls = recorder.calls.filter((call) => call.path === '/api/v2/slots');
  assert.equal(slotCalls.length, 2 * 4 * 2);
  const first = slotCalls[0].url.searchParams;
  assert.equal(first.get('double_booking'), 'false');
  assert.equal(first.get('account_id'), 'acct-1');
  assert.equal(first.get('provider_id'), PROVIDER);
  assert.equal(first.get('timezone'), 'America/Los_Angeles');
  assert.deepEqual(new Set(slotCalls.map((call) => call.url.searchParams.get('working_hours'))), new Set(['false', 'true']));
  assert.deepEqual(new Set(slotCalls.map((call) => call.url.searchParams.get('duration'))), new Set(['60', '30']));
  assert.equal(first.get('start_at'), '2026-11-22T00:00:00-08:00');
});

test('runRead detects that Setmore ignores buffers', async () => {
  const buffered = [{ ...SERVICES[0], buffer: { before: 15, after: 0 } }];
  const nearBooking = { '2026-11-24': [{ start_at: '2026-11-24T11:00:00-08:00', end_at: '2026-11-24T12:00:00-08:00' }] };
  const { client, clock, log } = setup({ slotsFor: () => nearBooking, services: buffered });
  const meta = { ...META, services: [{ service_id: 'svc_lip_blushing' }] };
  const result = await runRead({ client, meta, config: CONFIG, now: clock.now, log });
  assert.equal(result.bufferHonoured, false);
  assert.equal(result.ok, false);
});

test('runRead makes only GET requests', async () => {
  const { client, clock, log, recorder } = setup({ slotsFor: () => freeSlot });
  await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  assert.ok(recorder.calls.length > 0);
  assert.ok(recorder.calls.every((call) => call.method === 'GET'));
});

test('runRead logs the public catalog map but never consumer or booking data', async () => {
  const { client, clock, log, lines } = setup({ slotsFor: () => takenSlot });
  await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  const text = lines.join('\n');
  assert.match(text, /^CATALOG_MAP \[/m);
  assert.match(text, /real-lip/);
  for (const secret of ['c-secret', 'Jane Doe', 'booking-secret-id', 'consumer_ids']) assert.ok(!text.includes(secret), secret);
});

test('runRead logs a histogram of raw slot start times per duration (times only)', async () => {
  const { client, clock, log, lines } = setup({ slotsFor: () => freeSlot });
  await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  const line = lines.find((item) => item.startsWith('slot_times duration=60 working_hours=false'));
  assert.ok(line, 'histogram line present');
  assert.match(line, /"13:00":4/);
});

test('runRead pages through GET /customers?limit=100 and logs only counts and timings without contact fields', async () => {
  const page2 = [
    {
      id: 'cust-secret-2',
      first_name: 'Bob',
      last_name: 'Private',
      email: 'bob@secret.example',
      phone: '2065550188',
      email_addresses: [{ value: 'bob@secret.example' }],
      phone_numbers: [{ value: '+12065550188' }]
    },
    {
      id: 'cust-secret-3',
      first_name: 'Carol',
      last_name: 'Hidden',
      email_addresses: [{ value: 'carol@secret.example' }],
      phone_numbers: [{ value: '+12065550177' }]
    }
  ];
  const { client, clock, log, lines, recorder } = setup({
    slotsFor: () => freeSlot,
    customers: (url, clk) => {
      const cursor = url.searchParams.get('cursor');
      if (!cursor) {
        clk.advance(120);
        return { body: { data: CUSTOMERS_PAGE_1, cursor: 'cur-2' } };
      }
      clk.advance(280);
      return { body: { data: page2 } };
    }
  });
  await runRead({ client, meta: META, config: CONFIG, now: clock.now, log });
  const customerCalls = recorder.calls.filter((call) => call.path === '/api/v2/customers');
  assert.equal(customerCalls.length, 2);
  assert.equal(customerCalls[0].url.searchParams.get('limit'), '100');
  assert.equal(customerCalls[1].url.searchParams.get('cursor'), 'cur-2');
  const text = lines.join('\n');
  assert.match(text, /^customers_pages=2 customers_total=3 avg_page_ms=200 max_page_ms=280$/m);
  for (const secret of [
    'cust-secret-1', 'cust-secret-2', 'cust-secret-3',
    'Alice', 'Secret', 'alice@secret.example', '4255550199',
    'Bob', 'Private', 'bob@secret.example', '2065550188',
    'Carol', 'Hidden', 'carol@secret.example', '2065550177'
  ]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
});

