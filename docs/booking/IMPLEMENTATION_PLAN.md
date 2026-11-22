# Booking BFF and `/book/` UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a white-label booking flow at `perfectionbyriri.com/book/`. It takes a $50 Square deposit and creates a confirmed Setmore booking through a server-side BFF.

**Architecture:** A Cloudflare Worker in this repo (`worker/`) answers `/api/booking/*` (`run_worker_first: ["/api/*"]`); static assets stay as they are. The Worker wraps Setmore API v2 (TokenManager, retry and 429 policy, mock mode) and Square (delayed capture). Cloudflare KV holds only the idempotency records and the HMAC customer index. The UI is a static page with vanilla JS that calls the BFF.

**Tech Stack:** Plain JavaScript ES modules, no runtime dependencies. Cloudflare Workers (KV, Cache API, Cron Triggers, Rate Limiting, `send_email`). Square Web Payments SDK + Payments API. Cloudflare Turnstile. Tests run on Node's built-in `node:test`.

**Spec:** [DESIGN_SPEC.md](DESIGN_SPEC.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Section references below (`A§n`, `D§n`) point to them.

## Global Constraints

- Code, comments, docs and UI copy are in English. Chat with the owner is in Russian.
- No new runtime dependencies and no `npm install` in CI. Worker modules are `.js` ES modules under `worker/` (`worker/package.json` has `{"type":"module","private":true}`). Tests are `tests/booking/*.test.mjs`.
- Test command: `node --test tests/*.test.cjs tests/booking/*.test.mjs` (Node ≥ 22).
- Studio zone `America/Los_Angeles`. Setmore base `https://developer.setmore.com/api/v2`.
- `SETMORE_REFRESH_TOKEN`, `SQUARE_ACCESS_TOKEN`, `CUSTOMER_HASH_SECRET`, `TURNSTILE_SECRET_KEY` never appear in responses, errors, logs, Git or PR text.
- Never call Setmore `/customers` or `/bookings` from any verification tool. Live writes happen only in Task 23, with the owner's approval.
- Deposit `DEPOSIT_AMOUNT_CENTS=5000`. Card fee `CARD_FEE_BASIS_POINTS=0` by default. Square `delay_duration=PT48H` (allowed `PT24H`–`PT48H`), `delay_action=CANCEL`.
- Setmore POSTs are never retried. GETs get at most 2 retries on 429, 5xx or timeout.
- If `ENVIRONMENT=production` and `SETMORE_MOCK_MODE` or `PAYMENTS_MOCK_MODE` is `true`, return 500 `MISCONFIGURED`.
- One commit per task, on branch `claude/dazzling-shannon-7jkxc1`. Commit trailers follow the session's attribution rule.

## Review Focus

1. **Client sends `start_at` in another offset form** (for example `2026-11-27T21:00:00Z` for 13:00 PST). Expect it to match the slot by instant, not by string. Test in Task 11.
2. **Double tap or network retry with the same idempotency key while the first request runs.** Expect 409 `IN_PROGRESS`, then the stored 201 body on a later retry. Never a second charge or booking. Test in Task 11.
3. **Phone typed as `+1 (425) 845-0045`, `425.845.0045` or `14258450045`.** Expect the same customer key. Test in Task 9.
4. **Email with capitals or spaces (` Anna@Example.COM `).** Expect the same customer as `anna@example.com`. Test in Task 9.
5. **Tampered amount fields in the request body (`amount_cents: 1`).** Expect them ignored; the charged amount always comes from the server quote. Test in Task 11.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `worker/package.json` | Marks `worker/` as ES modules | 1 |
| `worker/tools/setmore-probe.js` | Read-only v2/v1 token and shape probe (CLI) | 1 |
| `.github/workflows/setmore-probe.yml` | Runs the probe with the repository secret | 1 |
| `.github/workflows/site-ci.yml` | Adds worker syntax check and booking tests | 1 |
| `worker/src/time.js` | America/Los_Angeles and DST helpers | 2 |
| `worker/src/config.js` | Env parsing, defaults, fail-closed guard | 3 |
| `worker/src/errors.js` | `BookingError`, upstream error classes, JSON error responses | 3 |
| `worker/src/setmore/token-manager.js` | Refresh token → access token cache | 4 |
| `worker/src/setmore/client.js` | Setmore HTTP: retries, 429 cooldown, 401 refresh, typed methods | 5 |
| `worker/src/setmore/mock.js`, `worker/src/setmore/fixtures.js` | MockSetmore fetch + scenarios | 6 |
| `worker/config/services-meta.json` | Whitelist + photos (D§6) | 7 |
| `worker/src/catalog.js` | Merge, deposit quote, cache | 7 |
| `worker/src/slots.js` | Week window, lead time, horizon, cache | 8 |
| `worker/src/customers.js` | HMAC index, bounded scan, create | 9 |
| `worker/src/payments/square.js`, `worker/src/payments/mock.js` | Square authorize/complete/cancel + mock | 10 |
| `worker/src/appointments.js` | Orchestration, idempotency, conflicts | 11 |
| `worker/src/alerts.js`, `worker/src/reconcile.js` | Salon e-mail alerts, orphan-authorization cron | 12 |
| `worker/src/index.js`, `wrangler.jsonc`, `.env.example`, `.gitignore` | Router, guards, bindings, local config | 13 |
| `New Perfection/book/index.html`, `css/booking.css`, `js/booking/*.js` | UI | 14–20 |
| CTA links across pages, `js/analytics.js` | Point CTAs at `/book/` | 21 |
| `js/main.js`, `js/faq.js`, `js/contact.js`, `js/service-page.js` | Privacy Policy and Terms texts | 22 |
| `tests/booking/helpers/fakes.mjs` | In-memory KV, Cache, clock, fetch recorder (test-only) | 4 |

---

## Phase 0 — Verify the API (gate)

### Task 1: Read-only Setmore probe (v2 vs v1 token, real response shapes)

Resolves A§20 V1 and V2. **Gate:** Tasks 2–23 start only after the owner confirms which API version works. If only v1 works, stop and revise Tasks 5–6 (endpoint map) before continuing.

**Files:**
- Create: `worker/package.json`, `worker/tools/setmore-probe.js`, `.github/workflows/setmore-probe.yml`, `tests/booking/setmore-probe.test.mjs`
- Modify: `.github/workflows/site-ci.yml` (syntax-check step and unit-test step)

**Interfaces:**
- Produces (exports of `worker/tools/setmore-probe.js`):
  - `schemaOf(value: unknown): unknown` — a type tree: objects map keys to child schemas, arrays become `[schemaOf(first)]` or `[]`, primitives become `'string'|'number'|'boolean'|'null'`.
  - `redact(value: unknown, key?: string): unknown` — rules below.
  - `studioWeekAfter(now: Date): { startAt: string, endAt: string }` — the next Monday 00:00 America/Los_Angeles to the following Monday 00:00, RFC 3339 with each boundary's own offset.
  - `runProbe({ env, fetch, now, log }): Promise<Report>` where `Report = { conclusion: 'v2_ok'|'v1_only'|'neither'|'skipped', v2: {...}, v1: {...} }`.
- CLI: `node worker/tools/setmore-probe.js` prints `JSON.stringify(report, null, 2)` and exits 0.

Redaction rules (`redact`):
- Id keys (`id`, `key`, `account_id`, `provider_id`, `staff_id`, `service_id`, `category_id`, `user_id`, `staff_ids`, `staff_keys`, `service_ids`): keep strings matching `/^[A-Za-z0-9_\-:.]{1,128}$/`; otherwise `'<redacted>'`.
- Value keys (`name`, `service_name`, `category_name`, `title`, `first_name`, `duration`, `duration_minutes`, `cost`, `price`, `currency`, `type`, `status`, `token_type`, `expires_in`, `timezone`, `start_at`, `end_at`, `start_time`, `end_time`): keep, **except** strings containing `@`, or matching `/^\+?[\d\s().-]{7,}$/`, become `'<redacted>'`.
- `access_token`, `refresh_token`, `refreshToken` (or any key ending in `token` other than `token_type`): always `'<redacted>'`.
- `cursor`: becomes `true`/`false` (presence only).
- Any other key: strings → `'<string>'`, numbers → `'<number>'`. Booleans and `null` are kept. Object keys (field names, date keys under `days`) are kept.
- Arrays keep their first 3 items (redacted) and append `'…(+N more)'` when longer.

Probe sequence (`runProbe`):
1. If `env.SETMORE_REFRESH_TOKEN` is empty, return `{conclusion:'skipped'}` without any fetch.
2. v2 token: `GET {v2}/o/oauth2/token?refreshToken=…`. Record `status`, `schemaOf(body)`, `redact(body)`.
3. If the v2 token works: `GET /staff`, `GET /services`, `GET /categories` (one page each, Bearer). Then `GET /slots` with `provider_id` = the first staff id, `duration` = the first service's numeric `duration|duration_minutes` (default 60), `account_id` (first found as `account_id|merchant_id|company_id` in the token data, staff[0] or services[0]; else the token's `user_id`; record `account_id_source`), `start_at`/`end_at` from `studioWeekAfter`, `timezone=America/Los_Angeles`, `slot_limit=5`. Record status, schema and redacted sample for each.
4. v1 token: `GET https://developer.setmore.com/api/v1/o/oauth2/token?refreshToken=…`. Record status and schema only.
5. Conclusion: `v2_ok` if the v2 token and all v2 reads returned 2xx; `v1_only` if the v2 token failed and v1 returned 2xx; otherwise `neither`.
6. Every request uses `method: 'GET'`, `redirect: 'error'`, `AbortSignal.timeout(10000)`. URLs in the report omit the query string.

