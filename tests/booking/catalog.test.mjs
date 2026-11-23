import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalogService, depositQuote, mergeCatalog, metaForMock, validateMeta } from '../../worker/src/catalog.js';
import { MOCK_CATEGORIES, MOCK_PROVIDER_ID, MOCK_SERVICES, MOCK_STAFF } from '../../worker/src/setmore/fixtures.js';
import { SetmoreBusy } from '../../worker/src/errors.js';
import { createClock, createMemoryCache } from './helpers/fakes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'worker/config/services-meta.json'), 'utf8'));
// Fixtures carry the placeholder ids, so merges against them read the meta as mock mode does.
const MOCK_META = metaForMock(META);

const PHOTO = { src: '/images/Lash%20Lift/lash-lift.webp', width: 736, height: 736, alt: 'Lash lift result' };
const OVERRIDE_PHOTO = { src: '/images/PMU%20Services%20Content/lip-blush.webp', width: 735, height: 695, alt: 'Lip blush result' };

function smallMeta(services) {
  return {
    version: 1,
    groups: [
      { key: 'lash-lift', label: 'Lash lift', order: 20, photo: PHOTO },
      { key: 'lash-extensions', label: 'Lash extensions', order: 10, photo: { ...PHOTO, focal: '50% 45%' } }
    ],
    services
  };
}

function merge(meta, overrides = {}) {
  return mergeCatalog({
    services: MOCK_SERVICES, categories: MOCK_CATEGORIES, staff: MOCK_STAFF, meta,
    providerId: MOCK_PROVIDER_ID, depositCents: 5000, feeBasisPoints: 0, ...overrides
  });
}

test('hides Setmore services that are not in meta', () => {
  const { groups } = merge(smallMeta([{ service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, photo: null, deposit: 'standard' }]));
  const ids = groups.flatMap((group) => group.services.map((service) => service.service_id));
  assert.deepEqual(ids, ['svc_lash_lift']);
  assert.deepEqual(groups.map((group) => group.key), ['lash-lift'], 'a group without visible services is omitted');
});

test('maps Setmore fields to the public service shape', () => {
  const { groups } = merge(smallMeta([
    { service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, display_name: 'Lash lift (natural)', blurb: 'Lifted, curled lashes', photo: null, deposit: 'standard' }
  ]));
  assert.deepEqual(groups[0].services[0], {
    service_id: 'svc_lash_lift',
    name: 'Lash lift (natural)',
    blurb: 'Lifted, curled lashes',
    duration_minutes: 60,
    price_cents: 11500,
    notice: null,
    photo: { ...PHOTO, focal: '50% 50%' },
    deposit: { required: true, deposit_cents: 5000, fee_cents: 0, total_cents: 5000, fee_basis_points: 0 }
  });
});

test('uses the Setmore title when display_name is omitted', () => {
  const { groups } = merge(smallMeta([{ service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, deposit: 'standard' }]));
  assert.equal(groups[0].services[0].name, 'Lash Lift');
  assert.equal(groups[0].services[0].blurb, null);
});

test('skips meta entries missing in Setmore and warns meta_service_missing', () => {
  const { groups, warnings } = merge(smallMeta([
    { service_id: 'svc_gone', group: 'lash-lift', order: 10, photo: null, deposit: 'standard' },
    { service_id: 'svc_lash_lift', group: 'lash-lift', order: 20, photo: null, deposit: 'standard' }
  ]));
  assert.deepEqual(groups[0].services.map((service) => service.service_id), ['svc_lash_lift']);
  assert.deepEqual(warnings, [{ code: 'meta_service_missing', service_id: 'svc_gone' }]);
});

test('skips services the configured provider does not offer', () => {
  const { groups, warnings } = merge(
    smallMeta([{ service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, deposit: 'standard' }]),
    { providerId: 'staff_other' }
  );
  assert.deepEqual(groups, []);
  assert.deepEqual(warnings, [{ code: 'service_not_offered_by_provider', service_id: 'svc_lash_lift' }]);
});

