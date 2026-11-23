# Booking BFF — Architecture

Status: **approved by the owner 2026-11-22**, with amendments applied (card fee default 0%, Square authorization 48 h with immediate cancel, conversion hook) · Companion to [DESIGN_SPEC.md](DESIGN_SPEC.md) · Plan: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

This document describes the backend-for-frontend (BFF) that powers `/book/`. It runs as a Cloudflare Worker in this repository, in front of the Setmore Booking API v2 and Square. It also records the decisions made with the owner, the evidence behind them, and the facts that are still unverified.

---

## 1. Intent

Clients should book on `perfectionbyriri.com` in a flow that looks as premium as the site. Today every CTA hands them off to `perfectionbyriri1.setmore.com`. The owner wants:

- no jump to a foreign domain;
- better mobile conversion;
- full control of analytics and the Google Ads conversion.

### Goals

- Show the live Setmore catalog (whitelisted) and live availability in studio time.
- Take the $50 deposit plus the card processing fee through **Square**, then create a confirmed booking in Setmore.
- Never double-charge, never charge without a booking, never create a duplicate customer or booking on a retry.
- Keep `SETMORE_REFRESH_TOKEN` and the Square access token on the server only.
- Run fully offline with `SETMORE_MOCK_MODE=true`.

### Non-goals (this phase)

- Rescheduling or cancelling through the site.
- Staff selection, multi-service baskets, gift cards.
- An own database or admin panel. Setmore holds schedules and bookings; Square holds payments. Cloudflare KV holds only caches and short-lived technical state (§9, §8.3).

### Anti-goals (failure even if it "works")

- A paid deposit without a Setmore booking, or a Setmore booking whose deposit was silently not captured.
- Raw email or phone stored outside Setmore and Square.
- A conversion fired on a click, page view or payment *attempt* (project rule: only a completed paid booking counts).
- Any Setmore or Square credential reaching the browser, logs or Git.

---

## 2. Constraints and sources

| Constraint | Source |
|---|---|
| Setmore is the single source of truth for catalog, schedule and bookings. | Owner, task constraint 2; `project-context/PROJECT_CONTEXT.md` §2 |
| Refresh token lives only on the server (BFF). | Owner, constraint 3 |
| `SETMORE_MOCK_MODE=true` is required for local development. | Owner, constraint 4 |
| Setmore has **no sandbox**: "all requests are made against live accounts." | support.setmore.com article 579360 |
| Site is static Cloudflare Workers assets (`wrangler.jsonc`: `assets` only, `run_worker_first: false`, no `main`). | Repo |
| Repo is public; `Protect Main` + `site-checks` gate Cloudflare auto-deploy from `main`. | `project-context/context/systems.md`, `.github/workflows/site-ci.yml` |
| Changes go only through GitHub branches and PRs. | `PROJECT_CONTEXT.md` §2 |
| Google Ads changes (including a new conversion action) need the owner's approval of the exact plan. | `PROJECT_CONTEXT.md` §2 |

---

## 3. Approaches considered

### 3.1 Deposit (decided)

| Option | Trade-off | Outcome |
|---|---|---|
| (a) Custom UI for discovery, payment on the Setmore page | Keeps Setmore's deposit flow. Setmore direct links preselect only **service + staff**, not date or slot (support article 14415769, 2026-07-30), so the client would pick the time twice. | Rejected by the owner's rule "if no slot deep link → option (c)". |
| (b) Book via API without a deposit | Simplest. Changes salon policy and breaks the `Setmore - Confirmed Paid Booking` conversion. | Rejected. |
| **(c) Own deposit via Square, then create the Setmore booking via API** | Full white-label. Payments live in Square, bookings in Setmore. Needs careful ordering (§8). | **Chosen** (owner, 2026-11-22). Gateway: **Square**. The card fee is **added** to the deposit. |

### 3.2 Where the BFF runs (decided)

| Option | Trade-off | Outcome |
|---|---|---|
| **A. Worker in this repo and Cloudflare project** (`main` + `run_worker_first: ["/api/*"]`) | One deploy. Same CI gate. Code is public, secrets are not. | **Chosen** |
| B. Separate Worker in a private repo on route `/api/booking/*` | Hides code; second pipeline and more upkeep. | Rejected |
| C. Pages Functions | Not applicable: the project is Workers assets, not Pages. | Dropped |

### 3.3 Where the UI lives (decided)

**Dedicated `/book/` page** (chosen) versus an overlay on every page (rejected: heavier JS everywhere, harder funnel tracking).

---

## 4. System overview

```
Browser /book/ (static, js/booking.js)
   │  GET  /api/booking/catalog
   │  GET  /api/booking/slots?service_id&week_start
   │  POST /api/booking/appointments   (Square card token + details)
   ▼
Cloudflare Worker  worker/src/index.js   (run_worker_first: ["/api/*"])
   ├─ config        env parsing; fail closed on bad config
   ├─ TokenManager  refresh token → access token (memory + Cache API)
   ├─ SetmoreClient fetch wrapper: 401 refresh, 429 policy, timeouts
   │     └─ MockSetmore (SETMORE_MOCK_MODE=true) — same interface
   ├─ Catalog       Setmore services/categories/staff ⨝ services-meta.json
   ├─ Slots         7-day window, America/Los_Angeles, short cache
   ├─ Customers     HMAC index in KV → Setmore customer id
   ├─ Payments      Square CreatePayment (delayed capture) / Complete / Cancel
   │     └─ MockSquare (PAYMENTS_MOCK_MODE=true)
   ├─ Appointments  orchestration + idempotency (KV)
   └─ Alerts        salon e-mail via Cloudflare send_email + structured logs
   ▼                                   ▼
Setmore API v2                    Square API
https://developer.setmore.com/api/v2   https://connect.squareup.com/v2 (sandbox: connect.squareupsandbox.com)
```

Static assets keep being served without invoking the Worker. Only `/api/*` runs the Worker first. Any other `/api/*` path returns 404 JSON.

---

## 5. Catalog cache and `services-meta.json` merge

Setmore v2 endpoints used: `GET /services`, `GET /categories`, `GET /staff`. All list responses use the envelope `{ "data": [...], "cursor": "..." }`, and the cursor is omitted on the last page. The client follows the cursor to the end. If more than 10 pages are needed, it stops with a fail-closed error rather than serving a partial catalog (the voice agent has the same rule).

**Observed v2 shapes** (probe run [44989221725](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/44989221725), attempt 2, 2026-11-22; all 200, one page each, no `cursor` returned):

| Endpoint | Count | Fields |
|---|---|---|
| `GET /services` | 44 | `id`, `account_id`, `title` (display name, e.g. "Hybrid Full Extension 2D-3D"), `provider_ids[]`, `type` (`"SERVICE"`), `cost` (USD **dollars** as a number, e.g. `180`), `duration` (minutes, e.g. `120`), `color_code`, `buffer{before,after}`, `visibility`, `location{}`, `category_ids[]`, `currency` (`"USD"`) |
| `GET /categories` | 9 (the public page shows 7) | `id`, `account_id`, `title`, `service_ids[]`, `visibility` |
| `GET /staff` | 2 | `id`, `first_name`, `last_name`, `avatar_url`, `phone_numbers[{id,value,primary}]`, `email_addresses[{id,value,primary}]`, `urls{}`, `social{}`, `location{}` (second record), `custom_fields{}` |