- [ ] **Step 1: Write the failing tests** in `tests/booking/setmore-probe.test.mjs`:

```js
test('schemaOf describes nested objects and arrays by type only', () => {
  assert.deepEqual(schemaOf({ a: 'x', b: [{ c: 1 }], d: null, e: true }),
    { a: 'string', b: [{ c: 'number' }], d: 'null', e: 'boolean' });
});
test('redact keeps allowlisted id and name values', () => {
  assert.deepEqual(redact({ id: 'svc_1', service_name: 'Lash Lift', duration: 60 }),
    { id: 'svc_1', service_name: 'Lash Lift', duration: 60 });
});
test('redact hides values of unknown keys', () => {
  assert.deepEqual(redact({ email_addresses: [{ value: 'a@b.co' }], age: 30 }),
    { email_addresses: [{ value: '<string>' }], age: '<number>' });
});
test('redact hides email-like and phone-like strings under allowlisted keys', () => {
  assert.deepEqual(redact({ name: 'anna@x.com', first_name: '(425) 845 0045' }),
    { name: '<redacted>', first_name: '<redacted>' });
});
test('redact always hides tokens but keeps token_type', () => {
  assert.deepEqual(redact({ access_token: 'abc', token_type: 'BEARER' }),
    { access_token: '<redacted>', token_type: 'BEARER' });
});
test('redact truncates arrays to three items', () => {
  assert.deepEqual(redact({ staff_ids: ['a', 'b', 'c', 'd', 'e'] }).staff_ids,
    ['a', 'b', 'c', '…(+2 more)']);
});
test('studioWeekAfter returns next Monday window in Pacific time', () => {
  assert.deepEqual(studioWeekAfter(new Date('2026-11-22T20:00:00Z')),
    { startAt: '2026-11-23T00:00:00-08:00', endAt: '2026-11-30T00:00:00-08:00' });
});
test('studioWeekAfter carries different offsets across the DST change', () => {
  assert.deepEqual(studioWeekAfter(new Date('2026-10-20T19:00:00Z')),
    { startAt: '2026-10-26T00:00:00-07:00', endAt: '2026-11-02T00:00:00-08:00' });
});
test('runProbe skips without a refresh token and makes no request', async () => { /* conclusion 'skipped', calls.length 0 */ });
test('runProbe uses only GET and never touches customers or bookings', async () => { /* every call.method === 'GET'; no path matches /customers|bookings/ */ });
test('runProbe never prints the refresh or access token', async () => { /* env token 'REFRESH-SECRET-456', fake access 'ACCESS-SECRET-123'; JSON.stringify(report) and captured log contain neither */ });
test('runProbe reports v2_ok when v2 token and reads succeed', async () => { /* conclusion 'v2_ok', v2.slots.status 200 */ });
test('runProbe reports v1_only when v2 token fails and v1 succeeds', async () => { /* v2 token 401, v1 token 200 → 'v1_only' */ });
```