test('falls back to the group photo when service photo is null, and keeps an override', () => {
  const { groups } = merge(smallMeta([
    { service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, photo: null, deposit: 'standard' },
    { service_id: 'svc_lash_lift_tinting', group: 'lash-lift', order: 20, photo: OVERRIDE_PHOTO, deposit: 'standard' }
  ]));
  assert.equal(groups[0].services[0].photo.src, PHOTO.src);
  assert.deepEqual(groups[0].services[1].photo, { ...OVERRIDE_PHOTO, focal: '50% 50%' });
});

test('depositQuote with fee 0 bp returns 5000/0/5000', () => {
  assert.deepEqual(depositQuote(16500, 'standard', 5000, 0),
    { required: true, deposit_cents: 5000, fee_cents: 0, total_cents: 5000, fee_basis_points: 0 });
});

test('depositQuote with 310 bp returns 5000/155/5155 (half rounds up)', () => {
  assert.deepEqual(depositQuote(16500, 'standard', 5000, 310),
    { required: true, deposit_cents: 5000, fee_cents: 155, total_cents: 5155, fee_basis_points: 310 });
  assert.equal(depositQuote(16500, 'standard', 5000, 1).fee_cents, 1, '0.5 cent rounds up');
  assert.equal(depositQuote(16500, 'standard', 5000, 309).fee_cents, 155, '154.5 rounds up');
});

test('depositQuote for a none rule requires nothing', () => {
  assert.deepEqual(depositQuote(16500, 'none', 5000, 310),
    { required: false, deposit_cents: 0, fee_cents: 0, total_cents: 0, fee_basis_points: 0 });
});

test('price at or below the deposit forces no deposit and warns deposit_meta_overridden', () => {
  const { groups, warnings } = merge(smallMeta([
    { service_id: 'svc_lash_removal', group: 'lash-extensions', order: 10, photo: null, deposit: 'standard' }
  ]));
  assert.equal(groups[0].services[0].price_cents, 3000);
  assert.equal(groups[0].services[0].deposit.required, false);
  assert.deepEqual(warnings, [{ code: 'deposit_meta_overridden', service_id: 'svc_lash_removal' }]);
  assert.equal(depositQuote(5000, 'standard', 5000, 0).required, false, 'price equal to the deposit');
});

test('orders groups and services by order', () => {
  const { groups } = merge(smallMeta([
    { service_id: 'svc_lash_lift', group: 'lash-lift', order: 20, deposit: 'standard' },
    { service_id: 'svc_lash_lift_tinting', group: 'lash-lift', order: 10, deposit: 'standard' },
    { service_id: 'svc_classic_full_extension', group: 'lash-extensions', order: 10, deposit: 'standard' }
  ]));
  assert.deepEqual(groups.map((group) => group.key), ['lash-extensions', 'lash-lift']);
  assert.deepEqual(groups[1].services.map((service) => service.service_id), ['svc_lash_lift_tinting', 'svc_lash_lift']);
  assert.equal(groups[0].photo.focal, '50% 45%');
});

test('validateMeta rejects unknown versions, duplicates, unknown groups and incomplete photos', () => {
  const good = smallMeta([{ service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, deposit: 'standard' }]);
  assert.doesNotThrow(() => validateMeta(good));
  assert.throws(() => validateMeta({ ...good, version: 2 }), /version/);
  assert.throws(() => validateMeta({ ...good, services: [...good.services, good.services[0]] }), /duplicate/);
  assert.throws(() => validateMeta({ ...good, groups: [good.groups[0], good.groups[0]] }), /duplicate/);
  assert.throws(() => validateMeta({ ...good, services: [{ ...good.services[0], group: 'nails' }] }), /group/);
  assert.throws(() => validateMeta({ ...good, groups: [{ ...good.groups[0], photo: { ...PHOTO, alt: undefined } }, good.groups[1]] }), /photo/);
  assert.throws(() => validateMeta({ ...good, services: [{ ...good.services[0], photo: { src: PHOTO.src } }] }), /photo/);
  assert.throws(() => validateMeta({ ...good, services: [{ ...good.services[0], deposit: 'half' }] }), /deposit/);
});