Consequences for the adapter: the service name field is `title` (not `service_name`); `price_cents = Math.round(cost × 100)`; the staff link is `provider_ids[]`; the category link exists both ways (`category_ids[]` and `service_ids[]`). `visibility` is used to skip hidden categories and services (exact values still to be read, see V2b). Staff contact fields are never stored or logged.

Merge (pure function, unit-tested):

1. Keep only services whose `id` is in `services-meta.json` (whitelist).
2. Drop services whose `provider_ids` does not contain `SETMORE_PROVIDER_ID`.
3. Join meta: group, order, `display_name`, blurb, photo (service photo, or the group photo as fallback), deposit rule.
4. Compute a **deposit quote** per service on the server (§11). The browser never computes money.
5. Log `meta_service_missing` for meta ids absent from Setmore, and `deposit_meta_overridden` when the price is at or below the deposit.

Caching:

| Layer | Key | TTL | Notes |
|---|---|---|---|
| Isolate memory | `catalog` | `CATALOG_TTL_SECONDS` (default 600) | Fast path |
| Cache API (per data centre) | `https://bff.internal/catalog/v1` | same | Shared by isolates in one colo |
| Stale fallback | same entry, kept up to 24 h | — | Served with `"stale": true` when Setmore fails or returns 429 |

The response to the browser carries `Cache-Control: public, max-age=60` so repeat views do not hit the Worker hard. Catalog data contains no PII.

---

## 6. Slots: time zone, window, limits

Setmore v2 `GET /slots` (developers.setmore.com/slots/getslots):

- Required: `account_id`, `provider_id`, `duration` (1–1439 min), `start_at`, `end_at`, `timezone` (IANA).
- Optional: `slot_limit` (1–100, default 15), `double_booking` (default false), `working_hours` (default false).
- `start_at`/`end_at` are RFC 3339 **with offset**, in whole seconds. The `+` must be URL-encoded.
- **`end_at − start_at` must not exceed 7 days.**
- There is no `service_id` parameter. The BFF passes the service's `duration` from the catalog.
- Response: `{ "data": { "days": { "yyyy-MM-dd": [ ... ] } } }`, with times in the requested zone's offset.

BFF rules:

| Rule | Value |
|---|---|
| Studio zone | `STUDIO_TIMEZONE=America/Los_Angeles`, passed as `timezone` |
| Window per request | exactly one studio week: `week_start` 00:00 local → +7 days 00:00 local. The two boundaries can carry **different offsets** across a DST change. |
| Horizon | `BOOKING_HORIZON_DAYS` (default 56). Windows beyond it return 400 `OUT_OF_RANGE`. |
| Lead time | `MIN_LEAD_MINUTES` (default 120). Slots earlier than now + lead are removed. |
| `slot_limit` | **Acts as the spacing between starts, in minutes** (2026-11-23): `5` returned a 5-minute grid (run 44990258119), `100` a 100-minute grid 10:00/11:40/13:20/15:00 (run 45122471180), while the Setmore booking page shows a 15-minute grid. The BFF sends `15`. **Confirmed 2026-11-23** on the preview (deploy `5bddf21`): a 2-hour service shows 10:00–3:00 PM every 15 minutes, matching the booking page. |
| Slot step | Spacing comes from `slot_limit` (`SETMORE_SLOT_SPACING_MINUTES = 15` in `worker/src/setmore/client.js`), chosen to match the studio's Setmore booking page; the BFF shows every start Setmore returns and no longer filters by its own grid (`SLOT_STEP_MINUTES` removed 2026-11-23). **If the owner changes the slot interval in Setmore, this constant must change too**: the API spacing follows `slot_limit`, not the booking-page setting (behaviour with `slot_limit` omitted was not tested). On 2026-11-23 `slot_limit=100` gave 10:00/11:40/13:20/15:00 (run [45122471180](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45122471180)). |
| Window keys | Setmore also returns the `end_at` date as an (empty) key. The BFF keeps only `week_start` … `week_start + 6`. |
| Cache | `SLOTS_TTL_SECONDS` (default 30), keyed by `service_id + week_start`. The fresh check before booking **bypasses** the cache (§8). A successful booking purges that week's key in the local colo. |

### 6.0 Live availability check (2026-11-23)

Run [45116866123](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45116866123) (`setmore-verify.yml`, `mode=read`, GET only) compared `/slots` with `GET /bookings/staffs/{provider}` for the next 4 studio weeks: 30 bookings, all `CONFIRMED`; slots for all 6 catalog durations (30, 60, 90, 120, 150, 180 min) with `working_hours=false` and `true`. Result: **0 slots overlapping a booking, 0 slots outside Mon–Sat 10:00–17:00**, identical slot counts for both `working_hours` values. Every service has `buffer {before: 0, after: 0}`, so buffer handling is untested by live data; if a buffer is ever set in Setmore, re-run the check (`buffer_honoured` reports it).

Re-run with `slot_limit=15` ([45124336336](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45124336336)): 30 bookings, 215–396 slots per duration over 4 weeks, **0 overlaps, 0 outside hours**, 43/43 services mapped.

### 6.1 Time zone helpers (pure, unit-tested, no dependencies)

Built on `Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'`. This is the same technique as the live voice agent's `pacificSlotTimestamp` (`virtual-phone-agent/src/setmore.ts`), which is proven in production.

- `zonedDateTimeToInstant(dateISO, 'HH:mm')` returns the UTC instant for a wall-clock time. It **rejects** non-existent local times (spring-forward gap) and resolves ambiguous fall-back times to the **earlier** instant.
- `instantToZonedParts(instant)` returns `{date, time, offset}`, where `offset` is `-08:00` or `-07:00`.
- `formatRfc3339Local(dateISO, 'HH:mm')` formats, for example, `2026-11-23T00:00:00-08:00`.
- `studioToday(now)` returns the studio date, not the UTC date.

DST transitions the tests must cover (computed with Python `zoneinfo`, 2026-11-22):

| Year | Spring forward (−08:00 → −07:00) | Fall back (−07:00 → −08:00) |
|---|---|---|
| 2026 | 2026-03-08 | 2026-11-01 |
| 2027 | 2027-03-14 | 2027-11-07 |

Required cases: a week window spanning 2026-11-01 (start offset −07:00, end offset −08:00); a window spanning 2027-03-14; 02:30 on 2027-03-14 rejected; 01:30 on 2027-11-07 resolves to −07:00; a booking at 23:30 UTC still on the previous studio date.

### 6.2 Slot shape (verified)

Probe run [44990258119](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/44990258119), 2026-11-22, `provider_id=b0bfa3b4-b043-4cec-b841-017a716974fd`, `duration=60`:

