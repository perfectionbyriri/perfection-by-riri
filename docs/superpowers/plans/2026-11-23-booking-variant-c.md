# Booking Variant C (Steps 1–4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/book/` Steps 1–3 into the Cinematic Hero Scene system: a monolith hero with embedded progress (also on Step 4), a 3-column live selection ribbon instead of the sidebar, full-width working areas and one bottom action bar.

**Architecture:** Static page `New Perfection/book/index.html` plus ES modules in `New Perfection/js/booking/`. Pure render helpers stay unit-tested with `node --test` string assertions; `main.js` (DOM wiring, no unit tests) is checked by source-level tests in `book-page.test.mjs` and a Playwright run. CSS lives in `css/booking.css`; uppercase classes are registered in `css/type-case.css`.

**Tech Stack:** Vanilla JS ES modules, CSS, Node 24 `node:test`, Playwright (pre-installed Chromium), `wrangler dev` mock mode for the browser run.

**Spec:** `docs/superpowers/specs/2026-11-23-booking-variant-c-design.md`

## Global Constraints

- Branch `claude/dazzling-shannon-7jkxc1` only; never push to `main` (production deploy).
- Fonts: `Bodoni Moda` (`'opsz' 24`) and `Jost` only; tokens from `css/booking.css` (`--bk-gold`, `--bk-line`, `--bk-gutter`, …), no new colours.
- `border-radius: 0` and `box-shadow: none` everywhere (test-enforced).
- Exactly one `<h1>` (`.bk-title`, text `Book your appointment.` with `<br><em>`), never `display: none`; 4 `.bk-progress-item`s; `<noscript>` kept.
- Keep hooks: `#bk-step`, `#bk-summary-list`, `[data-summary="service|time|deposit"]`, `#bk-bar*`, `#bk-sheet*`, `data-action="back|continue"`, `data-goto-step`, `#bk-checkout`, `#bk-card`, `#bk-turnstile`.
- The step's primary gold button stays inside `#bk-step` (`primaryButton()` and the mobile bar depend on it).
- Hero photo Steps 1–3: `/images/booking/lash-tools.jpg`, `width="1536" height="1024"`, alt `Precision lash tweezers resting in an organizer tray of extensions`. Step 4: `heroPhotoFor(service)` from `checkout.js`.
- Copy: hero caption `Personal by design.` / `Perfection in the details.`; Step 4 kicker `Step 04 of 04 · Final review`, display line `Your appointment,<br><em>considered.</em>`; address `18205 Alderwood Mall Pkwy A, Suite 918 · Lynnwood, WA 98037`; CTAs `Continue to date & time`, `Continue to details`, `Review & confirm`; Step 1 bar left text `Step 01 of 04`.
- Breakpoints: `1050px`, `800px` (mobile), `540px`, `360px`. If an inline `<script>` in `book/index.html` changes, update its hash in `New Perfection/_headers`.
- Test command: `node --test tests/*.test.cjs tests/booking/*.test.mjs` (417 pass at `6f3eca8`).

## Review Focus

1. Phone, Steps 2–4: the on-page Back button must stay visible and work (the `.bk-bar` has no Back).
2. Mobile summary sheet: must show the three values and no Edit buttons.
3. Going back from Step 4 to Step 2 via Edit, then forward again: hero photo and display line must return to the Step 1–3 version, then to the group photo on Step 4.
4. A service with no deposit: ribbon column 3 reads `$0.00` / `No deposit needed`, never `$50.00`.
5. Deep link `?service=…` (opens Step 2 directly): ribbon column 1 must already be filled and show Edit.

---

### Task 1: Ribbon values and action bar helpers

**Files:**
- Modify: `New Perfection/js/booking/state.js` (add `ribbonValues`)
- Create: `New Perfection/js/booking/action-bar.js`
- Test: `tests/booking/ui-mobile.test.mjs` (ribbon), `tests/booking/ui-action-bar.test.mjs` (new)