The `runProbe` tests use a fake `fetch` that records `{method, url}` and routes by pathname to canned v2 and v1 bodies in the shapes documented in A§7 and A§6.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/booking/setmore-probe.test.mjs`
Expected: FAIL — `Cannot find module '…/worker/tools/setmore-probe.js'`.

- [ ] **Step 3: Implement** `worker/package.json` and `worker/tools/setmore-probe.js` with the exports and rules above. The CLI entry runs only when `import.meta.url === pathToFileURL(process.argv[1]).href`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/*.test.cjs tests/booking/*.test.mjs`
Expected: all pass, including the existing `pmu-results` tests.

- [ ] **Step 5: Add the workflow and CI changes**

`.github/workflows/setmore-probe.yml`: `workflow_dispatch` plus `push` on branch `claude/dazzling-shannon-7jkxc1` with paths `worker/tools/setmore-probe.js` and `.github/workflows/setmore-probe.yml`. `permissions: contents: read`, `timeout-minutes: 5`, `actions/checkout@v7`, `actions/setup-node@v7` (`lts/*`), step `node worker/tools/setmore-probe.js` with `env: SETMORE_REFRESH_TOKEN: ${{ secrets.SETMORE_REFRESH_TOKEN }}`.

`site-ci.yml`: the syntax step also checks `worker/**/*.js`. The unit-test step runs `node --test tests/*.test.cjs tests/booking/*.test.mjs`.

- [ ] **Step 6: Commit and push**

```bash
git add worker/package.json worker/tools/setmore-probe.js tests/booking/setmore-probe.test.mjs .github/workflows/setmore-probe.yml .github/workflows/site-ci.yml
git commit -m "feat(booking): add read-only Setmore API probe"
git push -u origin claude/dazzling-shannon-7jkxc1
```

Expected: the probe run concludes `skipped` until the secret exists.

- [ ] **Step 7 (owner): Add the secret.** In GitHub → `perfectionbyriri/perfection-by-riri` → Settings → Secrets and variables → Actions, add a new repository secret `SETMORE_REFRESH_TOKEN`. The repo is public, so Actions logs are public; the probe prints only schemas and allowlisted, non-personal values.

- [ ] **Step 8: Re-run the probe and record the results**

Re-run the latest `Setmore API probe (read-only)` run. Expected: the conclusion is `v2_ok`, `v1_only` or `neither`. Write the run ID, conclusion, `account_id` source, field names for service price and duration, and the slot element format into A§20 (V1, V2) and A§6.2. Commit `docs(booking): record Setmore probe results`. **Stop for the owner.**

Before this branch merges to `main`, remove the `push` trigger from `setmore-probe.yml` and keep `workflow_dispatch` (Task 23).

---

## Phase 1 — Backend (TDD; starts after the Task 1 gate)

### Task 2: Time helpers (America/Los_Angeles, DST)

**Files:** Create `worker/src/time.js`, `tests/booking/time.test.mjs`.

**Interfaces — Produces:**
- `studioToday(now: Date, tz = 'America/Los_Angeles'): string` (`YYYY-MM-DD`)
- `addDays(dateISO: string, n: number): string`
- `zonedDateTimeToInstant(dateISO: string, hhmm: string, tz): Date` — throws `RangeError('nonexistent_local_time')` in a spring-forward gap; the earlier instant for fall-back.
- `offsetFor(instant: Date, tz): string` (`'-08:00'`/`'-07:00'`)
- `formatRfc3339Local(dateISO: string, hhmm: string, tz): string`
- `instantToZonedParts(instant: Date, tz): { date, time, offset, weekday }`
- `weekWindow(weekStartISO: string, tz): { startAt: string, endAt: string }`
- `formatSlotLabel(instant: Date, tz): string` (`'1:00 PM'`)

Approach: the `Intl.DateTimeFormat` offset-correction loop, as in `virtual-phone-agent/src/setmore.ts` `pacificSlotTimestamp`.

- [ ] **Step 1: Failing tests:**
  - `weekWindow('2026-10-26')` → `{startAt:'2026-10-26T00:00:00-07:00', endAt:'2026-11-02T00:00:00-08:00'}`
  - `weekWindow('2027-03-08')` → end `'2027-03-15T00:00:00-07:00'`, start `-08:00`
  - `zonedDateTimeToInstant('2027-03-14','02:30')` throws `nonexistent_local_time`
  - `zonedDateTimeToInstant('2027-11-07','01:30').toISOString()` → `'2027-11-07T08:30:00.000Z'` (the −07:00 reading)
  - `studioToday(new Date('2026-11-23T07:30:00Z'))` → `'2026-11-22'`
  - `formatSlotLabel(new Date('2026-11-27T21:00:00Z'))` → `'1:00 PM'`