```json
{ "data": { "days": {
  "2026-11-30": [ { "start_at": "2026-11-30T14:00:00-08:00", "end_at": "2026-11-30T15:00:00-08:00" },
                  { "start_at": "2026-11-30T14:05:00-08:00", "end_at": "2026-11-30T15:05:00-08:00" } ],
  "2026-12-01": [ … ]
} } }
```

- Each element is an object `{ start_at, end_at }`, RFC 3339 with the studio offset. `end_at - start_at` equals the requested `duration`.
- Each 7-day window returns 8 date keys (the `end_at` date included, empty).
- Window 2026-11-23 → 11-30 returned **0** slots for every day (the week before the window starts is fully booked or closed; not investigated further). Window 2026-11-30 → 12-07 returned **219** slots.
- `slot_limit=5` did not cap the result (see the §6 table).
- The second staff record `f20db4f9-…` returns **400** on `/slots` and provides no services. It is not a bookable provider.
- The first run's empty week came from the same fully booked week, not from a wrong provider.

---

## 7. Token Manager

Setmore v2 auth (developers.setmore.com, "Authentication"):

- `GET https://developer.setmore.com/api/v2/o/oauth2/token?refreshToken={SETMORE_REFRESH_TOKEN}`
- Response: `{ "response": true, "data": { "token": { "access_token", "token_type": "BEARER", "expires_in", "user_id" } } }`
- Use as `Authorization: Bearer <access_token>`. An expired token returns error code `token_expired`. The docs' example `expires_in` is 604799 s, but the **observed** value is `7199` s (about 2 hours; probe run 44989221725). The 60 s margin and 401 refresh handle both.
- Observed v2 token body: `{ response, code, data: { token: { access_token, type: "user", token_type: "BEARER", expires, issued_to, scopes[], access_type, user_id, proj_id, ok, expires_in } } }`, identical in shape to the v1 token body.

Design:

1. Return the **cached token if `expiresAt − now > 60 s`** (`TOKEN_REFRESH_MARGIN_SECONDS=60`).
2. **Single-flight**: concurrent callers in one isolate share one in-flight refresh promise.
3. Storage: isolate memory first, then Cache API (`https://bff.internal/setmore-token`, `max-age = expires_in − 60`). The token is **not** written to KV, so no long-lived credential is stored at rest outside Cloudflare secrets.
4. **401 or `token_expired`** on an API call: invalidate both layers, refresh once, and retry the call **once**. A second 401 becomes `UPSTREAM_AUTH` (502) and raises an alert.
5. A failed refresh (non-2xx, timeout, bad JSON) throws `SetmoreUnavailable`. Errors never include the URL (it contains the refresh token), the token, or the response body.
6. Time is injected (`now()`) for tests. The fetcher is injected so the mock and tests share one code path.

Unit tests (written first, see the plan): cache hit within margin; refresh at margin minus 1 s; single-flight under concurrent calls; 401 → refresh → retry once; second 401 → error; secret absent from thrown messages and logs.

---

## 8. Appointment creation (`POST /api/booking/appointments`)

### 8.1 Order of operations

```
validate input + Turnstile
  │
  ├─ idempotency: KV idem:<key> exists?  → return stored result (200) or 409 IN_PROGRESS
  │
  1  fresh slot check (cache bypass)        → gone?  409 SLOT_TAKEN  (no charge)
  2  Square CreatePayment  autocomplete=false, delay_action=CANCEL
                                           → declined? 402 PAYMENT_DECLINED (no booking, no Setmore contact)
  3  resolve customer (§9)                   → find or create in Setmore; fail? CancelPayment → 502/503
  4  fresh slot check again (cache bypass)   → gone?  Square CancelPayment → 409 SLOT_TAKEN
  5  KV state → booking_requested; Setmore POST /bookings
        definite rejection (4xx error body, 429)  → CancelPayment → 409 / 503
        outcome unknown (timeout, network, 5xx)   → NO cancel; 503 BOOKING_PENDING_CONFIRMATION; cron resolves (§8.4)
        success                                   → KV state → booking_created (+ booking_id)
  6  Square CompletePayment                  → fail?  keep booking, alert salon, 201 with deposit_status="pending_capture"
  7  post-check: GET /bookings/staffs/{provider} for that day; overlap? → alert salon (no auto-cancel)
  8  store result in KV idem:<key> (24 h), purge slot cache → 201
```

- The customer is resolved **after** card authorization, so declined cards and card-testing bots never create Setmore contacts.
- Steps 2–6 use **delayed capture**. The card is authorized first and captured only after Setmore confirms the booking.
- **Authorization lifetime (owner decision): `delay_duration=PT48H`** (allowed config range `PT24H`–`PT48H`), with `delay_action=CANCEL`. The long window gives the salon time to complete the capture by hand in the Square Dashboard if a network failure happens *after* the Setmore booking exists (step 6). Square's limits for `delay_duration` are confirmed in V5.
- **Cancel rule (owner decision 2026-11-22): the deposit authorization is cancelled only when the Setmore booking was certainly not created.** That holds for failures at steps 3 and 4 (no booking request was sent), and for a *definite* rejection at step 5: a 4xx response with a Setmore error body (`resource_conflict`, `parameter_invalid`, `out_of_range`, …) or a 429 (the request was refused, not processed). These call `CancelPayment` immediately.
- When the outcome of step 5 is **unknown** (timeout, connection reset, 5xx), the booking may exist. The BFF does **not** cancel. It returns 503 `BOOKING_PENDING_CONFIRMATION` ("We couldn't confirm your booking yet. Your card has not been charged. The studio will confirm with you shortly.") and leaves the record in `booking_requested` for the cron (§8.4).
- The payment id is written to the idempotency record right after step 2. The state is advanced to `booking_requested` **before** the Setmore request is sent, and to `booking_created` right after a success. The cron relies on this order.
- Services with `deposit: "none"` skip steps 2 and 6 and the payment cancels.
- Setmore `POST /bookings` body: `type: "APPOINTMENT"`, `account_id`, `provider_id`, `consumer_ids: [customerId]`, `service_id`, `start_at`, `end_at` (start + duration, RFC 3339 with offset), `cost` (Setmore price), `notes` (client notes + `"Deposit paid online via Square: $50.00. Square payment <id>. Booked on perfectionbyriri.com."`; a fee clause is appended only when a fee is configured).

### 8.2 Slot conflict (owner decision)

- Setmore does **not** document an availability check or a 409 on `POST /bookings` (only `resource_conflict` exists in the generic error table). The BFF therefore re-checks twice (steps 1 and 4).
- If Setmore returns `resource_conflict` or 409 at step 5, it is treated as `SLOT_TAKEN`: cancel the payment, then 409.
- The race window that remains (another booking between step 4 and step 5) is caught by the post-check at step 7. **No automatic cancellation.** The salon gets an alert with both booking ids, and the client sees their confirmed booking.
- UI contract: a 409 `SLOT_TAKEN` returns `refreshed_week` slots in the body, so the client is back at step 2 with current times and the form data intact.

### 8.2.1 `/slots` lag (measured 2026-11-23, owner decision)

