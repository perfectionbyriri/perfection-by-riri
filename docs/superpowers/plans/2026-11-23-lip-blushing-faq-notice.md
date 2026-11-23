# Lip Blushing FAQ Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients who pick Lip Blushing (or its Touch-Up) must read the owner's FAQ block and tick a confirmation before they can continue; the server enforces it and records it in the Setmore appointment note.

**Architecture:** A per-service `notice` flag in `worker/config/services-meta.json` flows through `catalog.js` to the client. The client shows an inline notice under the selected card and gates Continue on a stored `faqAcknowledged` flag. The booking request carries `faq_acknowledged`; `appointments.js` rejects flagged services without it and appends a confirmation line to the Setmore note.

**Tech Stack:** Plain JS ES modules (client in `New Perfection/js/booking/`, Cloudflare Worker in `worker/src/`), CSS tokens in `css/booking.css`, `node --test`, Playwright for the browser check.

**Spec:** `docs/superpowers/specs/2026-11-23-lip-blushing-faq-notice-design.md`

## Global Constraints

- Notice copy (draft, owner-approved wording): heading `Important before you book`; text `Please read our "Lip Blushing & Cold Sores" FAQ.`; link text `Read the FAQ`; checkbox label `I have read the FAQ and understand it applies to me.` No medical wording of my own anywhere.
- FAQ link: `/faq/#lip-blushing-cold-sores`, `target="_blank" rel="noopener"` (booking state is in memory).
- Flagged services: `svc_lip_blushing` and `svc_lip_blushing_touch_up` (the two `mock_id`s in `services-meta.json`); the meta value is `"notice": "lip-blushing-faq"`.
- Server field name `faq_acknowledged`; field error text `Please confirm you have read the FAQ.`
- Note line prefix: `Lip Blushing FAQ read and confirmed online:` followed by Pacific date and time.
- Booking policy checkbox, deposits, prices and other services stay unchanged.
- Branch `claude/dazzling-shannon-7jkxc1` only; never main; no PR unless asked. Light theme tokens (`--bk-*`) only, no hardcoded colors.

## Review Focus

1. A direct API call for Lip Blushing without `faq_acknowledged: true` is rejected; the same field sent for an unflagged service is ignored and the booking succeeds.
2. Changing the service clears the tick; choosing Lip Blushing again asks again. Going Back from Step 2 to Step 1 keeps the notice visible and the tick for the same service.
3. A deep link that preselects Lip Blushing lands on Step 1 with the notice shown and Continue blocked.
4. The mobile sticky bar mirrors the blocked Continue (it follows the in-step button).
5. A 500-character client note plus the added Setmore line still books (the line is appended after the client note by the server).
6. The FAQ anchor is not hidden under the sticky header.

---

### Task 1: Server: flag, rule and note line

**Files:**
- Modify: `worker/config/services-meta.json` (two entries)
- Modify: `worker/src/catalog.js:55-70` (validation) and the service object built near `:115-125`
- Modify: `worker/src/appointments.js:50-72` (input validation), `:82-89` (`bookingNotes`), `:205-215` (call site)
- Test: `tests/booking/catalog.test.mjs`, `tests/booking/appointments.test.mjs`

**Interfaces:**
- Produces: catalog service objects gain `notice: string | null`. `validateInput` result gains `faqAcknowledged: boolean`. `bookingNotes(clientNotes: string, deposit, paymentId: string, extraLine: string = ''): string`.

- [ ] **Step 1: Write the failing tests.** In `catalog.test.mjs`: `a service meta notice flows to the catalog service, others get null` (Lip Blushing → `'lip-blushing-faq'`, Classic → `null`) and `a non-string notice is invalid meta`. In `appointments.test.mjs`, following the file's existing fixtures: `Lip Blushing without faq_acknowledged is rejected with the field error` (assert `fields.faq_acknowledged === 'Please confirm you have read the FAQ.'` and no payment/Setmore call), `Lip Blushing with faq_acknowledged books and the Setmore note contains "Lip Blushing FAQ read and confirmed online:" and a YYYY-MM-DD date`, `an unflagged service ignores faq_acknowledged`, `a 500-char client note still books for a flagged service`.
- [ ] **Step 2: Run** `node --test tests/booking/catalog.test.mjs tests/booking/appointments.test.mjs`. Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement.** Add `"notice": "lip-blushing-faq"` to the two meta entries. In `catalog.js` validate `notice` as a non-empty string when present and expose `notice: entry.notice ?? null`. In `appointments.js` read `faq_acknowledged === true` into `faqAcknowledged`; after loading `service` (`catalog.getService`) return the `VALIDATION_FAILED` error with `fields.faq_acknowledged` when `service.notice` is set and it is false, before any payment or slot work; pass the confirmation line (built from `now()` in the service timezone, `YYYY-MM-DD h:mm AM/PM Pacific`) as `extraLine` appended after the system line in `bookingNotes`.
- [ ] **Step 4: Run** the same command plus `node --test tests/*.test.cjs tests/booking/*.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(booking): server enforces and records the Lip Blushing FAQ confirmation`.