- [ ] **Step 2:** `node --test tests/booking/time.test.mjs` → FAIL (module missing).
- [ ] **Step 3:** Implement `worker/src/time.js`.
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add Pacific time helpers`.

### Task 3: Config and error contract

**Files:** Create `worker/src/config.js`, `worker/src/errors.js`, `tests/booking/config.test.mjs`, `tests/booking/errors.test.mjs`.

**Interfaces — Produces:**
- `loadConfig(env: Record<string,string|undefined>): Config` — camelCase fields for every A§15 variable, with its default. Numbers are parsed and must be integers ≥ 0. `squareDelayDuration` must be one of `PT24H`…`PT48H` (whole hours). Throws `BookingError('MISCONFIGURED')` on invalid values, on a mock flag with `ENVIRONMENT=production`, or when mock is off and any of `SETMORE_REFRESH_TOKEN`, `SETMORE_ACCOUNT_ID`, `SETMORE_PROVIDER_ID` is missing (Square secrets likewise when `PAYMENTS_MOCK_MODE` is false).
- `class BookingError extends Error { code; status; retryAfterSeconds; fields; extra }`. The status comes from the A§12.2 table by code.
- Upstream classes: `SetmoreBusy(retryAfterSeconds)`, `SetmoreUnavailable`, `SetmoreAuthError`, `SetmoreConflict`, `SetmoreNotFound`, `PaymentDeclined(category)`, `PaymentUnavailable`.
- `errorResponse(err: unknown): Response` — `{error:{code,message,retry_after_seconds,fallback_phone:'+14258450045'}, ...extra}`. Unknown errors become 502 `UPSTREAM_UNAVAILABLE`. Messages never include `err.message` from upstream.
- `json(body, status = 200, headers = {}): Response` — adds `Content-Type: application/json; charset=utf-8` and `X-Content-Type-Options: nosniff`.

- [ ] **Step 1: Failing tests:** defaults (`cardFeeBasisPoints === 0`, `squareDelayDuration === 'PT48H'`, `depositAmountCents === 5000`, `minLeadMinutes === 120`, `bookingHorizonDays === 56`); production + mock throws `MISCONFIGURED`; `PT72H` throws; mock off without a token throws; `errorResponse(new SetmoreBusy(3))` → 503 body with code `UPSTREAM_BUSY` and `retry_after_seconds: 3`; `errorResponse(new Error('secret upstream text'))` body does not contain `secret upstream text`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add config loader and error contract`.

### Task 4: Token Manager

**Files:** Create `worker/src/setmore/token-manager.js`, `tests/booking/token-manager.test.mjs`, `tests/booking/helpers/fakes.mjs` (`createMemoryKV()`, `createMemoryCache()`, `createClock(iso)`, `createFetchRecorder(routes)`).

**Interfaces — Produces:** `createTokenManager({ refreshToken, apiBase, fetch, now, cache, marginSeconds = 60, timeoutMs = 7000 }) → { getToken(): Promise<string>, invalidate(): Promise<void> }`. The cache key is `https://bff.internal/setmore-token`. A refresh failure throws `SetmoreUnavailable`.

- [ ] **Step 1: Failing tests:**
  - `returns cached token while more than 60 s remain` — `expires_in: 3600`, clock +3539 s → 1 token fetch total.
  - `refreshes when 60 s or less remain` — clock +3541 s → 2 fetches.
  - `shares one refresh between concurrent callers` — `Promise.all` of 5 `getToken()` → 1 fetch.
  - `invalidate forces a new refresh` — `getToken`, `invalidate`, `getToken` → 2 fetches.
  - `failed refresh throws SetmoreUnavailable without the refresh token in the message` — token `'REFRESH-SECRET'`, 500 response; `err.message` and `String(err)` do not include it.
  - `reuses a token from the shared cache in a new isolate` — a second manager with the same cache → 0 new fetches.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (A§7: memory, then Cache API, then single-flight refresh).
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add Setmore token manager`.

### Task 5: Setmore client (401, 429, timeouts)

**Files:** Create `worker/src/setmore/client.js`, `tests/booking/setmore-client.test.mjs`.

**Interfaces:**
- Consumes: `createTokenManager` (Task 4), errors (Task 3).
- Produces: `createSetmoreClient({ apiBase, tokenManager, fetch, sleep, random, now, cooldownSeconds = 10, timeoutMs = 7000 })` with:
  - `listAll(path): Promise<object[]>` — follows `cursor`; more than 10 pages throws `SetmoreUnavailable`.
  - `listServices()`, `listCategories()`, `listStaff()`
  - `getSlots({ accountId, providerId, duration, startAt, endAt, timezone, slotLimit = 100 }): Promise<Record<string, unknown[]>>` (`data.days`)
  - `getCustomer(id)`, `listCustomersPage(cursor?, limit = 100): Promise<{ items, cursor }>`, `createCustomer(body)`
  - `createBooking(body)`, `listBookingsByStaff({ staffId, startAt, endAt })`

  The field names inside bodies follow the Task 1 results.

- [ ] **Step 1: Failing tests:**
  - `retries a GET after 429 and succeeds` — 429, then 200 → result returned; `sleep` called once with 400 ms ±20%.
  - `honours Retry-After up to 3 s` — `Retry-After: 2` → `sleep(2000)`; `Retry-After: 30` → `sleep(3000)`.
  - `gives up after two retries with SetmoreBusy` — 429 ×3 → throws `SetmoreBusy`; 3 fetches.
  - `enters cooldown after a final 429` — next call within 10 s throws `SetmoreBusy` with **0** new fetches; after 10 s it calls again.
  - `never retries a POST on 429 or 5xx` — `createBooking` with 429 → throws `SetmoreBusy`; 1 booking fetch.
  - `refreshes the token once on 401 and retries` — 401 then 200 → 2 API fetches, `invalidate` called once.
  - `second 401 throws SetmoreAuthError` — 401 ×2.
  - `maps resource_conflict to SetmoreConflict` — 400/409 body `{errors:[{code:'resource_conflict'}]}`.
  - `encodes the plus sign in start_at` — the request URL contains `start_at=2026-11-23T00%3A00%3A00-08%3A00` or `%2B` for positive offsets.
  - `timeout becomes SetmoreUnavailable` — the fetch rejects with `TimeoutError`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with the A§12.1 policy. Backoff delays are `[400, 1200]` ms × (0.8 + 0.4 × `random()`).
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add Setmore client with retry and cooldown`.

### Task 6: MockSetmore (`SETMORE_MOCK_MODE=true`)

**Files:** Create `worker/src/setmore/fixtures.js`, `worker/src/setmore/mock.js`, `tests/booking/setmore-mock.test.mjs`.

