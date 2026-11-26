# Google Ads Conversion and Meta Pixel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The booking confirmation view reports a paid booking to the existing Google Ads conversion (with enhanced conversions) and to Meta as `Schedule`, and every site page loads the Google Ads config and the Meta Pixel `PageView`.

**Architecture:** Plain browser JavaScript, no GTM. A new pure module `js/booking/ad-tags.js` builds and sends the ad calls; `fireConfirmation` in `js/booking/confirm.js` calls it under its existing once-per-booking guard. A first-party `js/meta-pixel.js` loads the pixel on every page; `js/analytics.js` adds the `AW-` config. The `/book/*` CSP gains only the Meta hosts.

**Tech Stack:** Vanilla JS (ES modules for the booking flow, classic scripts for site-wide files), `node --test`, Cloudflare static assets `_headers`, Playwright (pre-installed) for the browser check.

**Spec:** `docs/superpowers/specs/2026-11-26-ads-tracking-design.md`

## Global Constraints

- Google Ads tag ID `AW-16731910684`; conversion `send_to` `AW-16731910684/qZuaCNy3164dEJzksqo-`; `currency: 'USD'`; `transaction_id` = Setmore booking id.
- Meta Pixel (dataset) ID `1864195751687018`; events `PageView` (all pages) and `Schedule` (confirmation), `eventID` = booking id.
- Fire only when `isConversion(result)` is true, once per booking id (existing guard in `fireConfirmation`).
- Every ad call is wrapped in its own `try/catch`; no ad failure may stop another call, the `dataLayer` push, the `pbr:booking-confirmed` event, or the view.
- Email and phone go only to `gtag('set', 'user_data', …)`: never into `dataLayer`, the CustomEvent detail, Meta, storage or logs.
- No new inline scripts; the inline Google tag in `book/index.html` and its CSP hash stay byte-identical.
- No GTM, no Meta CAPI, no consent banner, no Meta advanced matching.
- Test command: `node --test tests/*.test.cjs tests/booking/*.test.mjs` (same as CI `site-ci.yml`).
- Work on `claude/dazzling-shannon-7jkxc1`; do not merge to `main` (merge deploys).

## Review Focus

- Phone typed as `(425) 845-0045`, `425.845.0045` or `+1 425 845 0045`: `phone_number` must be `+14258450045`; a 7-digit or non-US-length phone is omitted, not sent malformed. Test in Task 1.
- Email with spaces or capitals (`  Riri@Example.COM `): sent as `riri@example.com`; an email without `@` is omitted. Test in Task 1.
- `fbq` not loaded (ad blocker) or `gtag` throwing: Google conversion still fires when only Meta is missing and vice versa; `fireConfirmation` still returns `true` and pushes `dataLayer`. Test in Task 1.
- A reload of `/book/confirmed/?ref=…`: no conversion fires (that page never calls `fireConfirmation`). Test in Task 2.
- `deposit.status: 'none'` (no-deposit service): conversion and `Schedule` fire with `value: 0`. Test in Task 1.

---

### Task 1: Ad conversion calls on the confirmation view

**Files:**
- Create: `New Perfection/js/booking/ad-tags.js`
- Modify: `New Perfection/js/booking/confirm.js` (`fireConfirmation`, around lines 39–75)
- Modify: `New Perfection/js/booking/main.js` (the `fireConfirmation(result, {...})` call, around line 926)
- Test: `tests/booking/ad-tags.test.mjs` (new), `tests/booking/ui-confirm.test.mjs` (adjust)

