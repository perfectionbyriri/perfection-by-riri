import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_SYNC_KEY,
  createCustomerResolver,
  hmacKey,
  indexContact,
  normalizeEmail,
  normalizePhoneUS,
  syncCustomerIndex
} from '../../worker/src/customers.js';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { createMockSetmoreFetch, createMockState } from '../../worker/src/setmore/mock.js';
import { SetmoreBusy, SetmoreUnavailable } from '../../worker/src/errors.js';
import { createClock, createMemoryKV } from './helpers/fakes.mjs';

const API = 'https://developer.setmore.com/api/v2';
const SECRET = 'test-customer-hash-secret';
const ANNA = { firstName: 'Anna', lastName: 'Smith', email: 'anna@example.com', phone: '(425) 845-0045' };

// Real client over MockSetmore; `intercept(call)` may return a Response to replace the mock's answer.
function setup({ intercept = () => null, maxPages = 20, kv = createMemoryKV(), state = createMockState() } = {}) {
  const clock = createClock();
  const mock = createMockSetmoreFetch({ now: clock.now, state });
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const call = { method: (init.method ?? 'GET').toUpperCase(), path: url.pathname.replace('/api/v2', ''), url };
    calls.push(call);
    return (await intercept(call)) ?? mock(input, init);
  };
  const tokenManager = createTokenManager({ refreshToken: 'mock', apiBase: API, fetch, now: clock.now });
  const client = createSetmoreClient({ apiBase: API, tokenManager, fetch, now: clock.now, sleep: async () => {}, random: () => 0.5 });
  const events = [];
  const resolver = createCustomerResolver({ client, kv, secret: SECRET, maxPages, log: (event, fields) => events.push({ event, ...fields }) });
  const count = (method, path) => calls.filter((call) => call.method === method && call.path === path).length;
  return { resolver, client, kv, state, events, calls, count };
}

async function seed(client, n, make = (i) => ({ first_name: `C${i}`, last_name: 'X', email_addresses: [{ value: `c${i}@example.com`, primary: true }], phone_numbers: [{ value: `+1206555${String(1000 + i)}`, primary: true }] })) {
  const ids = [];
  for (let i = 0; i < n; i += 1) ids.push((await client.createCustomer(make(i))).id);
  return ids;
}

test('normalizeEmail trims and lower-cases', () => {
  assert.equal(normalizeEmail(' Anna@Example.COM '), 'anna@example.com');
});

test('normalizePhoneUS accepts formatted, dotted and 11-digit forms', () => {
  for (const input of ['+1 (425) 845-0045', '425.845.0045', '14258450045', '4258450045']) {
    assert.equal(normalizePhoneUS(input), '+14258450045', input);
  }
  assert.equal(normalizePhoneUS('12345'), null);
  assert.equal(normalizePhoneUS('24258450045'), null, '11 digits must start with 1');
  assert.equal(normalizePhoneUS(''), null);
  assert.equal(normalizePhoneUS(undefined), null);
});

test('hmacKey returns cust:<kind>:<hex HMAC-SHA-256>', async () => {
  // Expected value computed independently: printf 'anna@example.com' | openssl dgst -sha256 -hmac 'test-customer-hash-secret'
  assert.equal(await hmacKey(SECRET, 'e', 'anna@example.com'), 'cust:e:c74dd95643285fcd258d4c3d777b5222bb0722831d6b576a2283fdafd6bff68b');
});