**Interfaces — Produces:** `createMockSetmoreFetch({ scenario = 'normal', now, rateLimitCount = 3, state = createMockState() }): typeof fetch`. It implements the token, `/services`, `/categories`, `/staff`, `/slots`, `/customers` (GET, list, POST), `/bookings` (POST) and `/bookings/staffs/{id}` routes with v2 shapes. `createMockState()` holds customers and bookings in memory. A scenario may come from the request header `X-Mock-Scenario`.

Fixtures: the 44 services from D§6.4 with ids `svc_<slug>`, prices in cents, durations in minutes; 7 categories; staff `staff_riri`; hours Monday–Saturday 10:00–17:00, Sunday closed; slots every 30 minutes where the service fits before 17:00.

- [ ] **Step 1: Failing tests** (run through the real `createSetmoreClient` + `createTokenManager`, not raw fetch):
  - `lists 44 services and one staff member`
  - `generates no slots on Sunday and none ending after 17:00` — Classic Full (120 min) on Monday 2026-11-23: last slot `15:00`.
  - `a booked slot disappears from later slot queries`
  - `slot_taken: first availability check passes, second shows the slot taken` — two `getSlots` calls for the same week; the second lacks the first returned slot.
  - `slot_taken_on_create: createBooking throws SetmoreConflict`
  - `rate_limited: client throws SetmoreBusy after 3 × 429`
  - `rate_limited_once: client succeeds after one retry`
  - `token_expired: first call 401 then success`
  - `unavailable: every call 503 → SetmoreUnavailable`
  - `double_booked_after_create: listBookingsByStaff returns an overlapping booking`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the fixtures and mock.
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add Setmore mock mode with scenarios`.

### Task 7: Catalog, `services-meta.json`, deposit quote

**Files:** Create `worker/config/services-meta.json` (format D§6.1, groups and photos D§6.3, the 43 whitelisted services with the mock ids `svc_<slug>` until O4), `worker/src/catalog.js`, `tests/booking/catalog.test.mjs`.

**Interfaces:**
- Consumes: the Setmore client (Task 5).
- Produces:
  - `validateMeta(meta): void` — throws on unknown `version`, duplicate ids, an unknown group, or a missing photo field.
  - `depositQuote(priceCents, rule, depositCents, feeBasisPoints): { required, deposit_cents, fee_cents, total_cents, fee_basis_points }` — `fee_cents = Math.floor((deposit × bp + 5000) / 10000)` (round half up).
  - `mergeCatalog({ services, categories, staff, meta, providerId, depositCents, feeBasisPoints }): { groups, warnings }` — the shape of A§14 `groups`.
  - `createCatalogService({ client, meta, config, cache, now, log }) → { getCatalog(): Promise<{ groups, stale }>, getService(serviceId): Promise<CatalogService|null> }`.

- [ ] **Step 1: Failing tests:**
  - `hides Setmore services that are not in meta`
  - `skips meta entries missing in Setmore and warns meta_service_missing`
  - `falls back to the group photo when service photo is null`
  - `depositQuote with fee 0 bp returns 5000/0/5000` and `with 310 bp returns 5000/155/5155`
  - `price at or below the deposit forces no deposit and warns deposit_meta_overridden` — Lash Removal 3000 → `required:false`.
  - `orders groups and services by order`
  - `serves stale catalog with stale:true when Setmore fails` — first call ok, clock past the TTL, client throws `SetmoreBusy` → same groups, `stale: true`.
  - `refetches after CATALOG_TTL_SECONDS` — 2 upstream rounds across 601 s.
  - `services-meta.json passes validateMeta and every photo.src exists under New Perfection/` (decode `%20`/`%26`, then `fs.existsSync`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and fill in the meta file.
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add catalog merge and deposit quote`.

### Task 8: Slots service

**Files:** Create `worker/src/slots.js`, `tests/booking/slots.test.mjs`.

**Interfaces:**
- Consumes: `time.js` (Task 2), the client (Task 5), `getService` (Task 7).
- Produces: `createSlotsService({ client, catalog, config, cache, now }) → { getWeek({ serviceId, weekStart? }), isSlotAvailable({ serviceId, startAt }): Promise<{ available: boolean, refreshedWeek }>, purgeWeek(serviceId, weekStart) }`. `getWeek` returns the A§14 slots body. `isSlotAvailable` always bypasses the cache and compares by instant.

- [ ] **Step 1: Failing tests:**
  - `returns seven days starting at week_start with labels in Pacific time`
  - `removes slots earlier than now + 120 minutes`
  - `rejects week_start beyond the 56-day horizon with OUT_OF_RANGE`
  - `rejects week_start before the current studio week with OUT_OF_RANGE`
  - `sets may_have_more when a day returns 100 slots`
  - `serves cached week within 30 s and refetches after`
  - `isSlotAvailable bypasses the cache` — the cached week shows the slot, the fresh upstream lacks it → `available:false`.
  - `isSlotAvailable matches 2026-11-27T21:00:00Z to the 1:00 PM PST slot`
  - `unknown or non-whitelisted service_id → NOT_FOUND`
  - `window across 2026-11-01 sends start_at with -07:00 and end_at with -08:00` (assert on the recorded request URL).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (A§6).
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add slots service`.

### Task 9: Customer resolver (HMAC index)

**Files:** Create `worker/src/customers.js`, `tests/booking/customers.test.mjs`.

**Interfaces — Produces:**
- `normalizeEmail(s): string` (trim, lower-case)
- `normalizePhoneUS(s): string|null` (`'+1XXXXXXXXXX'`; accepts 10 digits, or 11 starting with `1`)
- `hmacKey(secret, kind: 'e'|'p', value): Promise<string>` → `'cust:' + kind + ':' + hex(HMAC-SHA-256)` via `crypto.subtle`
- `createCustomerResolver({ client, kv, secret, maxPages = 20, log }) → { resolve({ firstName, lastName, email, phone }): Promise<{ customerId, created }> }`

- [ ] **Step 1: Failing tests:**
  - `normalizePhoneUS accepts formatted, dotted and 11-digit forms` — `+1 (425) 845-0045`, `425.845.0045`, `14258450045` → `'+14258450045'`; `'12345'` → `null`.
  - `same customer for differently cased and padded email` (Review Focus 4)
  - `same key for every phone format` (Review Focus 3)
  - `KV stores only hashes: no raw email or phone in any key or value`
  - `finds an indexed customer without scanning`
  - `stale index entry (404) is deleted and resolution continues`
  - `scan finds an existing Setmore customer and warms the index for scanned contacts`
  - `scan stops at maxPages and creates the customer`
  - `429 during scan creates the customer and logs customer_scan_aborted`
  - `email match wins over phone match and logs customer_identity_conflict`
  - `different secret produces different keys`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (A§9).
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add hashed customer index`.