**Interfaces:**
- Produces (in `ad-tags.js`):
  - `export const ADS_SEND_TO = 'AW-16731910684/qZuaCNy3164dEJzksqo-'`
  - `export function toE164(phone: string|undefined): string|null` — keep digits; 10 digits → `+1` + digits; 11 digits starting with `1` → `+` + digits; otherwise `null`.
  - `export function userData({ email, phone }): { email?: string, phone_number?: string } | null` — email trimmed + lowercased, kept only if it matches `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; phone via `toE164`; `null` when both are absent.
  - `export function sendAdConversions(detail, { gtag, fbq, contact }): void` — `detail` is the existing `fireConfirmation` detail object (`booking_id`, `value`, `currency`, `service_id`, …).
- Changes: `fireConfirmation(result, { gtag, fbq, dataLayer, dispatch, storage, contact })` — two new optional deps; calls `sendAdConversions(detail, { gtag, fbq, contact })` after the GA4 `purchase` call.

- [ ] **Step 1: Write the failing tests** in `tests/booking/ad-tags.test.mjs`:

```js
test('toE164 normalizes US numbers and rejects others', () => {
  assert.equal(toE164('(425) 845-0045'), '+14258450045');
  assert.equal(toE164('4258450045'), '+14258450045');
  assert.equal(toE164('+1 425 845 0045'), '+14258450045');
  assert.equal(toE164('845-0045'), null);
  assert.equal(toE164(''), null);
  assert.equal(toE164(undefined), null);
});

test('userData trims and lowercases email, drops invalid fields, null when empty', () => {
  assert.deepEqual(userData({ email: '  Riri@Example.COM ', phone: '4258450045' }), { email: 'riri@example.com', phone_number: '+14258450045' });
  assert.deepEqual(userData({ email: 'not-an-email', phone: '4258450045' }), { phone_number: '+14258450045' });
  assert.equal(userData({ email: '', phone: '123' }), null);
});

test('sendAdConversions sets user_data, then sends the Ads conversion, then Meta Schedule', () => {
  // detail = { booking_id: 'bk_123', value: 50, currency: 'USD', service_id: 'svc_lash_lift', ... }
  // expect gtag calls, in order:
  //   ['set', 'user_data', { email: 'a@b.co', phone_number: '+14258450045' }]
  //   ['event', 'conversion', { send_to: ADS_SEND_TO, value: 50, currency: 'USD', transaction_id: 'bk_123' }]
  // expect fbq calls:
  //   ['track', 'Schedule', { value: 50, currency: 'USD', content_ids: ['svc_lash_lift'] }, { eventID: 'bk_123' }]
});

test('no user_data call when contact is missing or invalid', () => { /* gtag gets only the conversion */ });

test('a throwing gtag does not stop Meta, and a missing fbq does not stop Google', () => { /* two cases */ });

test('Meta receives no email or phone', () => {
  // JSON.stringify(fbqCalls) contains neither the email nor the digits of the phone
});
```

- [ ] **Step 2: Adjust `tests/booking/ui-confirm.test.mjs`.** In `sinks()` add `fbqCalls` and `deps.fbq`, plus `deps.contact = { email: 'a@b.co', phone: '4258450045' }`. Change `'fires purchase and booking_confirmed once per booking id'` to expect, after the second call, `gtagCalls.length === 3` (`purchase`, `set user_data`, `conversion`) and `fbqCalls.length === 1`; keep the `purchase` deepEqual on `gtagCalls[0]`. Add:
  - `'pending_capture fires no Ads conversion and no Schedule'` — `fbqCalls.length === 0` and no `conversion` in `gtagCalls`.
  - `'a no-deposit booking sends conversion and Schedule with value 0'`.
  - `'dataLayer and the CustomEvent carry no email or phone'` — `JSON.stringify(sink.dataLayer)` and `JSON.stringify(sink.events[0].detail)` contain neither `a@b.co` nor `4258450045`.
  - `'a throwing fbq still returns true and pushes dataLayer'`.

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/booking/ad-tags.test.mjs tests/booking/ui-confirm.test.mjs`
Expected: FAIL (`ad-tags.js` missing; call counts differ).

- [ ] **Step 4: Implement** `ad-tags.js` per the Interfaces block (each of the three calls in its own `try/catch`; skip a call when its function is not a function), and wire it into `fireConfirmation`.

- [ ] **Step 5: Pass `fbq` and `contact` from `main.js`:**

