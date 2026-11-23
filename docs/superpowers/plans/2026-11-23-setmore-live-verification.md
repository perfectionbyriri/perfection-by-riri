# Setmore Live Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove against the real Setmore account that `/book/` shows only truly free times and refuses taken slots, then put real service ids into the catalog and stand up an owner-only preview Worker.

**Architecture:** A manual GitHub Actions tool (`worker/tools/setmore-verify.js`) reuses the production Setmore client, token manager, slots service and customer resolver. Pure check functions live in a separate module and are unit-tested with fakes. Results feed a PR (real ids, optional buffer fix, docs). Stage 2 adds a `preview` Wrangler environment deployed through the connected Cloudflare account.

**Tech Stack:** Node (lts, ESM, `node:test`), no new dependencies; GitHub Actions; Cloudflare Workers + Wrangler; Setmore API v2.

**Spec:** `docs/superpowers/specs/2026-11-23-setmore-live-verification-design.md` (read it with this plan). Background: `docs/booking/ARCHITECTURE.md` §5, §6, §8, §9, §20.

## Global Constraints

- Branch `claude/dazzling-shannon-7jkxc1`. Do not merge to `main` (it deploys production).
- Test command (CI): `node --test tests/*.test.cjs tests/booking/*.test.mjs`; must stay green after every task.
- No new npm dependencies. Node ESM, same style as `worker/src/`.
- The repository and Actions logs are public: never print or store customer names, emails, phones, customer ids, booking ids, booking titles or `consumer_ids`. Service ids, titles, durations, costs and buffers are public business data and may be printed.
- `mode=read` makes GET requests only. `mode=write` runs only in GitHub environment `setmore-write` (owner is required reviewer).
- Secrets: `SETMORE_REFRESH_TOKEN`; write mode adds `SETMORE_TEST_EMAIL`, `SETMORE_TEST_PHONE`. Never as workflow inputs.
- Setmore constants: account `1a47bbdd-c70e-402d-9bcb-1c739d6752ae`, provider `b0bfa3b4-b043-4cec-b841-017a716974fd`, timezone `America/Los_Angeles`, API base `https://developer.setmore.com/api/v2` (the default of `setmoreApiBase` in `worker/src/config.js:58`).
- Test booking: shortest whitelisted service, first free start on the 15-minute grid at least 14 days ahead.
- Overlap window: the next 4 studio weeks.

## Review Focus

1. Cancelled or deleted bookings in the staff list must not count as conflicts; unknown `status` values must count as blocking (fail safe). Test in Task 1.
2. A booking that ends exactly when a slot starts is not a conflict (half-open intervals). Test in Task 1.
3. A DST week (2026-03-08 / 2026-11-01 style offsets) in the overlap window: comparisons use instants, not wall-clock strings. Test in Task 1.
4. The test booking's delete must run even if a check between create and delete throws. Test in Task 3.
5. Two Setmore services whose titles slug to the same id, or a meta entry with no match: the run fails and names them instead of guessing. Test in Task 1.

---

### Task 1: Pure verification checks

**Files:**
- Create: `worker/tools/setmore-verify/checks.js`
- Test: `tests/booking/setmore-verify-checks.test.mjs`

**Interfaces:**
- Produces:
  - `slugId(title: string) -> string`: `'svc_' + title.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')` (matches every placeholder id in `worker/src/setmore/fixtures.js`).
  - `mapCatalog(metaServices: {service_id}[], setmoreServices: {id,title,duration,cost,buffer,provider_ids,visibility}[]) -> { map: {placeholder, id, title, duration, cost, buffer_before, buffer_after, provider_ids, visibility}[], unmatched: string[], ambiguous: string[], unlisted: string[] }`. Entries whose `service_id` already equals a real Setmore `id` map to themselves.
  - `isBlocking(booking: {status?, type?}) -> boolean`: false only for statuses in `NON_BLOCKING_STATUSES` (`['CANCELLED','CANCELED','DELETED']`, compared case-insensitively); everything else, including missing status, blocks.
  - `findSlotConflicts(days: Record<string,{start_at,end_at}[]>, bookings: {start_at,end_at,status?,type?}[], { bufferBefore = 0, bufferAfter = 0 }) -> { date, start, end }[]`: a slot `[start - bufferBefore, end + bufferAfter)` conflicts with a blocking booking `[start_at, end_at)` when they overlap. Times returned as studio-local `HH:mm`.
  - `slotsOutsideHours(days, hours: Record<weekday 0-6, [openHHmm, closeHHmm] | null>, tz) -> { date, start }[]`.
  - `STUDIO_HOURS`: Mon–Sat `['10:00','17:00']`, Sun `null` (ARCHITECTURE §13 fixtures; site footer).
  - `applyMap(meta: object, map) -> object`: returns a copy of `services-meta.json` with each `service_id` replaced by its Setmore id; throws if any placeholder has no mapping.

