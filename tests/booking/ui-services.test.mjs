import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../../New Perfection/js/booking/api.js';
import { createState, parseDeepLink, resolveDeepLink } from '../../New Perfection/js/booking/state.js';
import { formatDuration, formatPrice, renderCatalogUnavailable, renderServices } from '../../New Perfection/js/booking/render-services.js';
import { mergeCatalog } from '../../worker/src/catalog.js';
import { MOCK_PROVIDER_ID, MOCK_SERVICES } from '../../worker/src/setmore/fixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'worker/config/services-meta.json'), 'utf8'));
// The same shape GET /api/booking/catalog returns.
const { groups: GROUPS } = mergeCatalog({ services: MOCK_SERVICES, meta: META, providerId: MOCK_PROVIDER_ID, depositCents: 5000, feeBasisPoints: 0 });
const CATALOG = { timezone: 'America/Los_Angeles', stale: false, groups: GROUPS };

const cards = (html) => [...html.matchAll(/<button\b[^>]*class="bk-card"[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
const cardFor = (html, id) => cards(html).find((card) => card.includes(`data-service-id="${id}"`));

test('parseDeepLink reads the service parameter', () => {
  assert.deepEqual(parseDeepLink('?service=svc_lash_lift'), { serviceId: 'svc_lash_lift' });
  assert.deepEqual(parseDeepLink('?group=lash-lift'), { group: 'lash-lift' });
  assert.deepEqual(parseDeepLink(''), {});
  assert.deepEqual(parseDeepLink('?service=%3Cscript%3E'), {}, 'malformed ids are ignored');
});

test('a known service in the deep link opens step 2 with it selected', () => {
  assert.deepEqual(resolveDeepLink({ serviceId: 'svc_lash_lift' }, CATALOG), { step: 2, serviceId: 'svc_lash_lift', group: null, error: null });
});

test('an unknown service in the deep link falls back to step 1 with no error', () => {
  assert.deepEqual(resolveDeepLink({ serviceId: 'svc_retired' }, CATALOG), { step: 1, serviceId: null, group: null, error: null });
});

test('a known group in the deep link stays on step 1 with that group first', () => {
  assert.deepEqual(resolveDeepLink({ group: 'lash-lift' }, CATALOG), { step: 1, serviceId: null, group: 'lash-lift', error: null });
  assert.deepEqual(resolveDeepLink({ group: 'nails' }, CATALOG), { step: 1, serviceId: null, group: null, error: null });
  const html = renderServices({ groups: GROUPS, focusGroup: 'lash-lift' });
  assert.ok(html.indexOf('data-group="lash-lift"') < html.indexOf('data-group="lash-extensions"'));
});

test('createState merges patches and notifies subscribers', () => {
  const state = createState({ step: 1, serviceId: null });
  const seen = [];
  const stop = state.subscribe((value) => seen.push(value.step));
  state.set({ step: 2 });
  stop();
  state.set({ step: 3 });
  assert.deepEqual(state.get(), { step: 3, serviceId: null });
  assert.deepEqual(seen, [2]);
});

test('the service list markup has aria-pressed, button semantics and no photos', () => {
  const html = renderServices({ groups: GROUPS, selectedId: 'svc_lash_lift' });
  assert.equal(cards(html).length, 43);
  assert.match(cardFor(html, 'svc_lash_lift'), /aria-pressed="true"/);
  assert.match(cardFor(html, 'svc_lash_lift_tinting'), /aria-pressed="false"/);
  assert.doesNotMatch(html, /<img\b/i, 'booking service menu is text-only without photos');
  for (const card of cards(html)) {
    assert.match(card, /type="button"/);
    assert.match(card, /class="bk-card-indicator"/);
  }
});

test('all four site-menu categories start collapsed by default when nothing is selected or focused', () => {
  const html = renderServices({ groups: GROUPS });
  const triggers = [...html.matchAll(/<button[^>]*data-group-toggle="([^"]+)"[^>]*>/g)];
  assert.equal(triggers.length, 4);
  assert.deepEqual(triggers.map((match) => match[1]), ['lash-extensions', 'permanent-makeup', 'lash-lift', 'brows']);
  for (const match of triggers) assert.match(match[0], /aria-expanded="false"/);
  assert.equal((html.match(/class="bk-cat-panel"[^>]*\binert\b/g) ?? []).length, 4);
  assert.doesNotMatch(html, /class="bk-group is-open/);
});

test('focusGroup or selectedId opens only its matching category accordion', () => {
  const focused = renderServices({ groups: GROUPS, focusGroup: 'lash-lift' });
  assert.match(focused, /data-group-toggle="lash-lift" aria-expanded="true"/);
  assert.equal((focused.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((focused.match(/class="bk-cat-panel"[^>]*\binert\b/g) ?? []).length, 3);

  const wispyFocus = renderServices({ groups: GROUPS, focusGroup: 'wispy-lashes' });
  assert.match(wispyFocus, /data-group-toggle="lash-extensions" aria-expanded="true"/);

  const selected = renderServices({ groups: GROUPS, selectedId: 'svc_lash_lift' });
  assert.match(selected, /data-group-toggle="lash-lift" aria-expanded="true"/);
  assert.match(selected, /class="bk-cat-chosen">Selected · /);
});

test('the price is rendered from price_cents as $165 and the duration from minutes', () => {
  const card = cardFor(renderServices({ groups: GROUPS }), 'svc_classic_full_extension');
  assert.match(card, /2 hr · \$165/);
  assert.equal(formatPrice(16500), '$165');
  assert.equal(formatPrice(12550), '$125.50');
  assert.equal(formatDuration(120), '2 hr');
  assert.equal(formatDuration(90), '1 hr 30 min');
  assert.equal(formatDuration(30), '30 min');
});

test('the deposit line appears only when deposit.required', () => {
  const html = renderServices({ groups: GROUPS });
  assert.match(cardFor(html, 'svc_classic_full_extension'), /\$50 deposit to book/);
  assert.doesNotMatch(cardFor(html, 'svc_lash_removal'), /deposit/i);
});

test('catalog text is escaped', () => {
  const groups = [{ ...GROUPS[0], label: 'A & <b>', services: [{ ...GROUPS[0].services[0], name: '<img src=x onerror=alert(1)>', blurb: '"quoted"' }] }];
  const html = renderServices({ groups });
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /A &amp; &lt;b&gt;/);
  assert.match(html, /&quot;quoted&quot;/);
});

test('categories use the exact website Services menu titles and sort treatments logically', () => {
  const html = renderServices({ groups: GROUPS });
  const titles = [...html.matchAll(/<span class="bk-cat-title">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(titles, ['Lash Extensions', 'Permanent Makeup', 'Lash Lift', 'Brow Lamination &amp; Tint']);
  assert.match(html, /<span class="bk-cat-meta">\d+ services · From \$\d+<\/span>/);

  // Lash Extensions: Full Sets -> Wispy Full Sets -> Refills -> Wispy Refills -> Removal.
  assert.ok(html.indexOf('svc_classic_full_extension') < html.indexOf('svc_classic_wispy'));
  assert.ok(html.indexOf('svc_classic_wispy') < html.indexOf('svc_classic_refill_2_weeks'));
  assert.ok(html.indexOf('svc_classic_refill_2_weeks') < html.indexOf('svc_classic_wispy_refill_2_weeks'));
  assert.ok(html.indexOf('svc_mega_volume_wispy_refill_3_weeks') < html.indexOf('svc_lash_removal'));

  // Permanent Makeup: Initial Sessions (Brows -> Lips -> Eyeliner) before Touch-Ups.
  assert.ok(html.indexOf('svc_ombre_powder_eyebrows') < html.indexOf('svc_lip_blushing'));
  assert.ok(html.indexOf('svc_lip_blushing') < html.indexOf('svc_lash_line_tattoo'));
  assert.ok(html.indexOf('svc_bottom_eyeliner_tattoo') < html.indexOf('svc_ombre_powder_eyebrows_touch_up'));

  // Lash Lift: base lift before lift + tinting.
  assert.ok(html.indexOf('svc_lash_lift"') < html.indexOf('svc_lash_lift_tinting"'));
});

test('the catalog-unavailable state offers the phone number', () => {
  const html = renderCatalogUnavailable();
  assert.match(html, /Online booking is taking a short break\. Please call \(425\) 845 0045 and we&rsquo;ll book you in\./);
  assert.match(html, /<a class="button button-gold" href="tel:\+14258450045">/);
});

function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { fetch, calls };
}

test('fetchCatalog returns ok with data', async () => {
  const { fetch, calls } = fakeFetch(() => Response.json(CATALOG));
  const result = await createApi({ fetch }).fetchCatalog();
  assert.equal(result.ok, true);
  assert.equal(result.data.groups.length, 6);
  assert.equal(calls[0].url, '/api/booking/catalog');
});

test('fetchWeek encodes the query and returns the server error on failure', async () => {
  const error = { code: 'UPSTREAM_BUSY', message: 'Our booking calendar is busy right now.', retry_after_seconds: 3 };
  const { fetch, calls } = fakeFetch(() => Response.json({ error }, { status: 503 }));
  const result = await createApi({ fetch }).fetchWeek('svc_lash_lift', '2026-11-23');
  assert.deepEqual(result, { ok: false, status: 503, error });
  assert.equal(calls[0].url, '/api/booking/slots?service_id=svc_lash_lift&week_start=2026-11-23');
  await createApi({ fetch }).fetchWeek('svc_lash_lift');
  assert.equal(calls[1].url, '/api/booking/slots?service_id=svc_lash_lift');
});

test('createAppointment posts JSON and keeps extra error fields such as refreshed_week', async () => {
  const body = { error: { code: 'SLOT_TAKEN', message: 'Taken' }, refreshed_week: { week_start: '2026-11-23' } };
  const { fetch, calls } = fakeFetch(() => Response.json(body, { status: 409 }));
  const result = await createApi({ fetch }).createAppointment({ service_id: 'svc_lash_lift' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { service_id: 'svc_lash_lift' });
  assert.deepEqual(result, { ok: false, status: 409, error: body.error, data: body });
});

test('a network failure or a non-JSON reply becomes a NETWORK error', async () => {
  const offline = await createApi({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).fetchCatalog();
  assert.equal(offline.ok, false);
  assert.equal(offline.error.code, 'NETWORK');
  const html = await createApi({ fetch: async () => new Response('<html>', { status: 502 }) }).fetchCatalog();
  assert.equal(html.ok, false);
  assert.equal(html.error.code, 'NETWORK');
});