test('same customer for differently cased and padded email', async () => {
  const { resolver } = setup();
  const first = await resolver.resolve(ANNA);
  const second = await resolver.resolve({ ...ANNA, email: ' Anna@Example.COM ', phone: '' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.customerId, first.customerId);
});

test('same key for every phone format', async () => {
  const keys = await Promise.all(['+1 (425) 845-0045', '425.845.0045', '14258450045'].map((p) => hmacKey(SECRET, 'p', normalizePhoneUS(p))));
  assert.equal(new Set(keys).size, 1);
  const { resolver } = setup();
  const first = await resolver.resolve({ ...ANNA, phone: '+1 (425) 845-0045' });
  const second = await resolver.resolve({ ...ANNA, email: 'other@example.com', phone: '425.845.0045' });
  assert.equal(second.customerId, first.customerId);
});

test('KV stores only hashes: no raw email or phone in any key or value', async () => {
  const { resolver, client, kv } = setup();
  await seed(client, 3);
  await resolver.resolve(ANNA);
  const dump = JSON.stringify(kv.entries());
  for (const raw of ['anna@example.com', '4258450045', 'c0@example.com', '2065551000']) assert.ok(!dump.includes(raw), raw);
  assert.ok(kv.entries().every((entry) => /^cust:[ep]:[0-9a-f]{64}$/.test(entry.key)));
  assert.ok(kv.entries().every((entry) => entry.options.expirationTtl === undefined), 'no TTL');
});

test('finds an indexed customer without scanning', async () => {
  const { resolver, client, kv, count } = setup();
  const [id] = await seed(client, 1);
  await kv.put(await hmacKey(SECRET, 'e', 'anna@example.com'), id);
  const result = await resolver.resolve(ANNA);
  assert.deepEqual(result, { customerId: id, created: false });
  assert.equal(count('GET', '/customers'), 0);
  assert.equal(count('POST', '/customers'), 1, 'only the seed');
});

test('stale index entry (404) is deleted and resolution continues', async () => {
  const { resolver, kv } = setup();
  const key = await hmacKey(SECRET, 'e', 'anna@example.com');
  await kv.put(key, 'cus_deleted');
  const result = await resolver.resolve(ANNA);
  assert.equal(result.created, true);
  assert.equal(await kv.get(key), result.customerId);
});

test('scan finds an existing Setmore customer and warms the index for scanned contacts', async () => {
  const { resolver, client, kv, count } = setup();
  const ids = await seed(client, 150, (i) => (i === 120
    ? { first_name: 'Anna', last_name: 'Smith', email_addresses: [{ value: 'ANNA@example.com', primary: true }], phone_numbers: [] }
    : { first_name: `C${i}`, last_name: 'X', email_addresses: [{ value: `c${i}@example.com`, primary: true }], phone_numbers: [{ value: `(206) 555-${1000 + i}`, primary: true }] }));
  const result = await resolver.resolve(ANNA);
  assert.deepEqual(result, { customerId: ids[120], created: false });
  assert.equal(count('GET', '/customers'), 2);
  assert.equal(count('POST', '/customers'), 150, 'only the seeds');
  assert.equal(await kv.get(await hmacKey(SECRET, 'e', 'c5@example.com')), ids[5]);
  assert.equal(await kv.get(await hmacKey(SECRET, 'p', '+12065551005')), ids[5]);
  assert.equal(await kv.get(await hmacKey(SECRET, 'p', '+14258450045')), ids[120], 'the matched customer gains the phone key');
});

test('scan stops at maxPages and creates the customer', async () => {
  const { resolver, client, count } = setup({ maxPages: 2 });
  await seed(client, 250);
  const result = await resolver.resolve(ANNA);
  assert.equal(result.created, true);
  assert.equal(count('GET', '/customers'), 2);
  const created = await client.getCustomer(result.customerId);
  assert.deepEqual(created.email_addresses.map((item) => [item.value, item.primary]), [['anna@example.com', true]]);
  assert.deepEqual(created.phone_numbers.map((item) => [item.value, item.primary]), [['+14258450045', true]]);
  assert.equal(created.first_name, 'Anna');
  assert.equal(created.last_name, 'Smith');
});

test('429 during scan creates the customer and logs customer_scan_aborted', async () => {
  const { resolver, client, events, count } = setup({
    intercept: (call) => (call.method === 'GET' && call.path === '/customers' ? new Response('{}', { status: 429 }) : null)
  });
  await seed(client, 1, () => ({ first_name: 'Anna', email_addresses: [{ value: 'anna@example.com' }] }));
  const result = await resolver.resolve(ANNA);
  assert.equal(result.created, true);
  assert.equal(count('POST', '/customers'), 2, 'seed + create');
  assert.deepEqual(events, [{ event: 'customer_scan_aborted' }]);
});

test('other scan failures propagate', async () => {
  const { resolver } = setup({
    intercept: (call) => (call.method === 'GET' && call.path === '/customers' ? new Response('{}', { status: 503 }) : null)
  });
  await assert.rejects(resolver.resolve(ANNA), SetmoreUnavailable);
});

test('email match wins over phone match and logs customer_identity_conflict', async () => {
  const { resolver, client, events } = setup();
  const [byPhone, byEmail] = await seed(client, 2, (i) => (i === 0
    ? { first_name: 'P', phone_numbers: [{ value: '425-845-0045', primary: true }] }
    : { first_name: 'E', email_addresses: [{ value: 'anna@example.com', primary: true }] }));
  const result = await resolver.resolve(ANNA);
  assert.deepEqual(result, { customerId: byEmail, created: false });
  assert.notEqual(byPhone, byEmail);
  assert.deepEqual(events, [{ event: 'customer_identity_conflict' }]);
  assert.ok(!JSON.stringify(events).includes('anna'));
});

test('indexed email and phone pointing at different customers: email wins, conflict logged', async () => {
  const { resolver, client, kv, events } = setup();
  const [x, y] = await seed(client, 2);
  await kv.put(await hmacKey(SECRET, 'e', 'anna@example.com'), x);
  await kv.put(await hmacKey(SECRET, 'p', '+14258450045'), y);
  assert.deepEqual(await resolver.resolve(ANNA), { customerId: x, created: false });
  assert.deepEqual(events, [{ event: 'customer_identity_conflict' }]);
  assert.equal(await kv.get(await hmacKey(SECRET, 'p', '+14258450045')), y, 'the phone key is not overwritten');
});

test('different secret produces different keys', async () => {
  assert.notEqual(await hmacKey(SECRET, 'e', 'anna@example.com'), await hmacKey('another-secret', 'e', 'anna@example.com'));
  assert.notEqual(await hmacKey(SECRET, 'e', 'anna@example.com'), await hmacKey(SECRET, 'p', 'anna@example.com'));
});

test('indexContact hashes email and phone and writes keys only when changed', async () => {
  const kv = createMemoryKV();
  const contact = {
    id: 'cus_1',
    email_addresses: [{ value: 'Anna@Example.com' }],
    phone_numbers: [{ value: '(425) 845-0045' }]
  };
  const keys = await indexContact(kv, SECRET, contact);
  assert.equal(keys.email.length, 1);
  assert.equal(keys.phone.length, 1);
  assert.equal(await kv.get(keys.email[0]), 'cus_1');
  assert.equal(await kv.get(keys.phone[0]), 'cus_1');
});

test('syncCustomerIndex stops after pagesPerRun, writes keys for every contact, and resumes from the stored cursor', async () => {
  const kv = createMemoryKV();
  const clock = createClock('2026-11-23T01:00:00Z');
  const pages = {
    start: {
      items: [{ id: 'c1', email_addresses: [{ value: 'one@example.com' }], phone_numbers: [{ value: '4255550101' }] }],
      cursor: 'cur-2'
    },
    'cur-2': {
      items: [{ id: 'c2', email_addresses: [{ value: 'two@example.com' }], phone_numbers: [{ value: '4255550102' }] }],
      cursor: 'cur-3'
    },
    'cur-3': {
      items: [{ id: 'c3', email_addresses: [{ value: 'three@example.com' }], phone_numbers: [] }],
      cursor: null
    }
  };
  const seenCalls = [];
  const client = {
    async listCustomersPage(cursor, limit, options) {
      seenCalls.push({ cursor: cursor ?? null, limit, options });
      return pages[cursor ?? 'start'];
    }
  };
  const events = [];
  const log = (event, fields) => events.push({ event, ...fields });

  const run1 = await syncCustomerIndex({ client, kv, secret: SECRET, pagesPerRun: 2, now: clock.now, log });
  assert.deepEqual(run1, { pages: 2, contacts: 2, complete: false });
  assert.equal(seenCalls.length, 2);
  assert.deepEqual(seenCalls[0], { cursor: null, limit: 100, options: { cooldown: false } });
  assert.deepEqual(seenCalls[1], { cursor: 'cur-2', limit: 100, options: { cooldown: false } });
  assert.deepEqual(await kv.get(CUSTOMER_SYNC_KEY, 'json'), {
    cursor: 'cur-3',
    pass_started_at: '2026-11-23T01:00:00.000Z',
    complete_at: null,
    pages_this_pass: 2
  });
  assert.equal(await kv.get(await hmacKey(SECRET, 'e', 'one@example.com')), 'c1');
  assert.equal(await kv.get(await hmacKey(SECRET, 'p', '+14255550102')), 'c2');
  assert.equal(await kv.get(await hmacKey(SECRET, 'e', 'three@example.com')), null);

  clock.advance(15 * 60 * 1000);
  const run2 = await syncCustomerIndex({ client, kv, secret: SECRET, pagesPerRun: 2, now: clock.now, log });
  assert.deepEqual(run2, { pages: 1, contacts: 1, complete: true });
  assert.equal(seenCalls.length, 3);
  assert.equal(seenCalls[2].cursor, 'cur-3');
  assert.deepEqual(await kv.get(CUSTOMER_SYNC_KEY, 'json'), {
    cursor: null,
    pass_started_at: '2026-11-23T01:00:00.000Z',
    complete_at: '2026-11-23T01:15:00.000Z',
    pages_this_pass: 3
  });
  assert.equal(await kv.get(await hmacKey(SECRET, 'e', 'three@example.com')), 'c3');

  // Next run restarts a new pass from cursor null while preserving complete_at until the new pass completes.
  clock.advance(15 * 60 * 1000);
  const run3 = await syncCustomerIndex({ client, kv, secret: SECRET, pagesPerRun: 1, now: clock.now, log });
  assert.deepEqual(run3, { pages: 1, contacts: 1, complete: false });
  assert.equal(seenCalls[3].cursor, null);
  assert.deepEqual(await kv.get(CUSTOMER_SYNC_KEY, 'json'), {
    cursor: 'cur-2',
    pass_started_at: '2026-11-23T01:30:00.000Z',
    complete_at: '2026-11-23T01:15:00.000Z',
    pages_this_pass: 1
  });
});

test('syncCustomerIndex on 429 (SetmoreBusy) stops, keeps the cursor, and logs customer_sync_paused with no PII', async () => {
  const kv = createMemoryKV();
  const clock = createClock('2026-11-23T02:00:00Z');
  let callCount = 0;
  const client = {
    async listCustomersPage(cursor) {
      callCount += 1;
      if (callCount === 1) {
        assert.equal(cursor, undefined);
        return {
          items: [{ id: 'c-secret-id', first_name: 'Anna', email_addresses: [{ value: 'anna@example.com' }] }],
          cursor: 'cur-keep'
        };
      }
      throw new SetmoreBusy(10);
    }
  };
  const events = [];
  const result = await syncCustomerIndex({
    client,
    kv,
    secret: SECRET,
    pagesPerRun: 5,
    now: clock.now,
    log: (event, fields) => events.push({ event, ...fields })
  });
  assert.deepEqual(result, { pages: 1, contacts: 1, complete: false });
  assert.deepEqual(await kv.get(CUSTOMER_SYNC_KEY, 'json'), {
    cursor: 'cur-keep',
    pass_started_at: '2026-11-23T02:00:00.000Z',
    complete_at: null,
    pages_this_pass: 1
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'customer_sync_paused');
  assert.equal(events[0].pages, 1);
  assert.equal(events[0].contacts, 1);
  const serialized = JSON.stringify(events);
  for (const secret of ['anna@example.com', 'Anna', 'c-secret-id', 'cur-keep']) {
    assert.ok(!serialized.includes(secret), `leaked ${secret}`);
  }
});

test('resolve() after a completed sync pass creates on a KV miss without calling listCustomersPage', async () => {
  const kv = createMemoryKV();
  await kv.put(CUSTOMER_SYNC_KEY, JSON.stringify({
    cursor: null,
    pass_started_at: '2026-11-23T01:00:00.000Z',
    complete_at: '2026-11-23T01:00:05.000Z',
    pages_this_pass: 2
  }));
  let listCalls = 0;
  let createdPayload = null;
  const client = {
    async getCustomer() { throw new Error('should not call getCustomer on miss'); },
    async listCustomersPage() { listCalls += 1; return { items: [], cursor: null }; },
    async createCustomer(payload) { createdPayload = payload; return { id: 'cus_new' }; }
  };
  const resolver = createCustomerResolver({ client, kv, secret: SECRET });
  const result = await resolver.resolve(ANNA);
  assert.deepEqual(result, { customerId: 'cus_new', created: true });
  assert.equal(listCalls, 0);
  assert.equal(createdPayload.first_name, 'Anna');
  assert.equal(await kv.get(await hmacKey(SECRET, 'e', 'anna@example.com')), 'cus_new');
  assert.equal(await kv.get(await hmacKey(SECRET, 'p', '+14258450045')), 'cus_new');
});

test('resolve() before any completed pass caps the fallback scan at default maxPages (3)', async () => {
  const kv = createMemoryKV();
  await kv.put(CUSTOMER_SYNC_KEY, JSON.stringify({
    cursor: 'cur-2',
    pass_started_at: '2026-11-23T01:00:00.000Z',
    complete_at: null,
    pages_this_pass: 1
  }));
  let listCalls = 0;
  const client = {
    async getCustomer() { throw new Error('unexpected'); },
    async listCustomersPage() {
      listCalls += 1;
      return { items: [], cursor: `cur-${listCalls + 1}` };
    },
    async createCustomer() { return { id: 'cus_after_fallback' }; }
  };
  const resolver = createCustomerResolver({ client, kv, secret: SECRET });
  const result = await resolver.resolve(ANNA);
  assert.deepEqual(result, { customerId: 'cus_after_fallback', created: true });
  assert.equal(listCalls, 3);
});

test('resolve() after a completed pass still verifies a hit with GET /customers/{id} and drops stale keys on 404', async () => {
  const { resolver, client, kv, count } = setup();
  const [liveId] = await seed(client, 1);
  await kv.put(CUSTOMER_SYNC_KEY, JSON.stringify({
    cursor: null,
    pass_started_at: '2026-11-23T01:00:00.000Z',
    complete_at: '2026-11-23T01:00:05.000Z',
    pages_this_pass: 2
  }));
  const emailKey = await hmacKey(SECRET, 'e', 'anna@example.com');
  await kv.put(emailKey, liveId);
  const hit = await resolver.resolve(ANNA);
  assert.deepEqual(hit, { customerId: liveId, created: false });
  assert.equal(count('GET', '/customers'), 0);

  // Now point the key to a deleted customer id: 404 drops the stale key and creates without scanning.
  await kv.put(emailKey, 'cus_deleted');
  await kv.delete(await hmacKey(SECRET, 'p', '+14258450045'));
  const missAfter404 = await resolver.resolve(ANNA);
  assert.equal(missAfter404.created, true);
  assert.equal(count('GET', '/customers'), 0);
  assert.equal(await kv.get(emailKey), missAfter404.customerId);
});