**Interfaces:**
- Produces: `ribbonValues({ service, week, startAt, startLabel }) -> { service: { title, sub }, time: { title, sub }, deposit: { title, sub } }` (plain text, unescaped; callers escape or use `textContent`).
- Produces: `STUDIO_ADDRESS_LINE` (string, the address copy above) and `renderActionBar({ step, primary, hint = '' }) -> string` returning `<div class="bk-actions bk-cinema-bar">…</div>`: left = `<button type="button" class="button button-outline" data-action="back">Back</button>` for steps 2–4, `<p class="bk-cinema-step">Step 01 of 04</p>` for step 1; centre = `<p class="bk-cinema-address">` + address; then `hint`; right = `primary` (HTML string, inserted as is).

- [ ] **Step 1: Write failing tests**

`ribbonValues` cases (service fixture: name `Hybrid Full Extension 2D-3D`, 120 min, 18000 cents, deposit required total 5000; week with day `2026-12-29` weekday `Tuesday`; startAt `2026-12-29T13:15:00-08:00`, startLabel `1:15 PM`):
- nothing chosen → service/time titles `Not chosen yet`, subs `''`; deposit title `—`, sub `''`.
- service only → service `{ title: 'Hybrid Full Extension 2D-3D', sub: '2 hr · $180.00' }`, deposit `{ title: '$50.00', sub: 'Deposit · balance at the studio' }`, time still `Not chosen yet`.
- no-deposit service → deposit `{ title: '$0.00', sub: 'No deposit needed' }`.
- service + slot → time `{ title: 'Tuesday, December 29', sub: '1:15 PM Pacific Time' }` (non-breaking space between month and day).
- slot whose day is missing from `week` → time title `Not chosen yet`.

`renderActionBar` cases: step 1 has `Step 01 of 04` and no `data-action="back"`; steps 2–4 have the Back button first; every step contains the address line and ends with the `primary` string; `hint` appears before `primary`.

- [ ] **Step 2: Run tests, expect FAIL** (`ribbonValues` / module not found)

Run: `node --test tests/booking/ui-mobile.test.mjs tests/booking/ui-action-bar.test.mjs`

- [ ] **Step 3: Implement both helpers.** Reuse `formatDuration` and `formatPrice`-style money (`formatMoney` from `checkout.js` gives `$180.00`); time title = `${day.weekday}, ` + month name and day from `toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })` with the space replaced by `\u00a0` (as `stepTimeLabel()` in `main.js` builds it).

- [ ] **Step 4: Run tests, expect PASS; run full suite**

- [ ] **Step 5: Commit** `feat(booking): ribbon values and shared action bar helpers`

---

### Task 2: Page markup — monolith hero and ribbon

**Files:**
- Modify: `New Perfection/book/index.html:82-118`
- Test: `tests/booking/book-page.test.mjs`

**Interfaces:**
- Produces DOM: `header.bk-head.bk-monolith` containing `img.bk-monolith-photo` (Steps 1–3 photo attrs from Global Constraints), `.bk-monolith-lead` with `p.bk-eyebrow` (`Book online`), `p.bk-monolith-kicker` (empty, hidden until Step 4), `h1.bk-title#bk-title`, `p.bk-monolith-display` (empty, `aria-hidden="true"`, used on Step 4), `p.bk-cinema-caption`, existing `#bk-step-count` and `ol.bk-progress` (in `.bk-monolith-progress`).
- Produces DOM: `aside.bk-ribbon[aria-labelledby="bk-ribbon-title"]` with visually hidden `h2#bk-ribbon-title` `Your booking`, three `.bk-ribbon-col` each with a head (`.bk-cinema-col-label` text `01 · Treatment` / `02 · Date & time` / `03 · Due today` and, for cols 1–2, `button.bk-cinema-edit[data-goto-step="1|2"][hidden]`), and `dl#bk-summary-list` whose rows keep `dd[data-summary]`, each `dd` holding `span.bk-ribbon-title` + `span.bk-ribbon-sub`.
- Removes: `aside.bk-summary`, `#bk-summary-cta`, `#bk-summary-action`, the `Times are in Pacific Time…` line.

