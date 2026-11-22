import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockSetmoreFetch, createMockState } from '../../worker/src/setmore/mock.js';
import { MOCK_ACCOUNT_ID, MOCK_PROVIDER_ID, MOCK_NON_PROVIDER_ID, MOCK_SERVICES } from '../../worker/src/setmore/fixtures.js';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import {
  SetmoreBusy, SetmoreConflict, SetmoreRejected, SetmoreUnavailable, SetmoreNotFound
} from '../../worker/src/errors.js';
import { createClock, createMemoryCache } from './helpers/fakes.mjs';

const API = 'https://developer.setmore.com/api/v2';
const TZ = 'America/Los_Angeles';
const WEEK = { startAt: '2026-11-23T00:00:00-08:00', endAt: '2026-11-30T00:00:00-08:00' };

function setup({ scenario = 'normal', clock = createClock('2026-11-22T20:00:00Z'), state = createMockState(), rateLimitCount = 3 } = {}) {
  const fetch = createMockSetmoreFetch({ scenario, now: clock.now, state, rateLimitCount });
  const tokenManager = createTokenManager({ refreshToken: 'mock', apiBase: API, fetch, now: clock.now, cache: createMemoryCache(clock) });
  const client = createSetmoreClient({ apiBase: API, tokenManager, fetch, now: clock.now, sleep: async () => {}, random: () => 0.5 });
  return { client, state, clock };
}

function slotsQuery(overrides = {}) {
  return { accountId: MOCK_ACCOUNT_ID, providerId: MOCK_PROVIDER_ID, duration: 60, timezone: TZ, ...WEEK, ...overrides };
}

const service = (title) => MOCK_SERVICES.find((item) => item.title === title);

test('lists 44 services offered by one provider, plus two staff records', async () => {
  const { client } = setup();
  const services = await client.listServices();
  assert.equal(services.length, 44);
  assert.ok(services.every((item) => item.provider_ids.length === 1 && item.provider_ids[0] === MOCK_PROVIDER_ID));
  assert.ok(services.every((item) => item.visibility === 'PUBLIC' && item.currency === 'USD' && item.type === 'SERVICE'));
  assert.equal(service('Classic Full Extension').cost, 165);
  assert.equal(service('Classic Full Extension').duration, 120);
  assert.equal((await client.listStaff()).length, 2);
  const categories = await client.listCategories();
  assert.equal(categories.length, 7);
  assert.equal(categories.reduce((total, item) => total + item.service_ids.length, 0), 44);
});

test('generates no slots on Sunday and none ending after 17:00', async () => {
  const { client } = setup();
  const days = await client.getSlots(slotsQuery({ duration: 120 }));
  assert.deepEqual(Object.keys(days).sort(), [
    '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'
  ]);
  assert.deepEqual(days['2026-11-29'], []);
  assert.deepEqual(days['2026-11-30'], [], 'the end_at date is returned as an empty key');
  const monday = days['2026-11-23'];
  assert.deepEqual(monday[0], { start_at: '2026-11-23T10:00:00-08:00', end_at: '2026-11-23T12:00:00-08:00' });
  assert.deepEqual(monday[1].start_at, '2026-11-23T10:05:00-08:00');
  assert.deepEqual(monday.at(-1), { start_at: '2026-11-23T15:00:00-08:00', end_at: '2026-11-23T17:00:00-08:00' });
});

test('omits slots that start before now', async () => {
  const { client } = setup({ clock: createClock('2026-11-23T20:00:00Z') });
  const days = await client.getSlots(slotsQuery());
  assert.equal(days['2026-11-23'][0].start_at, '2026-11-23T12:00:00-08:00');
});

test('the non-provider staff record gets 400 on slots', async () => {
  const { client } = setup();
  await assert.rejects(client.getSlots(slotsQuery({ providerId: MOCK_NON_PROVIDER_ID })), SetmoreRejected);
});

test('a booked slot disappears from later slot queries', async () => {
  const { client } = setup();
  const customer = await client.createCustomer({ first_name: 'Test', last_name: 'Client' });
  const booking = await client.createBooking({
    type: 'APPOINTMENT', account_id: MOCK_ACCOUNT_ID, provider_id: MOCK_PROVIDER_ID, consumer_ids: [customer.id],
    service_id: service('Lash Lift').id, start_at: '2026-11-23T10:00:00-08:00', end_at: '2026-11-23T11:00:00-08:00'
  });
  assert.equal(booking.status, 'CONFIRMED');
  const days = await client.getSlots(slotsQuery());
  assert.equal(days['2026-11-23'][0].start_at, '2026-11-23T11:00:00-08:00');
});

test('creating an overlapping booking is a resource_conflict', async () => {
  const { client } = setup();
  const body = {
    type: 'APPOINTMENT', account_id: MOCK_ACCOUNT_ID, provider_id: MOCK_PROVIDER_ID, consumer_ids: ['cus_x'],
    service_id: service('Lash Lift').id, start_at: '2026-11-23T10:00:00-08:00', end_at: '2026-11-23T11:00:00-08:00'
  };
  await client.createBooking(body);
  await assert.rejects(client.createBooking({ ...body, start_at: '2026-11-23T10:30:00-08:00', end_at: '2026-11-23T11:30:00-08:00' }), SetmoreConflict);
});