Run [45118376957](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45118376957) created a test booking, re-read, then deleted it. About 0.5 s after the create, `/slots` still offered the slot (the BFF fresh check would have passed); about 1 s after the delete, `/slots` still showed it taken. `GET /bookings/staffs/{id}` listed the new booking immediately. So `/slots` lags behind bookings; the size of the lag was **not measured** (only that it exceeds ~1 s). `POST /bookings` was not tested against an already-taken slot.

**Owner decision (2026-11-23):** two clients booking the same slot within that window is treated as practically impossible; no change to the fresh check. The step-7 post-check and salon alert remain the safety net. Re-open if the lag turns out to be minutes rather than seconds.

### 8.3 Idempotency

- The browser creates `idempotency_key` (UUID v4) when it enters step 4 and keeps it for every resubmit of that attempt.
- KV `idem:<sha256(key)>`: `{state, payment_id, booking_id, customer_id, service_id, start_at, result, created_at, updated_at, complete_attempts, alerted}`, TTL 72 h (longer than the 48 h authorization). No email, phone or name.
- States, in order: `started` (before step 1) → `payment_authorized` (after step 2, `payment_id` set) → `booking_requested` (just before step 5) → `booking_created` (after step 5, `booking_id` set) → `done` (after step 6). Side branches: `failed` (definite failure, authorization cancelled or never made), `capture_pending` (step 6 failed, booking kept), `needs_review` (cron could not prove the booking's state).
- Square `idempotency_key` = the same UUID, so Square deduplicates CreatePayment on retries.
- KV is eventually consistent. Two simultaneous submits with the same key in different colos are additionally protected by Square's idempotency (one payment) and by the step 4/7 checks. Acceptable for a single-salon volume.

### 8.4 Reconciliation cron

A Worker Cron Trigger (`*/15 * * * *`) scans `idem:*` records whose `updated_at` is older than 10 minutes and whose state is not final. **It cancels an authorization only when the record proves no Setmore booking request was ever sent.**

| State found | Meaning | Cron action |
|---|---|---|
| `started` | No payment yet | Mark `failed`. Nothing to cancel. |
| `payment_authorized` | Authorized; the Setmore request was **never sent** (state is advanced before sending) | `CancelPayment` → `failed`; log `orphan_authorization_cancelled`. |
| `booking_requested` | Request sent, outcome unknown | Look up the booking: `GET /bookings/staffs/{provider}?start_at=<day 00:00>&end_at=<next day 00:00>` (verified to filter by provider and date, probe run 44990258119), follow `cursor`, match `service_id` + `start_at` (by instant) + `consumer_ids` containing `customer_id`, and `status` ≠ `CANCELLED`. **Found** → set `booking_created` with `booking_id`, then handle as the next row. **Not found or lookup failed** → **no cancel**; set `needs_review`, alert `booking_outcome_unknown` once; the authorization stays (48 h) for the salon to decide. |
| `booking_created` or `capture_pending` | Booking exists; capture not confirmed | **Never cancel.** Retry `CompletePayment` (Square-idempotent), at most 3 attempts across runs (`complete_attempts`). Success → `done`. A failure alerts `capture_failed_booking_kept` once, so the salon can capture by hand within 48 h. |
| `done`, `failed`, `needs_review` | Final or waiting for a human | Skip. |

- A `CancelPayment` failure raises a `payment_cancel_failed` alert.
- Each alert type is sent at most once per record (`alerted` list).

### 8.5 Abuse protection

Payment forms attract card-testing bots. Protections:

- **Cloudflare Turnstile** token required on `POST /appointments` (verified server-side).
- Cloudflare Workers **Rate Limiting binding**: 5 POSTs per IP per 60 seconds, 60 GETs per IP per minute. The binding allows only 10 s or 60 s periods, and its counts are approximate and per location. Owner-approved 2026-11-22: 5 POSTs / 60 s is enough; no Durable Object.
- Square's own risk checks. Square SCA buyer verification (`verifyBuyer`) is used when Square requests it.

---

## 9. Customer lookup without duplicates

Setmore v2 documents **no search** by email, phone or name, only `GET /customers` (cursor, `limit` 1–100) and `GET /customers/{id}`.

**Measured account size and latency (2026-11-23):** read-only verification run [45129424879](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45129424879) (`setmore-verify.yml`, `mode=read`, commit `0217ac5`) paged through `GET /customers?limit=100` and recorded `customers_pages=2 customers_total=178 avg_page_ms=2172 max_page_ms=2404`. Fetching and indexing all 178 contacts sequentially inside `POST /api/booking/appointments` on a cold KV took **59 s wall time** (120 ms CPU) on the preview Worker because a miss paid ~4.3 s of Setmore pagination plus sequential KV `get`/`put` calls for every contact's email and phone keys on the request path.

Index (owner decision: no raw PII in KV):

- Normalise: email is trimmed and lower-cased; phone becomes E.164 `+1XXXXXXXXXX`.
- Key = `cust:e:` + hex(**HMAC-SHA-256**(`CUSTOMER_HASH_SECRET`, email)), and `cust:p:` + the same for the phone. HMAC with a server secret is the standard form of the "salted SHA-256" the owner asked for: the hash cannot be brute-forced without the secret.
- Value = Setmore customer id. No TTL. Entries are replaced when stale.
- Sync state key = `cust:sync`: `{ cursor, pass_started_at, complete_at, pages_this_pass }`.

Background sync (`syncCustomerIndex`, cron `*/15 * * * *`, owner-approved option A on 2026-11-23):

1. Every 15 minutes, `scheduled()` runs `reconcileStaleAuthorizations` and `syncCustomerIndex` in separate `try/catch` blocks so a failure in one never skips the other.
2. `syncCustomerIndex` resumes from `cust:sync.cursor` and pages `GET /customers?limit=100` (`cooldown: false`) for at most `CUSTOMER_SYNC_PAGES_PER_RUN` pages (default `10`, enough for 1,000 contacts per run vs. the 2 pages / 178 contacts measured on 2026-11-23).
3. For every contact it hashes email and phone values and writes changed keys via `indexContact`.
4. When `cursor` ends (`null`), it records `complete_at = now`, clears `cursor = null`, and starts a fresh pass from page 1 on the next cron run (keeping the previous `complete_at` set while the next pass is in progress). It logs `customer_sync_finished` with `{ pages, contacts, complete }`.
5. On `SetmoreBusy` (429) or any upstream error, it stops immediately, persists the current `cursor` in `cust:sync`, and logs `customer_sync_paused` with counts only (`{ pages, contacts, pages_this_pass }`, never PII or cursors).

Request-path resolve algorithm (`resolve()`):

1. Look up the email key, then the phone key. If found, verify with `GET /customers/{id}`. A 404 means stale: delete the key and continue.
2. On a KV miss:
   - **After at least one completed background sync pass** (`cust:sync.complete_at` is set): skip scanning completely (zero `listCustomersPage` calls) and go **straight to `POST /customers`**.
   - **Before the first completed sync pass** (`cust:sync.complete_at` is null): run a small fallback scan of `GET /customers?limit=100` for at most `CUSTOMER_SCAN_MAX_PAGES` pages (default `3`, reduced from `20`) so the first minutes after a fresh deploy do not create mass duplicates. A 429 during this fallback scan logs `customer_scan_aborted` and proceeds to create.
3. Create the customer via `POST /customers` with `first_name`, `last_name`, `email_addresses[{value, primary:true}]`, `phone_numbers[{value, primary:true}]`, then write both index keys.

**Trade-off (confirmed with the owner 2026-11-23):** a customer added in Setmore by hand less than ~15 minutes earlier (after the last cron sync pass) who books online before the next cron run will miss in KV and be created again as a duplicate.

Match priority: email first, then phone. If the email matches customer X and the phone matches customer Y, use X and log `customer_identity_conflict` (no PII in the log).

**Preview verification (2026-11-23, Workers observability, `perfection-by-riri-preview`):** the preview cron `*/15 * * * *` is registered since the 07:20 UTC deployment of `72fec0a`. Every cron run from about 07:31 to 08:46 UTC logged `customer_sync_finished {"complete": true, "pages": 2, "contacts": 178}` (cron wall time 15–90 s). Owner test bookings of a no-deposit service: `POST /api/booking/appointments` returned 201 in **3536 ms** wall time (07:33 UTC, existing contact, also logged `customer_identity_conflict`) and 201 in **3203 ms** (07:39 UTC), against 59 s before the change. Between them, two requests returned 502 `SetmoreRejected` (2203 ms and 1294 ms) and one returned 403 in 1 ms; their Setmore error codes are not in the log, so their cause is not verified.

---

## 10. Analytics and Google Ads

- GA4 property `G-9T26E3J0XS` (already on the site). The confirmation view fires `gtag('event', 'purchase', {transaction_id: <Setmore booking id>, value: <deposit total>, currency: 'USD', items: [{item_id: service_id, item_name}]})` **only** when the API response says `booking.status = "CONFIRMED"` and `deposit_status = "captured"` (or `"none"`).
- Funnel events: `booking_view_service`, `booking_select_slot`, `booking_begin_checkout`, `booking_slot_conflict`. The existing `booking_click` on CTAs stays.
- A Google Ads conversion action for the new flow (for example, "Website - Confirmed Paid Booking") is **not** created by this project. It needs the owner's approval of the exact plan, per project rules.
- **Conversion hook (owner decision).** On the confirmation view, under the same conditions as `purchase`, the UI runs exactly once per booking:

  ```js
  const detail = { booking_id, payment_id, deposit_cents, value: deposit_cents / 100, currency: 'USD', service_id, service_name };
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: 'booking_confirmed', ...detail });
  window.dispatchEvent(new CustomEvent('pbr:booking-confirmed', { detail }));
  ```

  `payment_id` is the Square payment id (`null` for no-deposit services). The future Google Ads conversion (gtag `conversion` or a GTM trigger on `booking_confirmed`) attaches to this hook without touching the booking code. The API response carries `deposit.payment_id` for this purpose.
- Duplicate guard: a sessionStorage flag `purchase_sent:<booking id>` prevents a refresh from re-firing.

---

## 11. Deposit, fee and policy

| Item | Value | Source |
|---|---|---|
| Deposit | `DEPOSIT_AMOUNT_CENTS=5000` | Setmore policy text, `PROJECT_CONTEXT` (`$50 deposit in Setmore`) |
| Deposit applies when | Setmore price **>** deposit and meta `deposit: "standard"` | Owner-approved proposal (Lash Removal $30 has none) |
| Card fee | **`CARD_FEE_BASIS_POINTS=0` (default)** → the client pays a flat **$50.00** | Owner decision 2026-11-22: no surcharge, to stay within card-network rules (Visa US 3% cap; no surcharge on debit cards). For reference, the Setmore checkout $165 → $170.12 implies 3.1% (only that rate reproduces $5.12; 2.9% + $0.30 gives $5.09). |
| Rounding | `round_half_up(deposit × bp / 10000)` in integer cents | — |
| Policy text (verbatim) | "Cancellations made on the same day as your appointment will result in the forfeiture of your $50 deposit. The deposit is non-refundable for same-day cancellations." | perfectionbyriri1.setmore.com, read 2026-11-22 |
| Refund on an earlier cancellation | Manual, by the owner in the Square Dashboard | Owner, 2026-11-22 |

**Fee switch:** the rate stays configurable, but any value above `0` is a surcharge. Before anyone sets it above `0`, card-network rules (rate cap, debit and prepaid exclusion, disclosure) and Square's surcharge policy must be checked again. With `0`, the fee line is not shown anywhere and `fee_cents` is `0`.

---

## 12. Upstream errors and HTTP 429

### 12.1 Retry policy (owner decision)

| Call | 429 / 5xx / timeout | 401 |
|---|---|---|
| GET (token, catalog, slots, customers, bookings list) | Up to **2 retries** with backoff 400 ms, then 1,200 ms, with ±20% jitter. Honour `Retry-After` up to 3 s (not documented by Setmore, but handled). | Refresh token once, retry once (§7) |
| `POST /customers`, `POST /bookings`, Square Create/Complete/Cancel | **No blind retry.** Square calls are idempotent by key and may be retried once. Setmore POSTs are never retried. | Same as GET (a 401 means the request was not processed) |

- **Cooldown**: after a final 429, the isolate stops calling Setmore for `SETMORE_COOLDOWN_SECONDS` (default 10). During cooldown, the catalog is served stale and slots return `UPSTREAM_BUSY`.
- Timeouts: 7 s per Setmore call (the same as the voice agent), 10 s per Square call.

### 12.2 Error contract (browser)

```json
{ "error": { "code": "SLOT_TAKEN", "message": "That time was just booked.", "retry_after_seconds": null, "fallback_phone": "+14258450045" }, "refreshed_week": { } }
```

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad input; `fields` lists the problems |
| `OUT_OF_RANGE` | 400 | Week beyond the horizon or in the past |
| `TURNSTILE_FAILED` | 403 | Bot check failed |
| `NOT_FOUND` | 404 | Unknown route or non-whitelisted service |
| `SLOT_TAKEN` | 409 | Slot gone at step 1, 4 or 5 |
| `IN_PROGRESS` | 409 | Same idempotency key still running |
| `PAYMENT_DECLINED` | 402 | Square declined; `decline_reason` is a safe category |
| `RATE_LIMITED` | 429 | Our own per-IP limit |
| `UPSTREAM_BUSY` | 503 | Setmore 429 after retries or during cooldown; `retry_after_seconds` set |
| `UPSTREAM_UNAVAILABLE` | 502 | Setmore or Square error or timeout |
| `UPSTREAM_AUTH` | 502 | Token refresh failing |
| `BOOKING_PENDING_CONFIRMATION` | 503 | Setmore booking outcome unknown (timeout or 5xx at step 5); authorization kept, cron resolves |
| `MISCONFIGURED` | 500 | Invalid config, or mock mode in production |

Messages are safe English. They never echo upstream bodies.

---

## 13. Mock mode

`SETMORE_MOCK_MODE=true` swaps the Setmore fetcher for **MockSetmore**, an in-memory fake that implements the v2 routes used here with the same response shapes. Everything above the fetcher (TokenManager, SetmoreClient retries, catalog, slots, appointments) runs unchanged, so mock runs exercise real code.

- Fixtures: the 44 services, prices and durations read from the public Setmore page on 2026-11-22, with placeholder ids (`svc_classic_full`, …), 7 categories, one staff member `staff_riri`, and studio hours Monday–Saturday 10:00–17:00, Sunday closed.
- Slot generation: every 30 minutes inside hours, where the service fits before 17:00, minus mock bookings.
- `POST /bookings` stores bookings in memory, so a booked slot disappears from later `GET /slots` calls.
- Scenarios, selected by `SETMORE_MOCK_SCENARIO` (default `normal`), or per request by the `X-Mock-Scenario` header (**honoured only when mock mode is on**):

| Scenario | Behaviour |
|---|---|
| `normal` | Happy path |
| `slot_taken` | The first fresh slot check passes, then the slot is taken before the second check. Exercises step 4 → payment cancel → 409. |
| `slot_taken_on_create` | Both checks pass; `POST /bookings` returns `resource_conflict`. |
| `rate_limited` | The next N calls (`SETMORE_MOCK_429_COUNT`, default 3) return 429 with `Retry-After: 1`. |
| `rate_limited_once` | One 429, then success (proves the retry path). |
| `token_expired` | The first API call returns 401 `token_expired`, then success. |
| `unavailable` | Every call returns 503. |
| `double_booked_after_create` | The post-check finds an overlapping booking and raises an alert. |

- `PAYMENTS_MOCK_MODE=true` swaps Square for **MockSquare**, with scenarios `approve` (default), `decline`, `complete_fails`. For browser testing with real card UI, use `SQUARE_ENVIRONMENT=sandbox` with Square test cards instead.
- **Safety:** if `ENVIRONMENT=production` and either mock flag is true, every `/api/booking/*` request returns 500 `MISCONFIGURED` (fail closed). The reverse check also applies: mock off without the secrets is `MISCONFIGURED`.

---

## 14. Endpoints `/api/booking/*`

All responses are JSON with `Content-Type: application/json; charset=utf-8` and `X-Content-Type-Options: nosniff`. Same origin only: no CORS headers. POST requires `Content-Type: application/json` and an `Origin` matching `ALLOWED_ORIGINS`.

### `GET /api/booking/catalog`

```json
{
  "timezone": "America/Los_Angeles",
  "stale": false,
  "groups": [
    { "key": "lash-extensions", "label": "Lash extensions",
      "photo": { "src": "...", "width": 1536, "height": 1024, "alt": "...", "focal": "50% 45%" },
      "services": [
        { "service_id": "svc_classic_full", "name": "Classic full set", "blurb": "Soft & understated",
          "duration_minutes": 120, "price_cents": 16500, "photo": { "...": "..." },
          "deposit": { "required": true, "deposit_cents": 5000, "fee_cents": 0, "total_cents": 5000, "fee_basis_points": 0 } }
      ] }
  ],
  "checkout": {
    "square": { "application_id": "...", "location_id": "...", "environment": "production" },
    "turnstile_site_key": "...",
    "policy_text": "Cancellations made on the same day ...",
    "phone": "+14258450045"
  }
}
```

### `GET /api/booking/slots?service_id=<id>&week_start=YYYY-MM-DD`

`week_start` is a studio date. If it is omitted, the current studio date is used. The BFF always returns 7 days from `week_start`.

```json
{
  "service_id": "svc_classic_full", "timezone": "America/Los_Angeles",
  "week_start": "2026-11-23", "week_end": "2026-11-29",
  "days": [ { "date": "2026-11-23", "weekday": "Monday",
              "slots": [ { "start_at": "2026-11-23T10:00:00-08:00", "label": "10:00 AM" } ] } ],
  "may_have_more": false, "prev_week_start": null, "next_week_start": "2026-11-30"
}
```

### `POST /api/booking/appointments`

Request:

```json
{
  "idempotency_key": "6f1c…-uuid",
  "service_id": "svc_classic_full",
  "start_at": "2026-11-27T13:00:00-08:00",
  "customer": { "first_name": "Anna", "last_name": "Smith", "email": "anna@example.com", "phone": "4258450045" },
  "notes": "First visit",
  "policy_accepted": true,
  "turnstile_token": "…",
  "payment": { "source_id": "cnon:…", "verification_token": "verf:…" }
}
```

`payment` is omitted for services without a deposit. `start_at` must equal a slot `start_at` returned by `/slots`. The server recomputes `end_at` from the catalog duration and never trusts a client end time or amount.

201 response:

```json
{
  "booking": { "id": "<setmore id>", "status": "CONFIRMED", "service_name": "Classic full set",
               "start_at": "2026-11-27T13:00:00-08:00", "end_at": "2026-11-27T15:00:00-08:00" },
  "deposit": { "status": "captured", "payment_id": "<square payment id>", "total_cents": 5000, "receipt_url": "https://squareup.com/receipt/…" }
}
```

`deposit.status` is one of `captured`, `none`, `pending_capture` (step 6 failed; the salon was alerted).

There is no other endpoint in this phase: no reschedule, cancel or lookup.

---

## 15. Configuration

Secrets are set with `wrangler secret put` in Cloudflare. Plain vars go in `wrangler.jsonc` `vars`. For local development, copy `.env.example` to `.dev.vars`, which Wrangler reads for `wrangler dev`. Both `.dev.vars` and `.env` are git-ignored.

| Name | Kind | Default | Purpose |
|---|---|---|---|
| `ENVIRONMENT` | var | `development` | `production` enables the fail-closed mock guard |
| `ALLOWED_ORIGINS` | var | `https://perfectionbyriri.com` | Origin check for POST |
| `STUDIO_TIMEZONE` | var | `America/Los_Angeles` | Studio zone |
| `SETMORE_MOCK_MODE` | var | `true` (dev) | Mock Setmore |
| `SETMORE_MOCK_SCENARIO` | var | `normal` | Mock scenario |
| `SETMORE_MOCK_429_COUNT` | var | `3` | For `rate_limited` |
| `SETMORE_API_BASE` | var | `https://developer.setmore.com/api/v2` | API base |
| `SETMORE_REFRESH_TOKEN` | **secret** | — | Permanent refresh token |
| `SETMORE_ACCOUNT_ID` | var | `1a47bbdd-c70e-402d-9bcb-1c739d6752ae` | `account_id` for slots and bookings (verified V1) |
| `SETMORE_PROVIDER_ID` | var | `b0bfa3b4-b043-4cec-b841-017a716974fd` | The only provider of all 44 services (verified V2b) |
| `TOKEN_REFRESH_MARGIN_SECONDS` | var | `60` | Token margin |
| `CATALOG_TTL_SECONDS` | var | `600` | Catalog cache |
| `SLOTS_TTL_SECONDS` | var | `30` | Slot cache |
| `SETMORE_COOLDOWN_SECONDS` | var | `10` | After a final 429 |
| `BOOKING_HORIZON_DAYS` | var | `56` | Booking horizon |
| `MIN_LEAD_MINUTES` | var | `120` | Earliest bookable slot |
| `CUSTOMER_SCAN_MAX_PAGES` | var | `3` | Fallback customer scan before the first completed sync pass (§9) |
| `CUSTOMER_SYNC_PAGES_PER_RUN` | var | `10` | Max `GET /customers?limit=100` pages indexed per 15-minute cron run (§9) |
| `CUSTOMER_HASH_SECRET` | **secret** | — | HMAC key for the customer index |
| `PAYMENTS_MOCK_MODE` | var | `true` (dev) | Mock Square |
| `PAYMENTS_MOCK_SCENARIO` | var | `approve` | Mock Square scenario |
| `SQUARE_ENVIRONMENT` | var | `sandbox` | `sandbox` or `production` |
| `SQUARE_APPLICATION_ID` | var | — | Public, sent to the browser |
| `SQUARE_LOCATION_ID` | var | — | Public, sent to the browser |
| `SQUARE_ACCESS_TOKEN` | **secret** | — | Server only |
| `SQUARE_VERSION` | var | pinned at implementation | `Square-Version` header |
| `SQUARE_DELAY_DURATION` | var | `PT48H` | Authorization lifetime; allowed `PT24H`–`PT48H` (V5) |
| `DEPOSIT_AMOUNT_CENTS` | var | `5000` | Deposit |
| `CARD_FEE_BASIS_POINTS` | var | `0` | Surcharge rate; `0` = none (see §11) |
| `TURNSTILE_SITE_KEY` | var | Cloudflare test key in dev | Public |
| `TURNSTILE_SECRET_KEY` | **secret** | Cloudflare test secret in dev | Server only |
| `SALON_ALERT_EMAIL` | var | — | Verified Email Routing destination |
| `BOOKING_KV` | KV binding | — | `idem:*`, `cust:*` |
| `RATE_LIMITER` | rate-limit binding | — | Per-IP limits |
| `ALERT_EMAIL` | send_email binding | — | Salon alerts |

`wrangler.jsonc` changes: `"main": "worker/src/index.js"`, `assets.run_worker_first: ["/api/*"]`, `kv_namespaces`, `ratelimits`, `send_email`, `vars`, `triggers.crons: ["*/15 * * * *"]` (§8.4, §9). `assets.directory` stays `./New Perfection`.

---

### 15.1 Preview Worker (2026-11-23)

- `wrangler.jsonc` → `env.preview`: Worker `perfection-by-riri-preview`, `https://perfection-by-riri-preview.perfection-byriri.workers.dev`, live Setmore (`SETMORE_MOCK_MODE=false`), mock payments (`PAYMENTS_MOCK_MODE=true`), Turnstile public test keys, own KV, 15-minute cron enabled (`triggers.crons: ["*/15 * * * *"]` to warm the customer index in `BOOKING_KV` via `syncCustomerIndex`; reconcile also runs against live Setmore reads and mock payments), no `send_email` (alerts log `alert_not_configured`).
- Deployed by Cloudflare Workers Builds from branch `claude/dazzling-shannon-7jkxc1` with `npx wrangler deploy --env preview` (the session proxy rewrites `Authorization`, so asset uploads cannot run from a session).
- Secrets on the preview Worker only: `SETMORE_REFRESH_TOKEN` (owner), `CUSTOMER_HASH_SECRET` (generated by the session, never printed).
- Cloudflare Access, scope **All traffic**, policy "Cloudflare account members": an anonymous request to `/book/` returns 302 to `perfection-byriri.cloudflareaccess.com` (checked 2026-11-23). Bookings made here are real Setmore bookings without a deposit; delete them in Setmore after testing.

## 16. Security and privacy

- Secrets exist only as Cloudflare secrets and local `.dev.vars`. They never appear in responses, errors or logs. A log redactor drops `refreshToken`, `Authorization`, `email`, `phone`, `first_name` and `last_name` keys before `console.log`.
- PII path: browser → Worker (in memory only) → Setmore and Square. KV stores only HMAC hashes and Setmore ids, plus idempotency records with **no** PII (booking id, status, amounts).
- Input limits: body ≤ 8 KB; field lengths as in DESIGN_SPEC §4. `start_at` must match a fresh slot.
- Card data never touches the Worker: the Square Web Payments SDK tokenizes in Square's iframe (PCI SAQ A scope).
- **Privacy Policy and Terms must change before launch.** The modal texts in `js/main.js`, `js/faq.js`, `js/contact.js` and `js/service-page.js` currently say: "This website does not collect personal information through its own forms or accounts." The new texts must say that the booking form collects name, email, phone and notes to create the appointment in Setmore. They must also say that card payments are processed by Square, that Turnstile is used for bot protection, and how to request deletion. This is a planned task.
- Content Security Policy for `/book/`: allow `web.squarecdn.com` / `sandbox.web.squarecdn.com`, `challenges.cloudflare.com`, and the existing Google tags.

---

## 17. Setmore notifications for API-created bookings

Findings (2026-11-22):

- Support article 491038: "When an appointment or class is scheduled, edited, or canceled, your customer automatically receives an email notification… whether the booking was made or updated by you or them." This covers business-made bookings, but it **does not mention the API**.
- Support article 3378413: booked → email to provider and customer; one email reminder before the appointment; SMS reminders only on Pro with text reminders enabled. There are no SMS confirmations.
- API v2 reference, changelog, "Good to know" and "Migrating from v1": **no statement** about notifications for API-created bookings. No request field controls notifications.
- The voice agent (`virtual-phone-agent`) never creates bookings, so its code gives no evidence either way.

**Status: unverified.** It is resolved by verification V3: one test booking created through the API in the live account, with the owner's approval, using the owner's own email, then cancelled. If Setmore does not email, the confirmation page and the Square receipt (sent when `buyer_email_address` is set) remain the client's record, and a follow-up decision is needed. Until V3 is done, the confirmation copy says "A confirmation email is on its way" **only** if V3 confirms it; otherwise it says "Please save this page or add it to your calendar."

---

## 18. Observability and alerts

- Structured JSON logs (Workers observability is already enabled in `wrangler.jsonc`): `event`, `request_id`, `route`, `upstream`, `status`, `duration_ms`, `scenario` (mock). There is no PII.
- Salon alert e-mail (Cloudflare `send_email` binding to `SALON_ALERT_EMAIL`), sent for `double_booking_detected`, `capture_failed_booking_kept` (complete the capture by hand in Square within 48 h), `booking_outcome_unknown` (check the Setmore calendar, then capture or cancel in Square), `payment_cancel_failed`, and `upstream_auth_failed`. Each alert has booking and payment ids only, plus a link to the Setmore calendar.
- Requires Cloudflare Email Routing enabled on the zone, with a verified destination address. This is an owner action (O3).

---

## 19. Testing strategy

- Runner: Node's built-in `node:test` (Node 22 in CI), with no new dependencies. Worker code is plain ES modules under `worker/` (`worker/package.json` has `{"type":"module"}`), so the existing CommonJS tests and browser scripts are unaffected.
- Tests live in `tests/booking/*.test.mjs`. CI's "Run unit tests" step changes to `node --test tests/*.test.cjs tests/booking/*.test.mjs`. CI also adds `node --check` for `worker/**/*.js`.
- Every module is built test-first (see IMPLEMENTATION_PLAN). Mandatory first suites: token refresh, America/Los_Angeles + DST, 429 handling, slot conflict.
- Dependencies are injected (`fetch`, `now`, `sleep`, `kv`, `cache`), so tests run without Cloudflare. A small in-memory KV and Cache fake lives in `tests/booking/helpers/`, not in production code.
- An end-to-end smoke test via `wrangler dev` in mock mode is a manual check listed in the PR, not part of CI.

---

## 20. Open items and verifications

| Id | Item | Blocks | Evidence that resolves it |
|---|---|---|---|
| V1 | **Resolved 2026-11-22** (probe run [44989221725](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/44989221725), attempt 2, conclusion `v2_ok`). The owner's refresh token works with **v2** (token, `/staff`, `/services`, `/categories`, `/slots` all 200) and also with the v1 token endpoint (200). `SETMORE_ACCOUNT_ID=1a47bbdd-c70e-402d-9bcb-1c739d6752ae` (from `services[].account_id`). Staff ids: `b0bfa3b4-b043-4cec-b841-017a716974fd` (account owner, equals the token `user_id`) and `f20db4f9-53d7-4b34-97de-0d49d4edae0d`. Which one is `SETMORE_PROVIDER_ID` is open (V2b). | — | — |
| V2 | **Mostly resolved** (same run): service, category and staff fields in §5; token body in §7; `/slots` envelope in §6.2. Create-customer required fields are not probed (no write calls). Run 45118376957 resolved an existing customer by scan; `GET /customers/{id}` fields: `custom_fields`, `email_addresses`, `first_name`, `id`, `last_name`, `location`, `phone_numbers`, `social`, `urls`. `POST /customers` itself is still unexercised. | — | — |
| V2b | **Resolved 2026-11-22** (probe run [44990258119](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/44990258119); its logs were deleted after recording). (a) `SETMORE_PROVIDER_ID=b0bfa3b4-b043-4cec-b841-017a716974fd`: all 44 services list only this id in `provider_ids`; the other staff record returns 400 on `/slots`. (b) Slot element = `{start_at, end_at}` objects on a 5-minute grid (§6.2). (c) `visibility` is `PUBLIC` for all 44 services and all 9 categories, so it hides nothing today; the whitelist in `services-meta.json` stays the only filter. (d) **Bookings lookup:** `GET /bookings/staffs/{id}?start_at&end_at&limit` returns 200 with `cursor` paging. Fields: `id`, `type`, `calendar_id`, `account_id`, `provider_id`, `consumer_ids[]`, `service_id`, `start_at`, `end_at`, `booking_id`, `cost`, `title`, `status`, `label`, `location`, `created_at`, `source`, `meta_data{reminders[], consumerTimezone, bookingId, tc[]}`. Only types and the count were printed. | — | — |
| V6 | **Resolved 2026-11-23** (run [45118376957](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45118376957)): yes, `label` and `notes` come back on `GET /bookings/staffs/{id}`. Original question: can `POST /bookings` store our own marker (for example the hashed idempotency key in `meta_data` or `label`) and return it on lookup? This would make the cron's match exact. | Cron matching (nice to have; the service + time + customer match already works) | The owner-approved live test in Task 23. |
| V3 | **Resolved 2026-11-23** (run [45118376957](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45118376957)): Setmore e-mailed the customer a booking confirmation for the API-created Lash Removal booking (owner's inbox). `DELETE /bookings/{id}` also e-mailed the customer a cancellation notice (owner, 2026-11-23). Original item: customer notifications for API-created bookings. | Confirmation copy | One owner-approved live test booking on the owner's email, then `DELETE /bookings/{id}`. |
| V4 | ~~Card fee surcharge compliance~~ **Resolved 2026-11-22:** default fee 0% (owner). Re-open only if the fee is ever enabled. | — | — |
| V5 | **Resolved 2026-11-22** (docs read at implementation). Square: `delay_duration` is valid for card-not-present payments from `PT1M` to below `P7D`, so `PT48H` fits; `delay_action` is `CANCEL` or `COMPLETE`; `Square-Version` pinned to `2026-11-18`. CompletePayment and CancelPayment are not documented as idempotent, so on a 4xx the adapter reads `GET /v2/payments/{id}` and treats the call as done when the payment already has the target status (owner-approved 2026-11-22). Cloudflare: `assets.run_worker_first` accepts an array; the `ratelimits` binding needs Wrangler ≥ 4.36.0 and allows only 10 s or 60 s periods (see §8.5); local check ran on Wrangler 4.166.0. | — | — |
| O1 | Square production `application_id`, `location_id`, access token (the same Square account the salon already uses?). | Live payments | Owner sets the secrets in Cloudflare. |
| O2 | Google Ads conversion action for the new `purchase` event. | Ads measurement | Owner-approved plan in `google-ads-reports`. |
| O3 | Email Routing destination for salon alerts. The owner will set up Cloudflare Email Routing before Task 23 (owner, 2026-11-22). | Alerts | Owner verifies the address in Cloudflare. |
| O4 | **Resolved 2026-11-23** (verification runs [45116299041](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45116299041) and [45116866123](https://github.com/perfectionbyriri/perfection-by-riri/actions/runs/45116866123)). `services-meta.json` holds the real Setmore ids for all 43 whitelisted services; each entry keeps its placeholder as `mock_id`, which mock mode reads through `metaForMock`. 17 live titles differ from the placeholder names ("Touch-Up Session", "Wispy Effect", "Refill 2 Week", "Wet Effect"); the owner confirmed the pairs on 2026-11-23 (`TITLE_ALIASES` in `worker/tools/setmore-verify/checks.js`). | — | — |

Owner-approved 2026-11-22: Turnstile + rate limiting, alerts by e-mail, `PT48H` authorization with immediate cancel, fee 0%.

Owner-approved 2026-11-22 (second reply): `MIN_LEAD_MINUTES=120`, `BOOKING_HORIZON_DAYS=56`, `MEGA Volume Wispy` hidden (43 of 44).

Owner decision 2026-11-22 (after the backend, Tasks 2–13): do **not** merge into `main` yet. Merging deploys through Workers Builds (`npx wrangler deploy` on `main`). The UI tasks continue on branch `claude/dazzling-shannon-7jkxc1`.

Calls I made (the owner can override): ~~`SLOT_STEP_MINUTES=15`~~ (removed 2026-11-23, Setmore's interval decides), mock slots on the real 5-minute grid, catalog TTL 10 min, slots TTL 30 s, customer scan cap 2,000, 15-minute reconciliation cron.

---

## 21. Left to the builder

Internal module boundaries beyond §4; exact log field names; CSS class names beyond those in DESIGN_SPEC; how the in-memory KV and Cache fakes are written.