### Task 10: Square payments adapter and mock

Before coding, confirm in the Square API reference (A§20 V5): the `delay_duration` limits, `delay_action`, `CompletePayment`, `CancelPayment`, and the current `Square-Version`. Pin the version in config.

**Files:** Create `worker/src/payments/square.js`, `worker/src/payments/mock.js`, `tests/booking/square.test.mjs`.

**Interfaces — Produces:** `createSquarePayments({ accessToken, environment, locationId, version, delayDuration, fetch, timeoutMs = 10000 })` and `createMockSquare({ scenario: 'approve'|'decline'|'complete_fails' })`, both with:
- `authorize({ idempotencyKey, sourceId, verificationToken, amountCents, buyerEmail, note, referenceId }): Promise<{ paymentId, receiptUrl }>` — `POST /v2/payments` with `autocomplete:false`, `delay_duration`, `delay_action:'CANCEL'`, `amount_money:{amount, currency:'USD'}`.
- `complete(paymentId): Promise<void>`, `cancel(paymentId): Promise<void>` — `POST /v2/payments/{id}/complete|cancel`, idempotent, one retry allowed.
- A decline throws `PaymentDeclined(category)` with a category from `CARD_DECLINED|CVV_FAILURE|ADDRESS_VERIFICATION_FAILURE|INSUFFICIENT_FUNDS|GENERIC_DECLINE`. A network error or 5xx throws `PaymentUnavailable`.

- [ ] **Step 1: Failing tests:** the request body has `autocomplete:false`, `delay_duration:'PT48H'`, `delay_action:'CANCEL'`, an amount of 5000; the idempotency key is passed through; the sandbox host is used when `environment === 'sandbox'`; a decline maps to `PaymentDeclined('CARD_DECLINED')`; 500 → `PaymentUnavailable`; `cancel` retries once on 503, then succeeds; the access token never appears in thrown errors; mock `decline` and `complete_fails` behave as named.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add Square delayed-capture adapter`.

### Task 11: Appointments orchestration

**Files:** Create `worker/src/appointments.js`, `tests/booking/appointments.test.mjs`.

**Interfaces:**
- Consumes: Tasks 5, 7, 8, 9, 10, plus `alerts.notify` (Task 12; inject a recording stub until then).
- Produces:
  - `validateAppointmentInput(raw): AppointmentInput` — throws `BookingError('VALIDATION_FAILED', {fields})` (D§4 step 3 limits). Unknown fields are dropped.
  - `createAppointmentService({ client, catalog, slots, customers, payments, kv, alerts, config, now, log }) → { create(raw): Promise<{ status: 200|201, body }> }`. The body follows A§14, including `deposit.payment_id`.

Order of operations: A§8.1. Idempotency record `idem:<sha256(key)>`, TTL 86400 s. Write `payment_id` right after authorize and `booking_id` right after create.

- [ ] **Step 1: Failing tests:**
  - `happy path: authorize → customer → re-check → booking → complete → 201 with payment_id`
  - `slot gone at first check: 409 SLOT_TAKEN with refreshed_week, no authorize call`
  - `slot gone at second check (mock slot_taken): cancel called once, 409 SLOT_TAKEN`
  - `Setmore conflict on create: cancel called, 409 SLOT_TAKEN`
  - `Setmore 503 on create: cancel called, 502/503 error`
  - `customer resolution fails: cancel called`
  - `payment declined: 402 PAYMENT_DECLINED, no customer created, no booking`
  - `complete fails: 201 with deposit.status pending_capture and capture_failed_booking_kept alert`
  - `post-check overlap: 201 and double_booking_detected alert, no cancel` (mock `double_booked_after_create`)
  - `no-deposit service: no payment calls, deposit.status none, payment_id null`
  - `same idempotency key while in progress → 409 IN_PROGRESS` (Review Focus 2)
  - `same idempotency key after success → 200 with the stored body, no new calls` (Review Focus 2)
  - `start_at in Z form matches the PST slot` (Review Focus 1)
  - `amount_cents in the request is ignored; authorize receives the server quote 5000` (Review Focus 5)
  - `end_at is computed from the catalog duration`
  - `booking notes contain the Square payment id and no fee clause when fee is 0`
  - `idempotency record never contains email or phone`
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add appointment orchestration`.

### Task 12: Alerts and reconciliation cron

**Files:** Create `worker/src/alerts.js`, `worker/src/reconcile.js`, `tests/booking/alerts.test.mjs`, `tests/booking/reconcile.test.mjs`.

**Interfaces — Produces:**
- `createAlerts({ sendEmail, from, to, log }) → { notify(type, { bookingId, paymentId, extra }): Promise<void> }`. Types: `double_booking_detected | capture_failed_booking_kept | payment_cancel_failed | upstream_auth_failed | orphan_authorization_cancelled`. Never throws (a failed send is logged).
- `reconcileStaleAuthorizations({ kv, payments, alerts, now, olderThanMs = 600000 }): Promise<{ cancelled, alerted }>` (A§8.4).

