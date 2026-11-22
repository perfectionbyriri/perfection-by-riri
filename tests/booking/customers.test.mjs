import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerResolver, hmacKey, normalizeEmail, normalizePhoneUS } from '../../worker/src/customers.js';
import { createSetmoreClient } from '../../worker/src/setmore/client.js';
import { createTokenManager } from '../../worker/src/setmore/token-manager.js';
import { createMockSetmoreFetch, createMockState } from '../../worker/src/setmore/mock.js';
import { SetmoreUnavailable } from '../../worker/src/errors.js';
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