test('services-meta.json passes validateMeta and every photo.src exists under New Perfection/', () => {
  validateMeta(META);
  const photos = [...META.groups.map((group) => group.photo), ...META.services.map((service) => service.photo).filter(Boolean)];
  for (const photo of photos) {
    const file = path.join(ROOT, 'New Perfection', decodeURIComponent(photo.src));
    assert.ok(fs.existsSync(file), `missing ${photo.src}`);
  }
});

test('services-meta.json whitelists 43 mock services in 6 groups, all present in the mock catalog', () => {
  const { groups, warnings } = merge(MOCK_META);
  assert.deepEqual(warnings, []);
  assert.equal(groups.length, 6);
  const ids = groups.flatMap((group) => group.services.map((service) => service.service_id));
  assert.equal(ids.length, 43);
  assert.ok(!ids.includes('svc_mega_volume_wispy'), 'MEGA Volume Wispy has no Book link and stays hidden');
  const removal = groups.flatMap((group) => group.services).find((service) => service.service_id === 'svc_lash_removal');
  assert.equal(removal.deposit.required, false);
});

function stubClient() {
  let failure = null;
  const calls = { services: 0 };
  return {
    calls,
    fail(error) { failure = error; },
    async listServices() { calls.services += 1; if (failure) throw failure; return MOCK_SERVICES; },
    async listCategories() { if (failure) throw failure; return MOCK_CATEGORIES; },
    async listStaff() { if (failure) throw failure; return MOCK_STAFF; }
  };
}

function catalogService({ client = stubClient(), clock = createClock(), cache = createMemoryCache(clock), log = () => {} } = {}) {
  const config = { setmoreProviderId: MOCK_PROVIDER_ID, depositAmountCents: 5000, cardFeeBasisPoints: 0, catalogTtlSeconds: 600 };
  return { service: createCatalogService({ client, meta: MOCK_META, config, cache, now: clock.now, log }), client, clock, cache };
}

test('serves stale catalog with stale:true when Setmore fails', async () => {
  const { service, client, clock } = catalogService();
  const first = await service.getCatalog();
  assert.equal(first.stale, false);
  clock.advance(601 * 1000);
  client.fail(new SetmoreBusy(3));
  const second = await service.getCatalog();
  assert.equal(second.stale, true);
  assert.deepEqual(second.groups, first.groups);
});

test('fails when Setmore fails and nothing is cached', async () => {
  const { service, client } = catalogService();
  client.fail(new SetmoreBusy(3));
  await assert.rejects(service.getCatalog(), SetmoreBusy);
});

test('refetches after CATALOG_TTL_SECONDS', async () => {
  const { service, client, clock } = catalogService();
  await service.getCatalog();
  clock.advance(599 * 1000);
  await service.getCatalog();
  assert.equal(client.calls.services, 1);
  clock.advance(2 * 1000);
  await service.getCatalog();
  assert.equal(client.calls.services, 2);
});

test('a new isolate reuses the shared cache entry', async () => {
  const clock = createClock();
  const cache = createMemoryCache(clock);
  const client = stubClient();
  await catalogService({ client, clock, cache }).service.getCatalog();
  await catalogService({ client, clock, cache }).service.getCatalog();
  assert.equal(client.calls.services, 1);
});

test('concurrent callers share one upstream round', async () => {
  const { service, client } = catalogService();
  await Promise.all([service.getCatalog(), service.getCatalog(), service.getCatalog()]);
  assert.equal(client.calls.services, 1);
});

