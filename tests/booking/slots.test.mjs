import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlotsService } from '../../worker/src/slots.js';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { createMockSetmoreFetch } from '../../worker/src/setmore/mock.js';
import { MOCK_ACCOUNT_ID, MOCK_PROVIDER_ID } from '../../worker/src/setmore/fixtures.js';
import { BookingError } from '../../worker/src/errors.js';
import { createClock, createMemoryCache } from './helpers/fakes.mjs';

const API = 'https://developer.setmore.com/api/v2';
const CONFIG = {
  setmoreAccountId: MOCK_ACCOUNT_ID, setmoreProviderId: MOCK_PROVIDER_ID, studioTimezone: 'America/Los_Angeles',
  bookingHorizonDays: 56, minLeadMinutes: 120, slotStepMinutes: 15, slotsTtlSeconds: 30
};
const SERVICES = { svc_lash_lift: { service_id: 'svc_lash_lift', duration_minutes: 60 } };

const catalog = { async getService(id) { return SERVICES[id] ?? null; } };

const slot = (date, hhmm, offset = '-08:00') => ({ start_at: `${date}T${hhmm}:00${offset}`, end_at: `${date}T${hhmm}:00${offset}` });

// A Setmore client stand-in whose slot days the test controls.
function stubClient(daysFor = () => ({})) {
  const calls = [];
  return {
    calls,
    async getSlots(query) {
      calls.push(query);
      return daysFor(query, calls.length);
    }
  };
}

function setup({ client = stubClient(), clock = createClock('2026-11-22T20:00:00Z'), cache = createMemoryCache(clock), config = CONFIG } = {}) {
  return { service: createSlotsService({ client, catalog, config, cache, now: clock.now }), client, clock, cache };
}

const mondayDays = {
  '2026-11-23': [slot('2026-11-23', '10:00'), slot('2026-11-23', '13:00')],
  '2026-11-24': [slot('2026-11-24', '11:30')]
};

