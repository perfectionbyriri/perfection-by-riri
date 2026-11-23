# Booking UI — Variant C "Monolith Cinema Ribbon" for Steps 1–4

Date: 2026-11-23 · Status: **draft for owner approval** · Source brief: the owner's plan "Дизайн-план редизайна `/book/` — Вариант C «Monolith Cinema Ribbon»" (2026-11-23, shared in chat; its screenshots live on another machine and were not available). Amends [DESIGN_SPEC.md](../../booking/DESIGN_SPEC.md) §3–§5 and [2026-11-23-booking-cinematic-finish-design.md](2026-11-23-booking-cinematic-finish-design.md) §3.1–§3.2.

## 1. Intent and why

The owner wants `/book/` to look better and be more convenient for clients. Today Steps 1–3 use a plain title on a flat background and a 340 px right-hand `Your booking` card that starts as three "Not chosen yet" lines, squeezing the service accordion and the calendar. Steps 4–5 already use the Cinematic Hero Scene (photo band + hairline column strip). Variant C brings Steps 1–3 into the same visual system so the whole flow reads as one editorial scene.

The owner chose **Variant C as written** over two alternatives (see §4).

## 2. Goals, non-goals, anti-goals

**Goals**
- One visual system across Steps 1–5: photo banner on top, hairline column strip, full-width working area, one bottom action bar.
- Remove the right-hand sidebar on desktop; the choices so far show in a 3-column "live selection ribbon" under the banner.
- More room for the accordion (2-column service grid) and the time list (Morning | Afternoon side by side).

**Non-goals**
- No change to API contracts (`/api/booking/catalog`, `/slots`, `/appointments`), Square, Turnstile, analytics events, CSP policy, or the Worker.
- No change to the step order, validation rules, error mapping, or the Step 5 layout.
- No new copy beyond the CTA labels in §5.5.

**Anti-goals (a failure even if it looks right)**
- A client on a phone loses the on-page Back button.
- Controls that do nothing (for example Edit buttons copied into the mobile summary sheet).
- More than one `<h1>`, or the `<h1>` removed from the accessibility tree.
- Rounded corners or shadows (`tests/booking/book-page.test.mjs` enforces `border-radius: 0` and `box-shadow: none`).

## 3. Constraints

- Fonts: self-hosted `Bodoni Moda` (`'opsz' 24`) and `Jost` only.
- Tokens already in `css/booking.css` (verified 2026-11-23): `--bk-bg #0c0c0b`, `--bk-bg-deep #080807`, `--bk-surface #141312`, `--bk-surface-inset #10100f`, `--bk-surface-active #221e19`, `--bk-ink #f4efe8`, `--bk-muted #a69e94`, `--bk-subtle #8f877c`, `--bk-gold #c6a471`, `--bk-gold-bright #dfc094`, `--bk-line rgba(212,187,150,.15)`, `--bk-line-strong rgba(212,187,150,.34)`, `--bk-gutter: max(5.9vw, calc((100vw - 1272px) / 2))`.
- Breakpoints already in use: `1050px`, `800px` (mobile; `801px` min for desktop rules), `540px`, `360px`.
- New uppercase label classes and serif display classes must be registered in `css/type-case.css`.
- Existing DOM hooks stay: `#bk-step`, `#bk-banner`, `#bk-status`, `#bk-alert`, `#bk-summary-list`, `[data-summary="service|time|deposit"]`, `#bk-bar`, `#bk-bar-summary`, `#bk-bar-action`, `#bk-sheet`, `#bk-sheet-list`, `.bk-progress` with 4 items, `data-action="back|continue"`, `data-goto-step`, `#bk-checkout`, `#bk-card`, `#bk-turnstile`.
- `primaryButton()` in `main.js` finds the step's own gold button; the mobile bar mirrors its label and disabled state through a `MutationObserver`. The new bottom bar must keep the primary button inside `#bk-step` so this keeps working.
- Exactly one `<h1>` and the `<noscript>` fallback (tests).

## 4. Approaches considered