```js
fbq: typeof window.fbq === 'function' ? window.fbq : undefined,
contact: { email: state.get().details.email, phone: state.get().details.phone },
```

- [ ] **Step 6: Run the full suite**

Run: `node --test tests/*.test.cjs tests/booking/*.test.mjs`
Expected: all PASS, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add "New Perfection/js/booking/ad-tags.js" "New Perfection/js/booking/confirm.js" "New Perfection/js/booking/main.js" tests/booking/ad-tags.test.mjs tests/booking/ui-confirm.test.mjs
git commit -m "feat(booking): send the Google Ads conversion and Meta Schedule on a paid booking"
```

---

### Task 2: Site-wide Google Ads config and Meta Pixel

**Files:**
- Create: `New Perfection/js/meta-pixel.js`
- Modify: `New Perfection/js/analytics.js`
- Modify (add one `<script src="…/js/meta-pixel.js" defer></script>` right after the `analytics.js` tag, same relative prefix): `index.html`, `contact/index.html`, `faq/index.html`, `book/index.html`, `book/confirmed/index.html`, `services/{brow-lamination-tint,lash-extensions,lash-lift,permanent-makeup}/index.html` (all under `New Perfection/`)
- Test: `tests/booking/ad-site-tags.test.mjs` (new)

**Interfaces:**
- Produces: `window.fbq` on every page that includes `meta-pixel.js` (Task 1 reads it); `gtag('config', 'AW-16731910684')` on every page that loads `analytics.js`.

- [ ] **Step 1: Write the failing tests** in `tests/booking/ad-site-tags.test.mjs`:
  - `'every page that loads analytics.js also loads meta-pixel.js, after it'` — find all `New Perfection/**/index.html` containing `js/analytics.js`; expect exactly 9; each contains `js/meta-pixel.js" defer` positioned after `analytics.js`.
  - `'meta-pixel.js inits dataset 1864195751687018 and tracks PageView once'` — source contains `'init', '1864195751687018'` and exactly one `'track', 'PageView'`, loads `https://connect.facebook.net/en_US/fbevents.js`, and contains no `Schedule`/`Purchase`.
  - `'analytics.js configures AW-16731910684 guarded by typeof window.gtag'`.
  - `'book/confirmed/ never calls fireConfirmation'` — `js/booking/confirmed.js` and `book/confirmed/index.html` do not contain `fireConfirmation`, `conversion` or `Schedule`.
  - `'the inline Google tag in book/index.html is unchanged'` — it still contains no `AW-` and no `fbq`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/booking/ad-site-tags.test.mjs`
Expected: FAIL (`meta-pixel.js` missing).

- [ ] **Step 3: Implement `meta-pixel.js`** as a classic script with the standard Meta base code (the `fbq` stub that queues calls and injects `fbevents.js` async), then `fbq('init', '1864195751687018'); fbq('track', 'PageView');`. No `<noscript>` image. Wrap in an IIFE; do nothing if `window.fbq` already exists.

- [ ] **Step 4: In `analytics.js`** add, at the top, `if (typeof window.gtag === 'function') window.gtag('config', 'AW-16731910684');` (inside `try/catch`).

- [ ] **Step 5: Add the script tag to the 9 pages.**

- [ ] **Step 6: Run the full suite**

Run: `node --test tests/*.test.cjs tests/booking/*.test.mjs`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add "New Perfection/js/meta-pixel.js" "New Perfection/js/analytics.js" "New Perfection"/*.html "New Perfection"/*/index.html "New Perfection"/*/*/index.html tests/booking/ad-site-tags.test.mjs
git commit -m "feat(site): load the Google Ads config and Meta Pixel PageView on every page"
```

---

### Task 3: CSP for the Meta Pixel on /book/*

**Files:**
- Modify: `New Perfection/_headers` (`/book/*` `Content-Security-Policy`)
- Test: `tests/booking/book-page.test.mjs` (extend the CSP tests near line 66)

- [ ] **Step 1: Failing test** `'CSP allows the Meta Pixel hosts and nothing broader'`: `script-src` includes `https://connect.facebook.net`; `img-src` and `connect-src` include `https://www.facebook.com`; no directive contains `*.facebook.com`, `'unsafe-inline'` in `script-src`, or `'unsafe-eval'`. The existing hash test must still pass unchanged.

- [ ] **Step 2: Run** `node --test tests/booking/book-page.test.mjs` → FAIL.

- [ ] **Step 3: Edit `_headers`**: append `https://connect.facebook.net` to `script-src`, `https://www.facebook.com` to `img-src` and `connect-src`. Nothing else.

- [ ] **Step 4: Run the full suite** → all PASS.

- [ ] **Step 5: Commit** `fix(booking): allow the Meta Pixel hosts in the /book/ CSP`.

---

### Task 4: Privacy text names Google Ads and the Meta Pixel

**Files:**
- Modify: the `privacy:` string in `New Perfection/js/{main,faq,contact,service-page}.js` (identical in all four)
- Test: `tests/booking/policy-text.test.mjs`

- [ ] **Step 1: Failing test** `'privacy names Google Ads conversion tracking and the Meta Pixel'`: `privacy.main` matches `/Google Ads/`, `/Meta Pixel/`, and `/hashed/` (enhanced conversions send the email and phone in hashed form). The existing "identical in all four" test keeps the copies in sync.

- [ ] **Step 2: Run** `node --test tests/booking/policy-text.test.mjs` → FAIL.

- [ ] **Step 3: Add one sentence** after the Google Analytics sentence, the same in all four files:

> Google Ads conversion tracking and the Meta Pixel measure visits and completed bookings for our advertising; when you book, your email address and phone number are sent to Google in hashed form to match the booking to an ad.

- [ ] **Step 4: Run the full suite** → all PASS.

- [ ] **Step 5: Commit** `docs(site): name Google Ads and the Meta Pixel in the privacy text`.

---

### Task 5: Browser check, CI, handoff

**Files:**
- Create: `tests/booking/helpers/ad-tags-browser-check.mjs` (manual script, not picked up by the `*.test.mjs` glob)

- [ ] **Step 1: Write the Playwright check.** Serve the site with the Worker in mock mode as earlier booking plans did: `cp .env.example .dev.vars` (mock flags are already `true` there), `npx wrangler dev`, and delete `.dev.vars` afterwards (it is git-ignored but must not be left behind). Route `https://www.googletagmanager.com/**` and `https://connect.facebook.net/**` to empty 200 scripts, and init `window.gtag`/`window.fbq` recorders via `addInitScript`. Run one full booking at 390×844, then assert: exactly one `['event','conversion',…]` with `send_to` `AW-16731910684/qZuaCNy3164dEJzksqo-`, one `['set','user_data',…]` before it, exactly one `['track','Schedule',…]` with `eventID` equal to the booking id, one `PageView`; no console errors; no CSP violations (`securitypolicyviolation` listener). Then reload `/book/confirmed/?ref=<id>` and assert no new `conversion` or `Schedule`.

- [ ] **Step 2: Run it**

Run: `node tests/booking/helpers/ad-tags-browser-check.mjs`
Expected: prints `ok` for every assertion, exit code 0.

- [ ] **Step 3: Full suite and syntax check**

Run: `node --test tests/*.test.cjs tests/booking/*.test.mjs && find "New Perfection" worker -name '*.js' -print0 | xargs -0 -n1 node --check`
Expected: 0 fail, no syntax errors.

- [ ] **Step 4: Commit, push, and run CI** (`site-ci.yml` via `workflow_dispatch` on the branch). Record the run ID.

- [ ] **Step 5: Report to the owner** using the four PR-template sections (What Changed / Assumptions / Evidence / Not Verified). Not verified until after deploy: live GA4 `purchase`, Google Ads tag status, Meta Events Manager `Schedule`, enhanced-conversion match. Those wait for the Task 23 live booking. After the owner merges, prepare the `project-context` update (`context/ads-analytics.md`) with PR, commit and run IDs only.
