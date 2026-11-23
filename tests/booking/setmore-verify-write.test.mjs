import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlotsService } from '../../worker/src/slots.js';
import { runWrite, safeUpstreamCode } from '../../worker/tools/setmore-verify.js';
import { createClock } from './helpers/fakes.mjs';

const CONFIG = {
  studioTimezone: 'America/Los_Angeles', setmoreAccountId: 'acct-1', setmoreProviderId: 'prov-1',
  bookingHorizonDays: 56, minLeadMinutes: 120, slotsTtlSeconds: 30
};
const CONTACT = { email: 'owner-test@example.com', phone: '+14255550123' };
const SERVICES = [
  { service_id: 'real-long', name: 'Long', duration_minutes: 60, price_cents: 16500 },
  { service_id: 'real-short', name: 'Short', duration_minutes: 30, price_cents: 3000 }
];

// Studio "today" is 2026-11-22; the first allowed week starts 2026-12-06 (closed Sunday).
function fakeClient({ rereadThrows = false, deleteFails = false, slotStaysAfterCreate = false, createOutcomeUnknown = false, lookupThrows = false } = {}) {
  const state = { booked: false, created: null, deleted: [], calls: [] };
  const free = (start, end) => ({ start_at: start, end_at: end });
  return {
    state,
    async getSlots({ duration }) {
      state.calls.push(['getSlots', duration]);
      if (state.created && rereadThrows) throw new Error('reread boom');
      const first = free('2026-12-07T10:00:00-08:00', '2026-12-07T10:30:00-08:00');
      const second = free('2026-12-07T10:20:00-08:00', '2026-12-07T10:50:00-08:00');
      const third = free('2026-12-07T10:45:00-08:00', '2026-12-07T11:15:00-08:00');
      const showFirst = !state.booked || slotStaysAfterCreate;
      return {
        '2026-12-05': [free('2026-12-05T10:00:00-08:00', '2026-12-05T10:30:00-08:00')],
        '2026-12-07': [...(showFirst ? [first] : []), second, third]
      };
    },
    async createBooking(body) {
      state.created = body;
      state.booked = true;
      // A timeout or 5xx: Setmore may have stored the booking although the call failed.
      if (createOutcomeUnknown) throw Object.assign(new Error('timeout'), { name: 'SetmoreUnavailable' });
      return { id: 'booking-secret-id', ...body };
    },
    async request(method, path) {
      state.calls.push([method, path]);
      if (method === 'DELETE') {
        if (deleteFails) throw new Error('delete boom');
        state.deleted.push(path);
        state.booked = false;
        return {};
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    async listBookingsByStaff() {
      if (lookupThrows) throw Object.assign(new Error('down'), { name: 'SetmoreUnavailable' });
      return state.created ? [{ id: 'booking-secret-id', ...state.created, label: 'pbr-verify', consumer_ids: ['cust-secret'] }] : [];
    },
    async getCustomer(id) {
      // Live Setmore answers 404 for anything but a real customer id (run 45118009577).
      if (id !== 'cust-secret') throw Object.assign(new Error('not found'), { name: 'SetmoreNotFound' });
      return { id: 'cust-secret', first_name: 'Riri', last_name: 'Verification', email_addresses: [], phone_numbers: [] };
    }
  };
}

function setup(options) {
  const clock = createClock('2026-11-22T20:00:00Z');
  const client = fakeClient(options);
  const catalogService = {
    async getCatalog() { return { groups: [{ key: 'g', services: SERVICES }], stale: false }; },
    async getService(id) { return SERVICES.find((s) => s.service_id === id) ?? null; }
  };
  const slots = createSlotsService({ client, catalog: catalogService, config: CONFIG, now: clock.now });
  // Same shape as createCustomerResolver().resolve in worker/src/customers.js.
  const resolver = { async resolve() { return { customerId: 'cust-secret', created: true }; } };
  const lines = [];
  return { clock, client, catalogService, slots, resolver, lines, log: (line) => lines.push(String(line)) };
}

async function run(options) {
  const s = setup(options);
  const result = await runWrite({
    client: s.client, catalogService: s.catalogService, slots: s.slots, resolver: s.resolver,
    config: CONFIG, contact: CONTACT, now: s.clock.now, log: s.log
  });
  return { ...s, result };
}

test('runWrite picks the first 15-minute start at least 14 days ahead for the shortest service', async () => {
  const { result, client } = await run();
  assert.deepEqual(result.slot, { date: '2026-12-07', start: '10:00' });
  assert.equal(client.state.created.service_id, 'real-short');
  assert.equal(client.state.created.start_at, '2026-12-07T10:00:00-08:00');
  assert.equal(client.state.created.end_at, '2026-12-07T10:30:00-08:00');
  assert.equal(client.state.created.label, 'pbr-verify');
  assert.match(client.state.created.notes, /Setmore API verification by perfectionbyriri\.com — safe to delete\./);
  assert.deepEqual(client.state.created.consumer_ids, ['cust-secret']);
});

test('runWrite reports slotGoneAfterCreate and freshCheckRefused from the re-read', async () => {
  const { result, client } = await run();
  assert.equal(result.slotGoneAfterCreate, true);
  assert.equal(result.freshCheckRefused, true);
  assert.equal(result.slotFreeAfterDelete, true);
  assert.equal(result.markerReturned, true);
  assert.equal(result.deleted, true);
  assert.equal(result.ok, true);
  assert.deepEqual(client.state.deleted, ['/bookings/booking-secret-id']);
  assert.ok(result.customerFields.includes('email_addresses'));
});

test('runWrite fails when Setmore still offers the slot after the booking', async () => {
  const { result } = await run({ slotStaysAfterCreate: true });
  assert.equal(result.slotGoneAfterCreate, false);
  assert.equal(result.ok, false);
  assert.equal(result.deleted, true);
});

test('runWrite deletes the booking even when the re-read throws', async () => {
  const { result, client } = await run({ rereadThrows: true });
  assert.equal(result.ok, false);
  assert.deepEqual(client.state.deleted, ['/bookings/booking-secret-id']);
});

test('runWrite fails loudly with the slot time when DELETE fails', async () => {
  const { result, lines } = await run({ deleteFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, false);
  const text = lines.join('\n');
  assert.match(text, /2026-12-07/);
  assert.match(text, /10:00/);
  assert.ok(!text.includes('booking-secret-id'));
});

test('runWrite reads the customer by id and logs only whether it was created', async () => {
  const { result, client, lines } = await run();
  assert.deepEqual(client.state.created.consumer_ids, ['cust-secret']);
  assert.equal(result.customerCreated, true);
  assert.match(lines.join('\n'), /customer_created=true/);
});

test('runWrite never logs the contact or customer data', async () => {
  const { lines } = await run();
  const text = lines.join('\n');
  for (const secret of [CONTACT.email, CONTACT.phone, 'cust-secret', 'booking-secret-id']) assert.ok(!text.includes(secret), secret);
});

test('runWrite finds and deletes the booking when the create outcome is unknown', async () => {
  const { result, client } = await run({ createOutcomeUnknown: true });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, true);
  assert.deepEqual(client.state.deleted, ['/bookings/booking-secret-id']);
});

test('runWrite asks for manual cleanup when an unknown-outcome booking cannot be looked up', async () => {
  const { result, lines } = await run({ createOutcomeUnknown: true, lookupThrows: true });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, false);
  const text = lines.join('\n');
  assert.match(text, /CHECK SETMORE/);
  assert.match(text, /2026-12-07 10:00/);
});

test('safeUpstreamCode passes short Setmore codes and hides anything else', () => {
  assert.equal(safeUpstreamCode('resource_conflict'), 'resource_conflict');
  assert.equal(safeUpstreamCode('http_400'), 'http_400');
  assert.equal(safeUpstreamCode('Customer jane@example.com exists'), 'other');
  assert.equal(safeUpstreamCode(undefined), null);
});