1. **Variant C as written (chosen by the owner).** Banner with embedded progress, 3-column ribbon instead of the sidebar, full-width working area, one bottom bar. Biggest visual gain; convenience mostly unchanged.
2. **"Concierge":** Variant C's frame plus photo tiles for categories, "nearest available" quick picks and a compact mobile summary line. More convenient, more new behaviour. Not chosen.
3. **Single scrolling page** with collapsing sections. Fewer transitions, but long page, weaker Back, and a near rewrite of step state, analytics funnel and tests. Not chosen.

## 5. Design

### 5.1 Monolith hero (Steps 1–4)

`<header class="bk-head">` becomes the monolith hero:

- Full container width (`max-width: 1272px`), `min-height: 276px` desktop, `2px solid var(--bk-gold)` top rule, `1px solid var(--bk-line)` frame, photo `<img>` with the same dark editorial gradient as `.bk-cinema-hero`.
- Photo: `/images/booking/lash-tools.jpg` on Steps 1–3 (exists: 1536 × 1024, 152 KB, already the contact-page hero; reuse its alt `Precision lash tweezers resting in an organizer tray of extensions`, `width`/`height` attributes and `fetchpriority="high"`). On Step 4 the same hero swaps to the group photo from `heroPhotoFor(service)` in `js/booking/checkout.js` (brows, permanent makeup, lash lift, default lash).
- Left: eyebrow `Book online`, then the page `<h1 class="bk-title">Book your<br><em>appointment.</em></h1>` on Steps 1–3. **One title on all three steps** (owner decision 2026-11-23).
- On Step 4 the visible display line reads `Your appointment,<br><em>considered.</em>` with the kicker `Step 04 of 04 · Final review`; the `<h1>` stays in the DOM, visually hidden (as Step 4 does today).
- Right: caption `Personal by design.` / `Perfection in the details.` (hidden ≤ 800 px).
- The existing `<ol class="bk-progress">` sits **inside the bottom edge of the hero** behind a 1 px hairline, on Steps 1–4 (owner decision: inside the banner on Step 4 too).
- `.bk-step-count` stays for screen readers (visually hidden).
- `renderReview()` no longer renders its own `.bk-cinema-hero`; Step 4 starts with the 4-column `.bk-cinema-grid`. Step 5 is unchanged: its own `.bk-cinema-hero--confirm`, and the head stays visually hidden (not `display: none`).

### 5.2 Live selection ribbon (Steps 1–3, desktop and tablet)

`<aside class="bk-summary">` becomes `<aside class="bk-ribbon">` directly under the hero: three columns separated by `1px var(--bk-line)` hairlines, same grammar as `.bk-cinema-grid`.

| Column | Label | Title line | Sub line | Edit |
|---|---|---|---|---|
| 1 | `01 · Treatment` | service name, or `Not chosen yet` | `2 hr · $180.00` | on Steps 2–3 → step 1 |
| 2 | `02 · Date & time` | `Tuesday, December 29` (`&nbsp;` keeps month and day together), or `Not chosen yet` | `1:15 PM Pacific Time` | on Step 3 → step 2 |
| 3 | `03 · Due today` | `$50.00` / `$0.00` / `—` | `Deposit · balance at the studio` / `No deposit needed` | none |

- Keep `#bk-summary-list` with the three `[data-summary]` values so the sheet and existing tests keep their hooks; title and sub lines are separate elements inside each value.
- **Edit buttons live outside `#bk-summary-list`** (in each column head). Reason: the mobile sheet copies `#bk-summary-list` by `innerHTML`; Edit buttons inside it would be copied and would do nothing there (the click listener is on `#bk-step`). The ribbon needs its own click listener that calls `navigateFromProgress`.
- The ribbon is hidden on Steps 4 and 5 (Step 4 has its 4-column strip).
- The old desktop summary CTA (`#bk-summary-cta`, `#bk-summary-action`) and the `Times are in Pacific Time…` line are removed; the time zone already shows in column 2 and on Step 2.

### 5.3 Working area

`.bk-layout` is one full-width column on all steps.