- [ ] **Step 1: Failing tests:** the alert body has ids only (no email, phone or name); a `sendEmail` rejection is swallowed and logged; an in-progress record older than 10 min with `payment_id` and no `booking_id` → `cancel` and state `failed`; a record with both ids → one `capture_failed_booking_kept` alert, no cancel, and no repeat alert on the next run; a fresh record (5 min) is untouched; a cancel failure → `payment_cancel_failed` alert.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full test command → PASS.
- [ ] **Step 5:** Commit `feat(booking): add salon alerts and reconciliation`.

### Task 13: Router, guards, Wrangler config, `.env.example`

Before editing `wrangler.jsonc`, confirm in the Cloudflare docs (V5) that the pinned Wrangler supports `run_worker_first` as an array and the `ratelimits` binding.

**Files:** Create `worker/src/index.js`, `.env.example`, `tests/booking/router.test.mjs`. Modify `wrangler.jsonc` (A§15), `.gitignore` (add `.dev.vars`, `.env`).

**Interfaces:**
- Consumes: every module above.
- Produces: `export default { fetch(request, env, ctx), scheduled(controller, env, ctx) }` and `buildApp(env, deps?)` for tests (`deps` overrides `fetch`, `kv`, `cache`, `now`, `sendEmail`, `rateLimiter`, `turnstileVerify`).

Routes: `GET /api/booking/catalog`, `GET /api/booking/slots`, `POST /api/booking/appointments`; any other `/api/*` → 404 `NOT_FOUND`. Guards on POST: `Content-Type: application/json`, `Origin` in `ALLOWED_ORIGINS`, body ≤ 8 KB, Turnstile verify (`https://challenges.cloudflare.com/turnstile/v0/siteverify`), rate limit (5 POST / 10 min / IP; 60 GET / min / IP). The `X-Mock-Scenario` header is honoured only when mock mode is on.

`.env.example` lists every A§15 name with a safe dev default: `SETMORE_MOCK_MODE=true`, `PAYMENTS_MOCK_MODE=true`, `ENVIRONMENT=development`, `CARD_FEE_BASIS_POINTS=0`, `SQUARE_DELAY_DURATION=PT48H`, Turnstile test keys `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`. Secrets are left empty with a comment. A header comment says: copy to `.dev.vars` for `wrangler dev`, and never commit it.

- [ ] **Step 1: Failing tests:** catalog 200 with `Cache-Control: public, max-age=60`; slots 400 without `service_id`; POST with a wrong `Origin` → 403; non-JSON → 400; 9 KB body → 400; Turnstile failure → 403 `TURNSTILE_FAILED`; 6th POST in 10 min → 429 `RATE_LIMITED`; `/api/other` → 404 JSON; production + mock → 500 `MISCONFIGURED`; `X-Mock-Scenario: rate_limited` on slots → 503 `UPSTREAM_BUSY`; the header is ignored when mock is off; `scheduled` calls reconcile; a test that reads `.env.example` asserts it contains every key `loadConfig` reads.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement and update `wrangler.jsonc` and `.gitignore`.
- [ ] **Step 4:** Full test command → PASS. Manual: `npx wrangler dev` (mock mode); `curl localhost:8787/api/booking/catalog` returns 6 groups; the site pages still load.
- [ ] **Step 5:** Commit `feat(booking): wire BFF router and Worker config`.

---

## Phase 2 — Frontend (D§3–§8)

UI logic that can be tested lives in pure modules under `New Perfection/js/booking/`, loaded as `<script type="module">`. Tests import them directly. DOM glue stays thin.

### Task 14: `/book/` page shell and styles

**Files:** Create `New Perfection/book/index.html` (same announcement, header and footer as `contact/index.html`; `<noscript>` fallback D§8), `New Perfection/css/booking.css` (D§2 tokens, `--error: #8c2f23`, layout D§3), `New Perfection/js/booking/main.js` (module entry). Modify `css/type-case.css` (label classes D§2.2) and `sitemap.xml`. Create `New Perfection/_headers` with a Content-Security-Policy for `/book/*` (A§16: `web.squarecdn.com`, `sandbox.web.squarecdn.com`, `challenges.cloudflare.com`, existing Google tags).

- [ ] **Step 1: Failing test** `tests/booking/book-page.test.mjs`: the page has exactly one `<h1>`, includes `css/booking.css` after `css/type-case.css`, has `<ol>` progress with 4 steps, has a noscript block with `tel:+14258450045`, and `_headers` lists the CSP hosts for `/book/*`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Full tests + the CI local-resource check script (copied from `site-ci.yml`) → PASS. **Step 5:** Commit `feat(book): add booking page shell`.

### Task 15: Step 1 — services and deep link

**Files:** Create `New Perfection/js/booking/api.js` (`fetchCatalog()`, `fetchWeek(serviceId, weekStart)`, `createAppointment(body)`, each returning `{ ok, data|error }`), `New Perfection/js/booking/state.js` (`createState(initial)`, `parseDeepLink(search): {serviceId?, group?}`), `New Perfection/js/booking/render-services.js`.

- [ ] **Step 1: Failing tests:** `parseDeepLink('?service=svc_lash_lift')` → `{serviceId:'svc_lash_lift'}`; an unknown service in the deep link falls back to step 1 with no error; the card markup has `aria-pressed`, explicit `width`/`height`, `loading="lazy"` from the second row on; the price is rendered from `price_cents` as `$165`; the deposit line appears only when `deposit.required`.
- [ ] **Steps 2–5:** run FAIL → implement → PASS → commit `feat(book): add service selection`.

### Task 16: Step 2 — week strip and slots

**Files:** Create `New Perfection/js/booking/render-slots.js`.

- [ ] **Step 1: Failing tests:** days with 0 slots get `aria-disabled="true"`; slots are grouped into Morning (<12:00) and Afternoon; the back arrow is disabled when `prev_week_start` is null; the "Times are shown in Pacific Time." note appears only when `Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/Los_Angeles'` (inject the zone); an empty week renders the D§4 copy and the phone link.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(book): add date and time step`.

### Task 17: Step 3 — details form

**Files:** Create `New Perfection/js/booking/validate.js` (`validateDetails(values): { valid, errors: Record<field,string> }`, mirroring server limits).

- [ ] **Step 1: Failing tests:** each D§4 step 3 rule with its exact English message (for example `'Please enter your first name.'`); phone `(425) 845 0045` is valid; notes of 501 chars are invalid; consent is required.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(book): add details form validation`.