test('merge warnings are logged', async () => {
  const events = [];
  const client = stubClient();
  const original = client.listServices;
  client.listServices = async () => (await original()).filter((item) => item.id !== 'svc_lash_lift');
  await catalogService({ client, log: (event, fields) => events.push({ event, ...fields }) }).service.getCatalog();
  assert.deepEqual(events, [{ event: 'meta_service_missing', service_id: 'svc_lash_lift' }]);
});

test('getService returns a whitelisted service with its group, or null', async () => {
  const { service } = catalogService();
  const lift = await service.getService('svc_lash_lift');
  assert.equal(lift.group, 'lash-lift');
  assert.equal(lift.duration_minutes, 60);
  assert.equal(lift.price_cents, 11500);
  assert.equal(await service.getService('svc_mega_volume_wispy'), null);
  assert.equal(await service.getService('svc_unknown'), null);
});

test('services-meta uses real Setmore ids and keeps the mock id for mock mode', () => {
  const mockIds = new Set(MOCK_SERVICES.map((service) => service.id));
  assert.equal(META.services.length, 43);
  for (const service of META.services) {
    assert.ok(!service.service_id.startsWith('svc_'), service.service_id);
    assert.match(service.service_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.ok(mockIds.has(service.mock_id), service.mock_id);
  }
  assert.equal(new Set(META.services.map((service) => service.service_id)).size, 43);
});

test('metaForMock swaps in the mock ids without touching the source meta', () => {
  const meta = { version: 1, groups: [], services: [{ service_id: 'real-1', mock_id: 'svc_a', group: 'g' }] };
  const mock = metaForMock(meta);
  assert.equal(mock.services[0].service_id, 'svc_a');
  assert.equal(meta.services[0].service_id, 'real-1');
});

test('every non-removal/shaping service has a short site-based blurb; full sets say "from 150 lashes per eye"', async () => {
  const { readFileSync } = await import('node:fs');
  const meta = JSON.parse(readFileSync(new URL('../../worker/config/services-meta.json', import.meta.url), 'utf8'));
  const without = meta.services.filter((s) => !s.blurb).map((s) => s.mock_id);
  assert.deepEqual(without, ['svc_lash_removal']);
  for (const s of meta.services) {
    if (s.blurb) assert.ok(s.blurb.length <= 120, `${s.mock_id} blurb too long`);
    const fullSet = ['lash-extensions', 'wispy-lashes'].includes(s.group) && s.mock_id !== 'svc_lash_removal';
    assert.equal(/from 150 lashes per eye/i.test(s.blurb ?? ''), fullSet, s.mock_id);
  }
});

test('a service meta notice flows to the catalog service, others get null', () => {
  const { groups } = merge(smallMeta([
    { service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, deposit: 'standard', notice: 'lip-blushing-faq' }
  ]));
  assert.equal(groups[0].services[0].notice, 'lip-blushing-faq');
  const plain = merge(smallMeta([{ service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, deposit: 'standard' }]));
  assert.equal(plain.groups[0].services[0].notice, null);
});

test('a non-string or empty notice is invalid meta', () => {
  for (const notice of [5, '', '   ', {}]) {
    assert.throws(() => validateMeta(smallMeta([{ service_id: 'svc_lash_lift', group: 'lash-lift', order: 10, deposit: 'standard', notice }])), /notice/);
  }
});

test('services-meta.json flags exactly the two lip services with the FAQ notice', () => {
  const real = JSON.parse(fs.readFileSync(new URL('../../worker/config/services-meta.json', import.meta.url), 'utf8'));
  const flagged = real.services.filter((s) => s.notice).map((s) => [s.mock_id, s.notice]);
  assert.deepEqual(flagged, [['svc_lip_blushing', 'lip-blushing-faq'], ['svc_lip_blushing_touch_up', 'lip-blushing-faq']]);
});