- **Step 1:** accordion unchanged in behaviour and order (Lash Extensions, Permanent Makeup, Lash Lift, Brow Lamination & Tint) and sub-tabs unchanged (Full Sets, Wispy Full Sets, Refills, Wispy Refills, Removal; PMU: Initial Sessions, Touch-Ups). The existing `.bk-card-grid` wrapper becomes a 2-column grid on desktop and tablet (it is `flex-direction: column` today; CSS change only).
- **Step 2:** 7-day strip at full width with large Bodoni numerals; Morning and Afternoon side by side in two columns with a vertical hairline (`.bk-slots-split`); group titles add the chosen day (`Morning · Tuesday, Dec 29`). Slots are on the 15-minute grid Setmore returns (`slot_limit=15`).
- **Step 3:** 8 / 4 split (`.bk-details-split`): fields with bottom underline on the left (2 columns: first/last name, email/phone; notes full width), policy consent and privacy note on the right behind a hairline (`.bk-details-policy`).

### 5.4 Bottom action bar (Steps 1–4)

Each step's existing `.bk-actions` becomes `.bk-actions.bk-cinema-bar` (Step 4 already has it): left `Back` (Step 1: the text `Step 01 of 04`), centre the studio address, right the gold primary button. The primary button stays inside `#bk-step`.

### 5.5 CTA labels

Step 1 `Continue to date & time`, Step 2 `Continue to details`, Step 3 `Review & confirm`, Step 4 unchanged (`Pay $50.00 & book` / `Book appointment`). Disabled-state hints (`Choose a service to continue.`, `Choose a time to continue.`) stay.

### 5.6 Mobile (≤ 800 px)

- Hero `min-height: 168px`, title `30px`, caption hidden; progress shows step numbers only (`1. 2. 3. 4.`, existing ≤ 540 px rule).
- Ribbon hidden; the fixed `.bk-bar` (summary line + primary button) and `.bk-sheet` stay as today.
- In `.bk-cinema-bar` only the primary button and the address are hidden. **Back stays visible** on Steps 2–4 (the `.bk-bar` has no Back button). On Step 1 the whole bar is hidden.
- Accordion, slot columns and the form are one column; sub-tabs scroll sideways; ≤ 360 px the day strip scrolls with snap (`64px` per day, existing rule).
- The mobile bar label comes from the primary button text, so the longest label (`CONTINUE TO DATE & TIME`, 23 characters) must fit at 390 px.

### 5.7 Tablet (801–1050 px)

Ribbon kept with `20px` padding; service grid and slot columns keep 2 columns; the 8 / 4 form becomes one column with the policy block under the fields behind a top hairline.

### 5.8 Dropped from the brief

- "Set `.book-page .brand { color: var(--bk-ink) }` on mobile": not needed. The logo already renders `rgb(244, 239, 232)` (= `--bk-ink`) at 390 px; the dim logo in the brief's render was most likely the skip link drawn over it in a full-page capture.
- "Check `SEE YOU SOON` case on Step 5": the owner keeps the mixed case `See you soon, Anna.` (decision 2026-11-23); `.bk-step-title { text-transform: none }` stays.

## 6. Testing and verification

- Test-first updates in `tests/booking/book-page.test.mjs`, `ui-services.test.mjs`, `ui-slots.test.mjs`, `ui-details.test.mjs`, `ui-checkout.test.mjs`, keeping: one `<h1>`, 4 progress items, `<noscript>`, CSP checks, square corners, no shadows. New checks: ribbon hooks present, Edit buttons outside `#bk-summary-list`, `renderReview` has no own hero, Step 1–3 CTA labels, mobile rule keeps `[data-action="back"]` visible inside `.bk-cinema-bar`.
- Full suite (417 tests at `6f3eca8`) plus `node --check` on changed JS.
- Browser run (Playwright, `wrangler dev` mock mode) at 1440, 820 and 390 px through Steps 1–5 for a deposit and a no-deposit service: no console errors, no horizontal overflow, Edit and Back work, mobile Back visible on Steps 2–4, sheet has no Edit buttons.
- Push to `claude/dazzling-shannon-7jkxc1`, dispatch `site-ci.yml`, confirm the preview deployment; the owner checks the preview in a browser (it is behind Cloudflare Access).

## 7. Left to the builder

Exact spacing and type sizes not stated above, the gradient values (reuse `.bk-cinema-hero`), class names for new inner elements, the hero photo `object-position` for `lash-tools.jpg`, and how the ribbon reads the split title/sub values from state.