test('returns seven days starting at week_start with labels in Pacific time', async () => {
  const { service, client } = setup({ client: stubClient(() => mondayDays) });
  const week = await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.equal(week.service_id, 'svc_lash_lift');
  assert.equal(week.timezone, 'America/Los_Angeles');
  assert.equal(week.week_start, '2026-11-23');
  assert.equal(week.week_end, '2026-11-29');
  assert.deepEqual(week.days.map((day) => day.date), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  assert.equal(week.days[0].weekday, 'Monday');
  assert.deepEqual(week.days[0].slots, [
    { start_at: '2026-11-23T10:00:00-08:00', label: '10:00 AM' },
    { start_at: '2026-11-23T13:00:00-08:00', label: '1:00 PM' }
  ]);
  assert.equal(week.may_have_more, false);
  assert.equal(week.prev_week_start, '2026-11-16');
  assert.equal(week.next_week_start, '2026-11-30');
  assert.deepEqual(client.calls[0], {
    accountId: MOCK_ACCOUNT_ID, providerId: MOCK_PROVIDER_ID, duration: 60,
    startAt: '2026-11-23T00:00:00-08:00', endAt: '2026-11-30T00:00:00-08:00', timezone: 'America/Los_Angeles', slotLimit: 100
  });
});

test('defaults week_start to the current studio date', async () => {
  const { service } = setup({ clock: createClock('2026-11-23T07:30:00Z') });
  const week = await service.getWeek({ serviceId: 'svc_lash_lift' });
  assert.equal(week.week_start, '2026-11-22');
  assert.equal(week.prev_week_start, null);
});

test('removes slots earlier than now + 120 minutes', async () => {
  const days = { '2026-11-23': [slot('2026-11-23', '11:45'), slot('2026-11-23', '12:00')] };
  const { service } = setup({ client: stubClient(() => days), clock: createClock('2026-11-23T18:00:00Z') });
  const week = await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.deepEqual(week.days[0].slots.map((item) => item.label), ['12:00 PM']);
});

test('rejects week_start beyond the 56-day horizon with OUT_OF_RANGE', async () => {
  const { service } = setup();
  await assert.doesNotReject(service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2027-01-17' }));
  await assert.rejects(service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2027-01-18' }),
    (err) => err instanceof BookingError && err.code === 'OUT_OF_RANGE');
});

test('drops slots after the horizon and stops next_week_start at it', async () => {
  const days = { '2027-01-17': [slot('2027-01-17', '10:00')], '2027-01-18': [slot('2027-01-18', '10:00')] };
  const { service } = setup({ client: stubClient(() => days) });
  const week = await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2027-01-12' });
  assert.equal(week.days.find((day) => day.date === '2027-01-17').slots.length, 1);
  assert.equal(week.days.find((day) => day.date === '2027-01-18').slots.length, 0);
  assert.equal(week.next_week_start, null);
});

test('rejects week_start before the current studio week with OUT_OF_RANGE', async () => {
  const { service } = setup();
  await assert.doesNotReject(service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-16' }));
  await assert.rejects(service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-15' }),
    (err) => err instanceof BookingError && err.code === 'OUT_OF_RANGE');
});

test('rejects a malformed week_start with VALIDATION_FAILED', async () => {
  const { service } = setup();
  await assert.rejects(service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-02-30' }),
    (err) => err instanceof BookingError && err.code === 'VALIDATION_FAILED');
});

test('keeps only starts on the 15-minute SLOT_STEP_MINUTES boundary', async () => {
  const days = { '2026-11-23': ['14:00', '14:05', '14:10', '14:15', '14:20', '14:25', '14:30', '14:35', '14:40', '14:45', '14:50', '14:55'].map((t) => slot('2026-11-23', t)) };
  const { service } = setup({ client: stubClient(() => days) });
  const week = await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.deepEqual(week.days[0].slots.map((item) => item.label), ['2:00 PM', '2:15 PM', '2:30 PM', '2:45 PM']);
});

test('drops the extra end_at date key', async () => {
  const days = { ...mondayDays, '2026-11-30': [slot('2026-11-30', '10:00')] };
  const { service } = setup({ client: stubClient(() => days) });
  const week = await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.equal(week.days.length, 7);
  assert.ok(!week.days.some((day) => day.date === '2026-11-30'));
});

test('serves cached week within 30 s and refetches after', async () => {
  const { service, client, clock } = setup({ client: stubClient(() => mondayDays) });
  await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  clock.advance(29 * 1000);
  await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.equal(client.calls.length, 1);
  clock.advance(2 * 1000);
  await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.equal(client.calls.length, 2);
});

test('purgeWeek drops the cached week', async () => {
  const { service, client } = setup({ client: stubClient(() => mondayDays) });
  await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  await service.purgeWeek('svc_lash_lift', '2026-11-23');
  await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.equal(client.calls.length, 2);
});

test('isSlotAvailable bypasses the cache', async () => {
  const client = stubClient((query, call) => (call === 1 ? mondayDays : { '2026-11-23': [slot('2026-11-23', '10:00')] }));
  const { service } = setup({ client });
  const cached = await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-11-23' });
  assert.ok(cached.days[0].slots.some((item) => item.label === '1:00 PM'));
  const result = await service.isSlotAvailable({ serviceId: 'svc_lash_lift', startAt: '2026-11-23T13:00:00-08:00' });
  assert.equal(result.available, false);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(result.refreshedWeek.days[0].slots.map((item) => item.label), ['10:00 AM']);
});

test('isSlotAvailable matches 2026-11-27T21:00:00Z to the 1:00 PM PST slot', async () => {
  const days = { '2026-11-27': [slot('2026-11-27', '13:00')] };
  const { service, client } = setup({ client: stubClient(() => days) });
  const result = await service.isSlotAvailable({ serviceId: 'svc_lash_lift', startAt: '2026-11-27T21:00:00Z' });
  assert.equal(result.available, true);
  assert.equal(client.calls[0].startAt, '2026-11-27T00:00:00-08:00');
  assert.equal(result.refreshedWeek.week_start, '2026-11-27');
});

test('isSlotAvailable refuses a slot inside the lead time or off the step grid', async () => {
  const days = { '2026-11-22': [slot('2026-11-22', '13:00')], '2026-11-23': [slot('2026-11-23', '13:05')] };
  const { service } = setup({ client: stubClient(() => days) });
  assert.equal((await service.isSlotAvailable({ serviceId: 'svc_lash_lift', startAt: '2026-11-22T13:00:00-08:00' })).available, false);
  assert.equal((await service.isSlotAvailable({ serviceId: 'svc_lash_lift', startAt: '2026-11-23T13:05:00-08:00' })).available, false);
});

test('isSlotAvailable rejects a malformed start_at with VALIDATION_FAILED', async () => {
  const { service } = setup();
  await assert.rejects(service.isSlotAvailable({ serviceId: 'svc_lash_lift', startAt: 'tomorrow 1pm' }),
    (err) => err instanceof BookingError && err.code === 'VALIDATION_FAILED');
});

test('unknown or non-whitelisted service_id → NOT_FOUND', async () => {
  const { service, client } = setup();
  await assert.rejects(service.getWeek({ serviceId: 'svc_mega_volume_wispy', weekStart: '2026-11-23' }),
    (err) => err instanceof BookingError && err.code === 'NOT_FOUND');
  await assert.rejects(service.isSlotAvailable({ serviceId: 'svc_nope', startAt: '2026-11-23T13:00:00-08:00' }),
    (err) => err instanceof BookingError && err.code === 'NOT_FOUND');
  assert.equal(client.calls.length, 0);
});

test('window across 2026-11-01 sends start_at with -07:00 and end_at with -08:00', async () => {
  const clock = createClock('2026-10-27T20:00:00Z');
  const mock = createMockSetmoreFetch({ now: clock.now });
  const urls = [];
  const fetch = (input, init) => { urls.push(String(input)); return mock(input, init); };
  const tokenManager = createTokenManager({ refreshToken: 'mock', apiBase: API, fetch, now: clock.now });
  const client = createSetmoreClient({ apiBase: API, tokenManager, fetch, now: clock.now });
  const { service } = setup({ client, clock });
  const week = await service.getWeek({ serviceId: 'svc_lash_lift', weekStart: '2026-10-26' });
  const slotsUrl = urls.find((url) => url.includes('/slots?'));
  assert.ok(slotsUrl.includes('start_at=2026-10-26T00%3A00%3A00-07%3A00'), slotsUrl);
  assert.ok(slotsUrl.includes('end_at=2026-11-02T00%3A00%3A00-08%3A00'), slotsUrl);
  const monday = week.days.find((day) => day.date === '2026-11-02');
  assert.equal(monday, undefined, 'the end date is not part of the week');
  assert.deepEqual(week.days[0].slots, [], 'Monday 10/26 is in the past');
  assert.equal(week.days[1].slots[0].start_at, '2026-10-27T15:00:00-07:00', 'Tuesday starts at now + 2 h');
});