### Task 2: Client: notice, gating, request, review line

**Files:**
- Modify: `New Perfection/js/booking/render-services.js` (`card` grid, new `renderNotice`), `state.js`, `main.js` (`selectService` ~`:285-318`, `renderStep1`, continue handler ~`:361`, notice checkbox handler), `checkout.js` (`buildAppointmentBody`, `:50-62`; error mapping `:100-116`; review markup), and the details form error display for the new field
- Create: none
- Test: `tests/booking/ui-services.test.mjs`, `tests/booking/ui-checkout.test.mjs`, `tests/booking/ui-mobile.test.mjs` (deep link)

**Interfaces:**
- Consumes: catalog service `notice` from Task 1.
- Produces: `renderNotice(service: {service_id, notice}, { visible: boolean, acknowledged: boolean }): string` in `render-services.js` (returns `''` when `service.notice` is null); `continueBlocked({ service, faqAcknowledged }): boolean` exported from `state.js` (true when the service has a notice and it is not acknowledged); state field `faqAcknowledged: boolean`, reset to `false` whenever `serviceId` changes; `buildAppointmentBody` adds `faq_acknowledged: boolean`.

- [ ] **Step 1: Write the failing tests.** `ui-services`: `renderNotice returns an empty string for a service without a notice`; `a flagged service renders the notice after its card with the heading, text, FAQ link (/faq/#lip-blushing-cold-sores, target _blank, rel noopener) and an unchecked checkbox`; `the notice has no medical wording` (rendered text contains none of `herpes`, `HSV`, `virus`); `the notice is hidden until its service is selected`. `state` tests (in `ui-mobile.test.mjs` or `ui-services.test.mjs`): `continueBlocked is true for a flagged service until acknowledged, false otherwise`; `stepFromHistory/deep link to Lip Blushing keeps Continue blocked`. `ui-checkout`: `buildAppointmentBody sends faq_acknowledged`; `a faq_acknowledged field error maps back to Step 1`.
- [ ] **Step 2: Run** `node --test tests/booking/ui-services.test.mjs tests/booking/ui-checkout.test.mjs tests/booking/ui-mobile.test.mjs`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.** `renderNotice` markup uses classes `bk-notice`, `bk-notice-title`, `bk-notice-link`, `bk-notice-check` and `data-notice-for="<service_id>"`; place it after the flagged card inside `.bk-card-grid` (a sibling, not inside the card button), `hidden` unless that service is selected. `selectService` toggles the notices' `hidden`, resets `faqAcknowledged` when the service changes, and sets the in-step Continue `disabled`/`aria-disabled` from `continueBlocked`. A change handler on the notice checkbox stores `faqAcknowledged` and re-enables Continue. The continue handler and `renderStep1` honour `continueBlocked`. `buildAppointmentBody` includes `faq_acknowledged`. A server `faq_acknowledged` field error returns the user to Step 1 with the notice error shown. The Step 4 review shows `Lip Blushing FAQ: confirmed` for flagged services.
- [ ] **Step 4: Run** the full command `node --test tests/*.test.cjs tests/booking/*.test.mjs`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(booking): Lip Blushing FAQ notice with required confirmation`.

### Task 3: FAQ anchor, notice styling, browser check, release to branch

**Files:**
- Modify: `New Perfection/faq/index.html:591` (add `id="lip-blushing-cold-sores"` to the `<h3 class="faq-subsection-title">` wrapper `div.faq-subsection`), the FAQ stylesheet for `scroll-margin-top`, `New Perfection/css/booking.css` (notice styles)
- Test: `tests/booking/booking-theme.test.mjs`, `tests/booking/book-page.test.mjs`

**Interfaces:**
- Consumes: classes from Task 2.

- [ ] **Step 1: Write the failing tests.** `faq has the lip-blushing-cold-sores anchor on the existing subsection`; `faq anchor has a scroll-margin-top`; in `booking-theme.test.mjs`: `the notice uses theme tokens only` (the `.bk-notice` rules contain no hex or rgba colors; they use `var(--bk-...)`) and `the notice spans the full grid row`.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** the anchor (no FAQ text changes), `scroll-margin-top` at least the header height, and the notice CSS: full-row (`grid-column: 1 / -1`), `--bk-surface` panel with a `--bk-gold` left rule, heading as the small caps label style used on the page, link as the existing text-link style, readable on the phone.
- [ ] **Step 4: Verify.** Full test command, then `wrangler dev` in mock mode (`cp .env.example .dev.vars`, delete it afterwards) with Playwright at 390 and 1280 px: select Lip Blushing, notice appears and Continue is disabled; tick, Continue works; switch service, notice gone; deep link `?service=` Lip Blushing; FAQ link target URL and that the heading is visible after anchor navigation. Read the screenshots.
- [ ] **Step 5: Commit, push, dispatch `site-ci.yml`** on the branch and report the run ID. Final report lists what was not verified (real Setmore note, Safari, real devices, preview deploy).