- [ ] **Step 1: Write the failing tests**

```js
test('mapCatalog matches by slugged title and reports gaps', () => {
  const r = mapCatalog([{ service_id: 'svc_lip_blushing' }, { service_id: 'svc_missing' }],
    [{ id: 'real-1', title: 'Lip Blushing', duration: 150, cost: 450, buffer: { before: 0, after: 15 }, provider_ids: ['p'], visibility: 'PUBLIC' },
     { id: 'real-2', title: 'Brow Tint', duration: 20, cost: 30, buffer: { before: 0, after: 0 }, provider_ids: ['p'], visibility: 'PUBLIC' }]);
  assert.equal(r.map[0].id, 'real-1'); assert.equal(r.map[0].buffer_after, 15);
  assert.deepEqual(r.unmatched, ['svc_missing']); assert.deepEqual(r.unlisted, ['Brow Tint']);
});
test('mapCatalog flags two Setmore titles with the same slug as ambiguous', () => {
  const r = mapCatalog([{ service_id: 'svc_lash_lift' }], [{ id: 'a', title: 'Lash Lift' }, { id: 'b', title: 'Lash  lift' }]);
  assert.deepEqual(r.ambiguous, ['svc_lash_lift']); assert.equal(r.map.length, 0);
});
test('findSlotConflicts: overlap conflicts, touching edges do not, cancelled ignored, unknown status blocks', () => {
  const days = { '2026-12-01': [
    { start_at: '2026-12-01T10:00:00-08:00', end_at: '2026-12-01T11:00:00-08:00' },
    { start_at: '2026-12-01T11:00:00-08:00', end_at: '2026-12-01T12:00:00-08:00' },
    { start_at: '2026-12-01T13:00:00-08:00', end_at: '2026-12-01T14:00:00-08:00' } ] };
  const bookings = [
    { start_at: '2026-12-01T10:30:00-08:00', end_at: '2026-12-01T11:00:00-08:00', status: 'CONFIRMED' },
    { start_at: '2026-12-01T13:00:00-08:00', end_at: '2026-12-01T13:30:00-08:00', status: 'cancelled' },
    { start_at: '2026-12-01T13:30:00-08:00', end_at: '2026-12-01T13:45:00-08:00' } ];
  assert.deepEqual(findSlotConflicts(days, bookings, {}).map((c) => c.start), ['10:00', '13:00']);
});
test('findSlotConflicts applies buffers', () => {
  const days = { '2026-12-01': [{ start_at: '2026-12-01T11:00:00-08:00', end_at: '2026-12-01T12:00:00-08:00' }] };
  const bookings = [{ start_at: '2026-12-01T10:00:00-08:00', end_at: '2026-12-01T10:50:00-08:00', status: 'CONFIRMED' }];
  assert.equal(findSlotConflicts(days, bookings, {}).length, 0);
  assert.equal(findSlotConflicts(days, bookings, { bufferBefore: 15 }).length, 1);
});
test('findSlotConflicts compares instants across a DST change', () => {
  const days = { '2026-11-01': [{ start_at: '2026-11-01T10:00:00-08:00', end_at: '2026-11-01T11:00:00-08:00' }] };
  const bookings = [{ start_at: '2026-11-01T17:30:00Z', end_at: '2026-11-01T18:30:00Z', status: 'CONFIRMED' }];
  assert.equal(findSlotConflicts(days, bookings, {}).length, 1);
});
test('slotsOutsideHours flags Sunday and after-close starts', () => {
  const days = { '2026-12-06': [{ start_at: '2026-12-06T11:00:00-08:00', end_at: '2026-12-06T12:00:00-08:00' }],
                 '2026-12-07': [{ start_at: '2026-12-07T16:30:00-08:00', end_at: '2026-12-07T17:30:00-08:00' }] };
  assert.equal(slotsOutsideHours(days, STUDIO_HOURS, 'America/Los_Angeles').length, 2);
});
test('applyMap replaces every placeholder and refuses gaps', () => {
  const meta = { version: 1, groups: [], services: [{ service_id: 'svc_a', group: 'g' }] };
  assert.equal(applyMap(meta, [{ placeholder: 'svc_a', id: 'real-a' }]).services[0].service_id, 'real-a');
  assert.throws(() => applyMap(meta, []));
});
```

