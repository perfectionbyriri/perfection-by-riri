# Booking Cinematic Hero Scene (Step 4 & Step 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/book/` Step 4 (*Deposit & confirm*) and Step 5 (*Confirmed*) into the owner-approved **Cinematic Hero Scene** layout using only the site's native `Bodoni Moda` (`'opsz' 24`) and `Jost` fonts, studio photography, 4-column vertical-hairline strip, and a unified action bar.

**Architecture:** `renderReview` (`New Perfection/js/booking/checkout.js`) and `renderConfirmation` (`New Perfection/js/booking/confirm.js`) remain pure HTML-rendering functions tested in Node (`node:test`). `New Perfection/js/booking/main.js` sets `data-step` on `.bk-shell` / `.bk-layout` so CSS hides the duplicate right `.bk-summary` sidebar on Steps 4–5 and hides the wizard `.bk-head` on Step 5, while delegating `[data-goto-step]` clicks inside `#bk-step` to `goTo(stepNum)`.

**Tech Stack:** Vanilla ES modules (`New Perfection/js/booking/*.js`), Vanilla CSS (`New Perfection/css/booking.css`, `New Perfection/css/type-case.css`), Node.js built-in test runner (`node:test`).

**Spec:** `docs/superpowers/specs/2026-11-23-booking-cinematic-finish-design.md`

## Global Constraints

- Use only self-hosted `--serif` (`Bodoni Moda`, `'opsz' 24`) and `--sans` (`Jost`, `--price-font`).
- Maintain `border-radius: 0` and no `box-shadow` across `New Perfection/css/booking.css`.
- Register all new uppercase label and serif display classes in `New Perfection/css/type-case.css`.
- Never log or expose PII; keep all existing booking API, Square, Turnstile, `.ics`, and analytics contracts intact.

## Review Focus

1. Service object without a `photo` property (e.g., minimal unit-test fixtures) → falls back cleanly to `/images/hero/hero-lash.webp` and `object-position: 78% 42%` without throwing or rendering `undefined`.
2. Unescaped HTML special characters in `service.name`, `details.first_name`, `details.notes`, or `service.photo.alt` → escaped via `escapeHtml`.
3. Clicking an `Edit` button (`[data-goto-step="1|2|3"]`) inside Step 4 (`#bk-step`) → navigates back to the requested step (`goTo(stepNum)`) and unmounts Step 4 widgets cleanly.
4. No-deposit vs. deposit services on Step 4 → no-deposit shows `$0.00` and `"No deposit is needed for this service. You pay at the studio."` with no `#bk-card`; deposit service shows `<dl class="bk-quote">`, `#bk-card`, and `"Payment secured by Square."`.
5. Unified action bar on Step 4 → `Back` (`data-action="back"`) and `BOOK APPOINTMENT` / `PAY $50.00 & BOOK` (`.bk-pay`) sit inside the same `.bk-actions.bk-cinema-bar` container rather than rendering a second duplicate `Back` button below the form.

---

### Task 1: Cinematic Hero Scene markup in `renderReview` (Step 4)

**Files:**
- Modify: `New Perfection/js/booking/checkout.js:141-177`
- Test: `tests/booking/ui-checkout.test.mjs`

**Interfaces:**
- Produces: `renderReview({ service, details, timeLabel }) -> string` returning `.bk-cinema-hero`, `.bk-cinema-grid` (4 columns with `data-goto-step="1|2|3"` edit buttons), `.bk-cinema-payband`, and `.bk-actions.bk-cinema-bar` containing both `[data-action="back"]` and `.bk-pay`.

- [ ] **Step 1: Write failing tests in `tests/booking/ui-checkout.test.mjs`** asserting that `renderReview` renders `.bk-cinema-hero` (with `service.photo.src` or `/images/hero/hero-lash.webp` fallback), 4 `.bk-cinema-col` columns with `data-goto-step="1"`, `"2"`, `"3"`, service price formatted via `formatMoney(service.price_cents)`, and a single `.bk-cinema-bar` containing both `data-action="back"` and `.bk-pay`.
- [ ] **Step 2: Run `node --test tests/booking/ui-checkout.test.mjs` and watch it fail.**
- [ ] **Step 3: Implement the updated `renderReview` in `New Perfection/js/booking/checkout.js`.**
- [ ] **Step 4: Run `node --test tests/booking/ui-checkout.test.mjs` and verify all tests pass.**