### Task 18: Step 4 — Square card, Turnstile, submit, error states

**Files:** Create `New Perfection/js/booking/checkout.js` (`buildAppointmentBody(state, tokens)`, `mapError(errorBody): { step, message, focus }`).

- [ ] **Step 1: Failing tests:** `buildAppointmentBody` keeps one `idempotency_key` across resubmits and never includes amounts; `mapError` maps `SLOT_TAKEN` → step 2 with the D§7 banner copy and keeps the form values; `UPSTREAM_BUSY` → the busy copy with the phone; `PAYMENT_DECLINED` → an inline card error; `deposit.required=false` hides the card block and labels the button `BOOK APPOINTMENT`; the pay button label uses `total_cents` (`PAY $50.00 & BOOK`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement, loading the Square SDK from `https://web.squarecdn.com/v1/square.js` (sandbox: `https://sandbox.web.squarecdn.com/v1/square.js`) per `checkout.square.environment`, plus the Turnstile widget. **Step 4:** PASS, then a manual run in `wrangler dev` with `PAYMENTS_MOCK_MODE=true` and with Square sandbox test cards. **Step 5:** Commit `feat(book): add deposit checkout step`.

### Task 19: Step 5 — confirmation, analytics hook, calendar file

**Files:** Create `New Perfection/js/booking/confirm.js` (`fireConfirmation(result, { gtag, dataLayer, dispatch, storage })`, `buildIcs(booking): string`, `trackFunnel(name, params, gtag)`).

- [ ] **Step 1: Failing tests:**
  - `fires purchase and booking_confirmed once per booking id` — a second call with the same id does nothing (`storage` flag `purchase_sent:<id>`).
  - `booking_confirmed detail has booking_id, payment_id, deposit_cents 5000, value 50, currency USD, service_id, service_name` (A§10).
  - `dispatches pbr:booking-confirmed CustomEvent with the same detail`
  - `does not fire when deposit.status is pending_capture`
  - `buildIcs uses TZID America/Los_Angeles and the booking start/end`
  - `trackFunnel sends booking_view_service, booking_select_slot, booking_begin_checkout and booking_slot_conflict with service_id only (no PII)` (A§10; called from Tasks 15, 16, 18)
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(book): add confirmation view and conversion hook`.

### Task 20: Mobile sticky bar, summary sheet, history

**Files:** Modify `New Perfection/js/booking/main.js`, `css/booking.css`.

- [ ] **Step 1: Failing tests** (pure helpers in `state.js`): `stepFromHistory(state)` restores the step and keeps form values; `summaryLine(state)` → `'Classic full set · Thu 27, 1:00 PM'`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement the bar (D§5) with `env(safe-area-inset-bottom)` and a `<dialog>` sheet. **Step 4:** PASS, plus a manual check at 360, 540 and 800 px (Playwright screenshots at `deviceScaleFactor: 1`). **Step 5:** Commit `feat(book): add mobile booking bar`.

### Task 21: Point CTAs to `/book/`

**Files:** Modify every `href="https://perfectionbyriri1.setmore.com"` with `data-booking-url` in `New Perfection/**/*.html` to `/book/` (service pages use `/book/?group=<key>`). Remove `target="_blank"` on those links. Keep `data-booking-url` so `js/analytics.js` still fires `booking_click`. Remove the unused Setmore `preconnect`.

- [ ] **Step 1: Failing test** `tests/booking/cta-links.test.mjs`: no HTML file contains `perfectionbyriri1.setmore.com` outside `<noscript>`; every `[data-booking-url]` href starts with `/book/`.
- [ ] **Steps 2–5:** FAIL → implement → PASS (plus the CI resource check) → commit `feat(book): route booking CTAs to /book/`.

### Task 22: Privacy Policy and Terms texts

**Files:** Modify the `privacy` and `terms` strings in `New Perfection/js/main.js`, `js/faq.js`, `js/contact.js`, `js/service-page.js` (identical text in all four).

New content must state: the booking form collects first and last name, email, phone and optional notes to create and manage the appointment in Setmore. Card payments are processed by Square; the website does not store card numbers. Cloudflare Turnstile is used to prevent automated abuse. Google Analytics measures visits and booking completion. The $50 deposit policy text is given verbatim. To request access or deletion, contact the studio at (425) 845 0045. The sentence "This website does not collect personal information through its own forms or accounts." is removed.

- [ ] **Step 1: Failing test** `tests/booking/policy-text.test.mjs`: all four files contain the same `privacy` and `terms` strings; none contains `does not collect personal information`; each mentions `Square`, `Turnstile` and `Setmore`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `docs(site): update privacy and terms for online booking`. The owner reviews the wording in the PR.

---

## Phase 3 — Release

### Task 23: Live verification, passport, PR

- [ ] **Step 1:** Remove the `push` trigger from `setmore-probe.yml` (keep `workflow_dispatch`).
- [ ] **Step 2 (owner approval required):** V3 notification check. Create one booking through the deployed preview in live mode, on the owner's own email. Check for the Setmore email, then cancel it in Setmore. Record the result in A§17 and set the confirmation copy (D§4 step 5) accordingly.
- [ ] **Step 3:** Fill in the real `service_id` values in `services-meta.json` from the Task 1 output (O4). Run the full tests.
- [ ] **Step 4:** Open the PR using `.github/pull_request_template.md` (What Changed / Assumptions / Evidence / Not Verified). Include CI run IDs.
- [ ] **Step 5:** After merge, prepare the `project-context` update (`context/ads-analytics.md` and `context/site.md`): only confirmed facts with PR, commit and run IDs, via a PR in `perfectionbyriri/project-context`.

Owner actions before go-live (A§20): O1 Square production keys, O2 Google Ads conversion plan (separate approval), O3 Email Routing destination.