test('a booking without exactly one consumer is rejected', async () => {
  const { client } = setup();
  await assert.rejects(client.createBooking({
    type: 'APPOINTMENT', account_id: MOCK_ACCOUNT_ID, provider_id: MOCK_PROVIDER_ID, consumer_ids: [],
    service_id: service('Lash Lift').id, start_at: '2026-11-23T10:00:00-08:00', end_at: '2026-11-23T11:00:00-08:00'
  }), (err) => err instanceof SetmoreRejected && err.upstreamCode === 'out_of_range');
});

test('slot_taken: the first check passes, the second shows the slot taken', async () => {
  const { client } = setup({ scenario: 'slot_taken' });
  const first = await client.getSlots(slotsQuery());
  const taken = first['2026-11-23'][0].start_at;
  const second = await client.getSlots(slotsQuery());
  assert.ok(!second['2026-11-23'].some((slot) => slot.start_at === taken));
});

test('slot_taken_on_create: createBooking throws SetmoreConflict', async () => {
  const { client } = setup({ scenario: 'slot_taken_on_create' });
  await assert.rejects(client.createBooking({
    type: 'APPOINTMENT', account_id: MOCK_ACCOUNT_ID, provider_id: MOCK_PROVIDER_ID, consumer_ids: ['cus_x'],
    service_id: service('Lash Lift').id, start_at: '2026-11-23T10:00:00-08:00', end_at: '2026-11-23T11:00:00-08:00'
  }), SetmoreConflict);
});

test('rate_limited: the client throws SetmoreBusy after 3 × 429', async () => {
  const { client } = setup({ scenario: 'rate_limited' });
  await assert.rejects(client.listServices(), SetmoreBusy);
});

test('rate_limited_once: the client succeeds after one retry', async () => {
  const { client } = setup({ scenario: 'rate_limited_once' });
  assert.equal((await client.listServices()).length, 44);
});

test('token_expired: the first call gets 401, then succeeds', async () => {
  const { client } = setup({ scenario: 'token_expired' });
  assert.equal((await client.listServices()).length, 44);
});

test('unavailable: every call fails with SetmoreUnavailable', async () => {
  const { client } = setup({ scenario: 'unavailable' });
  await assert.rejects(client.listServices(), SetmoreUnavailable);
});

test('double_booked_after_create: the staff booking list shows an overlap', async () => {
  const { client } = setup({ scenario: 'double_booked_after_create' });
  const created = await client.createBooking({
    type: 'APPOINTMENT', account_id: MOCK_ACCOUNT_ID, provider_id: MOCK_PROVIDER_ID, consumer_ids: ['cus_x'],
    service_id: service('Lash Lift').id, start_at: '2026-11-23T10:00:00-08:00', end_at: '2026-11-23T11:00:00-08:00'
  });
  const bookings = await client.listBookingsByStaff({ staffId: MOCK_PROVIDER_ID, startAt: WEEK.startAt, endAt: WEEK.endAt });
  assert.equal(bookings.length, 2);
  assert.ok(bookings.some((item) => item.id === created.id));
  assert.ok(bookings.every((item) => item.start_at === '2026-11-23T10:00:00-08:00'));
});

test('bookings by staff are filtered by the date window', async () => {
  const { client } = setup();
  const base = {
    type: 'APPOINTMENT', account_id: MOCK_ACCOUNT_ID, provider_id: MOCK_PROVIDER_ID, consumer_ids: ['cus_x'],
    service_id: service('Lash Lift').id
  };
  await client.createBooking({ ...base, start_at: '2026-11-23T10:00:00-08:00', end_at: '2026-11-23T11:00:00-08:00' });
  await client.createBooking({ ...base, start_at: '2026-11-24T10:00:00-08:00', end_at: '2026-11-24T11:00:00-08:00' });
  const monday = await client.listBookingsByStaff({ staffId: MOCK_PROVIDER_ID, startAt: '2026-11-23T00:00:00-08:00', endAt: '2026-11-24T00:00:00-08:00' });
  assert.deepEqual(monday.map((item) => item.start_at), ['2026-11-23T10:00:00-08:00']);
});

test('customers can be created, fetched and listed with a cursor', async () => {
  const { client, state } = setup();
  for (let i = 0; i < 3; i += 1) await client.createCustomer({ first_name: `C${i}`, email_addresses: [{ value: `c${i}@example.com`, primary: true }] });
  const page1 = await client.listCustomersPage(undefined, 2);
  assert.equal(page1.items.length, 2);
  const page2 = await client.listCustomersPage(page1.cursor, 2);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.cursor, null);
  assert.equal((await client.getCustomer(page1.items[0].id)).first_name, 'C0');
  await assert.rejects(client.getCustomer('cus_missing'), SetmoreNotFound);
  assert.equal(state.customers.size, 3);
});

test('state is shared between mock fetch instances', async () => {
  const state = createMockState();
  const a = setup({ state });
  await a.client.createCustomer({ first_name: 'Shared' });
  const b = setup({ state });
  assert.equal((await b.client.listCustomersPage()).items.length, 1);
});

test('rate_limited: each route has its own 429 budget, so concurrent calls all fail', async () => {
  const { client } = setup({ scenario: 'rate_limited' });
  const results = await Promise.allSettled([client.listServices(), client.listCategories(), client.listStaff()]);
  assert.ok(results.every((result) => result.status === 'rejected' && result.reason instanceof SetmoreBusy));
});