---

### Task 2: Cinematic Hero Scene markup in `renderConfirmation` (Step 5)

**Files:**
- Modify: `New Perfection/js/booking/confirm.js:133-155`
- Test: `tests/booking/ui-confirm.test.mjs`

**Interfaces:**
- Produces: `renderConfirmation({ result, service, firstName, email, timeLabel, policyText }) -> string` returning `.bk-cinema-hero.bk-cinema-hero--confirm` (with hero image, `You’re booked`, `See you soon, <em>Name.</em>`, `data-action="add-to-calendar"` gold button, and `Directions` outline button) plus the 4-column `.bk-cinema-grid` strip (Treatment, Date & time, Studio location with `18205 Alderwood Mall Pkwy A, Suite 918`, and Questions/deposit status) and `.bk-cinema-policy`.

- [ ] **Step 1: Write failing tests in `tests/booking/ui-confirm.test.mjs`** asserting that `renderConfirmation` renders `.bk-cinema-hero--confirm`, uses `service.photo.src` when provided (and falls back to `/images/hero/hero-lash.webp`), includes `18205 Alderwood Mall Pkwy A, Suite 918`, and renders the 4-column `.bk-cinema-grid`.
- [ ] **Step 2: Run `node --test tests/booking/ui-confirm.test.mjs` and watch it fail.**
- [ ] **Step 3: Implement the updated `renderConfirmation` in `New Perfection/js/booking/confirm.js`.**
- [ ] **Step 4: Run `node --test tests/booking/ui-confirm.test.mjs` and verify all tests pass.**

---

### Task 3: Stage wiring in `main.js` and styling in `booking.css` & `type-case.css`

**Files:**
- Modify: `New Perfection/js/booking/main.js`
- Modify: `New Perfection/css/type-case.css`
- Modify: `New Perfection/css/booking.css`
- Test: `tests/booking/book-page.test.mjs`

**Interfaces:**
- Consumes: `renderReview` from `checkout.js`, `renderConfirmation` from `confirm.js`.
- Produces:
  - `main.js`: sets `elements.shell.dataset.step` / `elements.layout.dataset.step` on step transitions and confirmation; handles clicks on `[data-goto-step]` inside `elements.step`; removes the duplicate trailing `<div class="bk-actions"><button ... data-action="back">Back</button></div>` outside `renderReview` in `renderStep4`; passes `service` to `renderConfirmation` in `showBooked`.
  - `type-case.css`: registers `.bk-cinema-kicker`, `.bk-cinema-caption`, `.bk-cinema-col-label`, `.bk-cinema-edit`, `.bk-cinema-address` in the uppercase label list and `.bk-cinema-title`, `.bk-cinema-col-title`, `.bk-confirm-service` in the serif display heading list.
  - `booking.css`: styles `.bk-shell[data-step="4"]`, `.bk-shell[data-step="5"]`, `.bk-cinema-hero`, `.bk-cinema-grid`, `.bk-cinema-col`, `.bk-cinema-payband`, `.bk-cinema-bar` with square corners and no shadows.

- [ ] **Step 1: Write failing test in `tests/booking/book-page.test.mjs`** asserting that `type-case.css` includes the new `.bk-cinema-*` label and serif-display selectors and `booking.css` defines `.bk-cinema-hero`, `.bk-cinema-grid`, and `.bk-shell[data-step="5"] .bk-head` rules while keeping zero shadows and zero border-radius.
- [ ] **Step 2: Run `node --test tests/booking/book-page.test.mjs` and watch it fail.**
- [ ] **Step 3: Implement the changes in `New Perfection/js/booking/main.js`, `New Perfection/css/type-case.css`, and `New Perfection/css/booking.css`.**
- [ ] **Step 4: Run `node --test tests/booking/book-page.test.mjs` and verify all tests pass.**
- [ ] **Step 5: Run full test suite (`node --test tests/*.test.cjs tests/booking/*.test.mjs`), commit, push to `claude/dazzling-shannon-7jkxc1`, and dispatch `site-ci.yml`.**