- [ ] **Step 1: Write failing tests** in `book-page.test.mjs`: one `<h1>` whose text contains `Book your` and `<em>appointment.</em>`; hero `img` has `src="../images/booking/lash-tools.jpg"`, `width="1536"`, `height="1024"` and the alt; `.bk-progress` sits inside `header.bk-head`; `#bk-summary-list` contains the 3 `data-summary` values and **no** `bk-cinema-edit`; 2 Edit buttons exist in `.bk-ribbon` with `data-goto-step="1"` and `"2"`; no `bk-summary-cta`. Keep the existing progress, noscript, CSP-hash tests unchanged.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Edit `book/index.html`** to the structure above (no inline script changes, so no CSP hash change).
- [ ] **Step 4: Run full suite, expect PASS** (fix any test that read the old sidebar markup, keeping its intent)
- [ ] **Step 5: Commit** `feat(booking): monolith hero and live selection ribbon markup`

---

### Task 3: Wire hero, ribbon and action bars in `main.js`

**Files:**
- Modify: `New Perfection/js/booking/main.js` (elements map ~line 27, `updateSummary` ~146, `updateBar` ~167, `renderStep1` ~210, `step2Actions` ~337, `renderStep3` ~434, `renderStep4` ~612, step 5 ~686)
- Modify: `New Perfection/js/booking/checkout.js` (`renderReview` uses `renderActionBar`; drops its own `.bk-cinema-hero`)
- Test: `tests/booking/book-page.test.mjs` (source checks), `tests/booking/ui-checkout.test.mjs`

**Interfaces:**
- Consumes: `ribbonValues`, `renderActionBar`, `STUDIO_ADDRESS_LINE` (Task 1), DOM from Task 2, `heroPhotoFor` (`checkout.js`).
- Produces: `setHero(step, service)` in `main.js` — Steps 1–3: Steps 1–3 photo, kicker and display line emptied and hidden, `h1` visible; Step 4: `heroPhotoFor(service)` src/alt/`object-position`, kicker `Step 04 of 04 · Final review`, display line shown, `h1` visually hidden (existing Step 4 rule). Called from `updateProgress`.

- [ ] **Step 1: Write failing tests**
  - `ui-checkout.test.mjs`: `renderReview` output has **no** `bk-cinema-hero` and no `bk-cinema-photo`; still has `bk-cinema-grid`, the three Edit buttons, and `renderActionBar` markup (Back first, address, `.bk-pay` last). Update the two existing hero assertions in that file (hero photo, `Your appointment, considered.`) to the new expectations; keep the per-group photo test by moving it to `heroPhotoFor` directly (`heroPhotoFor({ group: 'brows' }).src === '/images/hero/brow-hero.webp'`, etc.).
  - `book-page.test.mjs` source checks on `main.js`: contains `ribbonValues(`; contains `renderActionBar({ step: 1`, `{ step: 2`, `{ step: 3`; CTA strings `Continue to date &amp; time`, `Continue to details`, `Review &amp; confirm`; no `summaryCta`/`summaryAction`; the ribbon has its own click listener calling `navigateFromProgress`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement.**
  - `updateSummary()`: write `title`/`sub` from `ribbonValues` into each `dd` via `textContent`; Edit col 1 visible on steps 2–3, col 2 on step 3; ribbon hidden on steps 4–5 (`hidden` or the `data-step` CSS from Task 5).
  - Sheet: when opening, copy `#bk-summary-list` as today (it has no Edit buttons now).
  - Remove the desktop summary CTA code paths.
  - Steps 1–3 actions via `renderActionBar` with the CTA labels; hints unchanged (`Choose a service to continue.`, `Choose a time to continue.`).
  - `setHero` as in Interfaces; Step 5 path unchanged.
- [ ] **Step 4: Run full suite, expect PASS**
- [ ] **Step 5: Commit** `feat(booking): wire hero, ribbon and unified action bar`

---

### Task 4: Step 2 split slots and Step 3 split form

**Files:**
- Modify: `New Perfection/js/booking/render-slots.js:49-79`, `New Perfection/js/booking/render-details.js:39-55`
- Test: `tests/booking/ui-slots.test.mjs`, `tests/booking/ui-details.test.mjs`

**Interfaces:**
- Produces: slots wrapper `<div class="bk-slots bk-slots-split">`; group titles `Morning · Tuesday, Dec 29` / `Afternoon · Tuesday, Dec 29` (weekday full, month short, day number).
- Produces: details form `<form class="bk-form bk-details-split" id="bk-details">` with `.bk-details-fields` (error slot, the 4 fields, notes) and `.bk-details-policy` (consent field and privacy line).