(A slot ending after close counts as outside hours: `end > close`.)

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/booking/setmore-verify-checks.test.mjs` → module not found.
- [ ] **Step 3: Implement** `checks.js` with the signatures above. Use `instantToZonedParts` from `worker/src/time.js` for local `HH:mm` and weekday; compare with `Date.parse`.
- [ ] **Step 4: Run the full test command → PASS.**
- [ ] **Step 5: Commit** `feat(booking): add Setmore verification checks`.

### Task 2: Read-mode runner and workflow

**Files:**
- Create: `worker/tools/setmore-verify.js`, `.github/workflows/setmore-verify.yml`
- Test: `tests/booking/setmore-verify-run.test.mjs`

**Interfaces:**
- Consumes: Task 1 exports; `createTokenManager`, `createSetmoreClient` (`worker/src/setmore/`); `weekWindow`, `studioToday`, `addDays` from `worker/src/time.js`; `createFetchRecorder`, `createClock` from `tests/booking/helpers/fakes.mjs`.
- Produces:
  - `runRead({ client, meta, config, now, log }) -> Promise<{ ok: boolean, catalog: ReturnType<mapCatalog>, conflicts: {working_hours: boolean, duration, buffer_before, buffer_after, date, start}[], outsideHours: {working_hours, date, start}[], bufferHonoured: boolean | null }>`.
  - `bufferHonoured`: `null` if no service has a buffer; otherwise `true` when no conflict appears only after applying buffers.
  - CLI: `node worker/tools/setmore-verify.js --mode=read|write`, runs only when executed directly (same guard as `setmore-probe.js`). Exit code 1 when `ok` is false.
  - Log lines: one `CATALOG_MAP <json>` line with the public map, then counts. Log must never contain the keys `consumer_ids`, `title` of bookings, `id` of bookings, `email`, `phone`.

- [ ] **Step 1: Write the failing tests** with a `createFetchRecorder` that serves token, `/services`, `/slots`, `/bookings/staffs/{id}`:
  - `runRead reports no conflicts when slots avoid bookings` → `ok === true`, `conflicts.length === 0`.
  - `runRead reports a conflict and ok=false when a slot overlaps a confirmed booking`.
  - `runRead calls /slots with working_hours false and true for each distinct (duration, buffer) pair over 4 weeks` → assert the recorded `/slots` query params and call count `= pairs × 4 × 2`.
  - `runRead makes only GET requests` → every recorded `call.method === 'GET'` (token refresh endpoint included, as the token manager uses it — assert against the actual method the token manager sends).
  - `log output never contains consumer data` → booking fixtures carry `consumer_ids: ['c-secret']`, `title: 'Jane Doe'`; captured log text contains neither.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `runRead`.** `client.getSlots` already sends `double_booking=false`; add `workingHours` passthrough only inside the tool by calling `client.request('GET','/slots',{query})` directly so the BFF client stays unchanged.
- [ ] **Step 4: Add `setmore-verify.yml`:** `workflow_dispatch` with input `mode` (choice `read`|`write`, default `read`); job `read` (if `mode == 'read'`) and job `write` (if `mode == 'write'`, `environment: setmore-write`); `actions/checkout@v7`, `actions/setup-node@v7` `lts/*`, `timeout-minutes: 10`, `permissions: contents: read`, `concurrency: setmore-verify`.
- [ ] **Step 5: Run the full test command → PASS; `node --check worker/tools/setmore-verify.js`.**
- [ ] **Step 6: Commit** `feat(booking): add read-only Setmore verification run`.

### Task 3: Write-mode runner

**Files:**
- Modify: `worker/tools/setmore-verify.js`
- Test: `tests/booking/setmore-verify-write.test.mjs`

**Interfaces:**
- Consumes: `createSlotsService` (`worker/src/slots.js`), `createCustomerResolver` (`worker/src/customers.js`), `createMemoryKV` (fakes), `mapCatalog` map from Task 1 (real ids from the live `/services`).
- Produces: `runWrite({ client, catalogService, slots, resolver, config, contact: {email, phone}, now, log }) -> Promise<{ ok, slot: {date, start}, slotGoneAfterCreate: boolean, freshCheckRefused: boolean, slotFreeAfterDelete: boolean, markerReturned: boolean, customerFields: string[], deleted: boolean }>`.
  - Marker: `label: 'pbr-verify'` and `notes` containing `"Setmore API verification by perfectionbyriri.com — safe to delete."`.
  - Delete: `client.request('DELETE', '/bookings/' + id)` inside `finally`.
  - Customer: `resolver.resolve({ firstName: 'Riri', lastName: 'Verification', email, phone })`, KV = `createMemoryKV()`, secret = a random 32-byte value generated per run.

- [ ] **Step 1: Write the failing tests:**
  - `runWrite picks the first 15-minute start at least 14 days ahead for the shortest service`.
  - `runWrite reports slotGoneAfterCreate and freshCheckRefused from the re-read` (fake `/slots` drops the slot after `POST /bookings`).
  - `runWrite deletes the booking even when the re-read throws` → `DELETE /bookings/{id}` recorded, result `ok === false`.
  - `runWrite fails loudly with the slot time when DELETE fails` → `ok === false`, `deleted === false`, log contains the local date and time, not the booking id.
  - `runWrite never logs the contact` → log text lacks the test email and phone.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `runWrite`; wire `--mode=write` in the CLI (reads `SETMORE_TEST_EMAIL`, `SETMORE_TEST_PHONE`; exits 1 if missing).**
- [ ] **Step 4: Run the full test command → PASS.**
- [ ] **Step 5: Commit** `feat(booking): add owner-gated Setmore write verification`.

### Task 4: Live read run and real catalog ids

**Files:**
- Modify: `worker/config/services-meta.json`, `docs/booking/ARCHITECTURE.md` (§5, §6.2, §20 O4/V2b note)
- Test: existing `tests/booking/catalog.test.mjs` plus new `meta ids are not placeholders` test in it.

- [ ] **Step 1 (owner):** confirm `SETMORE_REFRESH_TOKEN` exists in repo Actions secrets.
- [ ] **Step 2:** push, then dispatch `setmore-verify.yml` on the branch with `mode=read`; record the run ID; read the job log (`mcp__github__get_job_logs`).
- [ ] **Step 3:** if `unmatched`/`ambiguous` is non-empty, stop and show the owner the names (no guessing).
- [ ] **Step 4: Write the failing test** `services-meta uses real Setmore ids` in `tests/booking/catalog.test.mjs` → no `service_id` starts with `svc_`, and every meta id exists in `MOCK_SERVICES`.
- [ ] **Step 5:** apply the `CATALOG_MAP` with `applyMap` (one-off `node -e` using Task 1) to `services-meta.json`, and rewrite the ids in `worker/src/setmore/fixtures.js` with the same map, so mock mode and the live catalog share one id set. Add `idOf(title: string) -> string` to `tests/booking/helpers/fakes.mjs` (looks the id up in `MOCK_SERVICES` by title, throws if absent) and replace every literal `svc_…` in `tests/booking/*.test.mjs` (12 files today; `grep -rl svc_ tests/booking`) with `idOf('<title>')`. Mechanical; no assertion changes.
- [ ] **Step 6: Run the full test command → PASS.**
- [ ] **Step 7:** record in ARCHITECTURE: run ID, conflicts count, `working_hours` difference, `bufferHonoured`. Commit `feat(booking): use real Setmore service ids`.

### Task 5 (only if Task 4 shows `bufferHonoured === false` or out-of-hours slots with `working_hours=false`): slot request fix

**Files:**
- Modify: `worker/src/catalog.js` (expose `buffer_before`, `buffer_after` on each service, minutes, default 0), `worker/src/slots.js` (`upstreamDays`, `buildWeek`), `worker/src/setmore/client.js` (`getSlots` accepts `workingHours`), `worker/src/appointments.js` only if `end_at` must change.
- Test: `tests/booking/slots.test.mjs`, `tests/booking/catalog.test.mjs`.

**Interfaces:** `getSlots({ ..., workingHours = false })`; service objects gain `buffer_before: number`, `buffer_after: number`.

- [ ] **Step 1: Failing tests** pinned to the measured behaviour: `slots request duration includes buffers` → `/slots` called with `duration = duration_minutes + buffer_before + buffer_after`; `slot start shifts by buffer_before` → returned `start_at` = upstream start + `buffer_before`, still on the 15-minute grid filter after the shift; `booking end_at stays start + duration_minutes`. If the fix is `working_hours=true`: `slots request sends working_hours=true`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: full tests PASS.**
- [ ] **Step 5:** re-dispatch `mode=read`; expect `ok: true`. Commit `fix(booking): honour Setmore buffers in slot search` (or the working-hours equivalent).

### Task 6: Live write run (owner approval)

**Files:** Modify `docs/booking/ARCHITECTURE.md` §9 (customer fields), §17 (V3), §20 (V3, V6 rows).

- [ ] **Step 1 (owner):** add `SETMORE_TEST_EMAIL`, `SETMORE_TEST_PHONE`; create environment `setmore-write` with the owner as required reviewer.
- [ ] **Step 2:** tell the owner the exact action (one booking ≥14 days ahead, then delete), get a "go" in chat, dispatch `mode=write`, owner approves in GitHub.
- [ ] **Step 3:** read the log. Expected: `slotGoneAfterCreate`, `freshCheckRefused`, `slotFreeAfterDelete`, `deleted` all `true`. If `deleted` is false, tell the owner the slot time at once.
- [ ] **Step 4 (owner):** report whether the Setmore email arrived (V3).
- [ ] **Step 5:** record results with the run ID; commit `docs(booking): record Setmore write verification`.

### Task 7: Preview Worker (owner-only)

**Files:**
- Modify: `wrangler.jsonc` (add `env.preview`), `docs/booking/ARCHITECTURE.md` §15
- Test: `tests/booking/config.test.mjs` → new test `preview config: live Setmore, mock payments, non-production`.

**Interfaces:** `env.preview`: `name: "perfection-by-riri-preview"`, `workers_dev: true`, own `kv_namespaces` binding `BOOKING_KV`, same rate limits, no `triggers`, no `send_email`; vars as production except `ENVIRONMENT=preview`, `PAYMENTS_MOCK_MODE=true`, `ALLOWED_ORIGINS=https://perfection-by-riri-preview.<subdomain>.workers.dev`, Turnstile test site key `1x00000000000000000000AA` and test secret var `1x0000000000000000000000000000000AA`.

- [ ] **Step 1: Failing test** loads `wrangler.jsonc` (strip comments), asserts `env.preview.vars.SETMORE_MOCK_MODE === 'false'`, `PAYMENTS_MOCK_MODE === 'true'`, `ENVIRONMENT !== 'production'`, no `triggers`; asserts top-level production vars unchanged.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: full tests PASS; commit** `feat(booking): add preview Worker environment`.
- [ ] **Step 5:** announce the deploy, then `npx wrangler@4 deploy --env preview` through the connected Cloudflare account (dummy `CLOUDFLARE_API_TOKEN`; the proxy injects the real one). Read back the Worker list.
- [ ] **Step 6:** enable Cloudflare Access on the preview `workers.dev` hostname with a one-email allow policy (owner's email) via the Cloudflare API; verify an anonymous request gets the Access login (HTTP 302/403), not the page.
- [ ] **Step 7 (owner):** paste `SETMORE_REFRESH_TOKEN` and a generated `CUSTOMER_HASH_SECRET` in Cloudflare → Workers → `perfection-by-riri-preview` → Settings → Variables and Secrets.
- [ ] **Step 8:** smoke check as the owner: `/book/` shows real services and a week of slots matching Setmore; owner deletes any test booking. Record in ARCHITECTURE with dates; commit.

---

## Not in this plan

Square production keys, merging to `main`, the production deploy, and the `project-context` passport update (after merge).