- [ ] **Step 1: Write failing tests**: selected day `2026-12-29` (Tuesday) renders `bk-slots-split` and both titles above; form contains `bk-details-split`, and `bk-consent` + `bk-privacy` appear inside `.bk-details-policy` after `.bk-details-fields`. Existing tests (field order, errors, Morning/Afternoon grouping) stay green.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** in both renderers; field ids, names and error markup unchanged.
- [ ] **Step 4: Run full suite, expect PASS**
- [ ] **Step 5: Commit** `feat(booking): split Morning/Afternoon slots and 8/4 details form`

---

### Task 5: Styles and type registration

**Files:**
- Modify: `New Perfection/css/booking.css`, `New Perfection/css/type-case.css`
- Test: `tests/booking/book-page.test.mjs`, `tests/booking/ui-mobile.test.mjs`

**Interfaces:**
- Consumes: class names from Tasks 1–4.

- [ ] **Step 1: Write failing tests**
  - `type-case.css` Labels list includes `.bk-ribbon-sub`, `.bk-cinema-step`, `.bk-monolith-kicker`; Serif list includes `.bk-monolith-display`, `.bk-ribbon-title`.
  - `booking.css`: has `.bk-monolith` with `min-height: 276px`; `.bk-layout` is `grid-template-columns: minmax(0, 1fr)` for all steps; `.bk-card-grid` uses `grid-template-columns: repeat(2, minmax(0, 1fr))` outside the 800 px query; inside `@media (max-width: 800px)` there is a rule hiding `.bk-ribbon` and a rule hiding `.bk-cinema-bar .bk-cinema-address` and `.bk-cinema-bar .button-gold`, and **no** rule that hides `.bk-cinema-bar` itself or `[data-action="back"]`; the Step 1 bar (`.bk-shell[data-step="1"] .bk-cinema-bar`) is hidden on mobile.
  - Existing square-corner / no-shadow / safe-area tests stay.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** hero (reuse `.bk-cinema-hero` gradient and gold top rule), ribbon (reuse `.bk-cinema-grid` hairlines; `20px` padding at ≤ 1050 px), 2-column card grid, slot split with vertical hairline, 8/4 details split (1 column ≤ 1050 px with top hairline on the policy), underline inputs, mobile rules (hero `min-height: 168px`, title `30px`, caption hidden, ribbon hidden, bar keeps Back), remove dead `.bk-summary*` desktop rules that no longer match markup (keep `.bk-summary-list` rules the sheet uses).
- [ ] **Step 4: Run full suite, expect PASS**
- [ ] **Step 5: Commit** `feat(booking): Variant C styles`

---

### Task 6: Browser verification, docs, CI

**Files:**
- Modify: `docs/booking/DESIGN_SPEC.md` (pointer to the Variant C spec in §3–§5), `docs/superpowers/specs/2026-11-23-booking-variant-c-design.md` (status → implemented, with commits)

- [ ] **Step 1: Run Playwright through Steps 1–5** with `wrangler dev` mock mode (copy of the repo in the scratchpad, `.dev.vars` from `.env.example`) for `Lip Blushing` (deposit) and `Eyebrow Shaping` (no deposit) at 1440, 820 and 390 px. Expected: 0 console errors, `scrollWidth === clientWidth`, Edit from Step 4 to Step 2 and back works, hero photo/text switch correctly (Review Focus 3), Back visible on phone Steps 2–4, sheet has no `.bk-cinema-edit`, deep link `/book/?service=<id>` shows column 1 filled. Save screenshots of each step at 1440 and 390 px.
- [ ] **Step 2: Fix anything found** (each fix test-first in the owning task's test file) and rerun Step 1.
- [ ] **Step 3: Update docs** as listed; run full suite.
- [ ] **Step 4: Commit and push**; dispatch `site-ci.yml` on the branch; record the run ID; confirm the preview deployment time via `GET /accounts/2dd5ff6f68f776082417f16d8c8a300d/workers/scripts/perfection-by-riri-preview/deployments`.
- [ ] **Step 5: Report** to the owner in Russian with screenshots, the CI run ID, and what was not verified (preview behind Access, real devices, live Square).
