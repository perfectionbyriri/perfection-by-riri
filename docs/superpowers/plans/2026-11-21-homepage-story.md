# Homepage Story & Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sentence-case typography site-wide and a seven-chapter storytelling homepage with scroll-linked motion and no scroll hijacking.

**Architecture:** Static HTML/CSS/vanilla JS. Pinned chapters use native `position: sticky`; a small `js/story.js` writes a `--p` (0–1) custom property on active pinned sections, and CSS derives all motion from it. Entry reveals reuse the existing `main.js` reveal system.

**Tech Stack:** HTML, CSS custom properties, vanilla JS, `node:test` for pure logic, Playwright (local Chromium) for rendered checks.

**Spec:** `docs/superpowers/specs/2026-11-21-homepage-story-design.md`

## Global Constraints

- No new dependencies, no build step, no smooth-scroll library, no wheel/touch interception, no scroll snapping on the homepage.
- Animate only `transform`, `opacity`, `clip-path`. CLS must stay 0; no horizontal scroll at 390 px.
- Hero image never armed to `opacity: 0`.
- Reduced motion or no JS: every chapter renders as normal flow, fully visible.
- Preserve anchors `#home`, `#about`, `#services`, `#gallery`, `#reviews`, every `data-booking-url`, `data-results` buttons, review carousel controls, skip link.
- No new facts, numbers, prices or promises; wordmark untouched.
- Uppercase only for nav, buttons/CTAs, eyebrows/labels, footer headings, price labels, announcement, letter-spaced Jost titles, serif `h1`/`h2`.
- Only branch `claude/gracious-hypatia-lwsw0n` may be pushed; both steps ship as one draft PR with one commit series per step (deviation from the spec's "one PR per step", forced by the single permitted branch).

## Review Focus

1. Reduced motion → pinned chapters are plain flow, all words lit, nothing waits for scroll. (Task 4 check `reduced-motion`.)
2. JS blocked → every chapter visible after first paint. (Task 4 check `no-js`.)
3. Tab into an off-screen services panel → page scrolls so the focused panel is visible. (Task 3 check `services-focus`.)
4. Resize across 1024 px → services switch between horizontal track and vertical stack with no horizontal page scroll. (Task 3 check `services-resize`.)
5. Arriving via `index.html#services` / `#about` from another page → chapter start is in view, header does not cover the heading. (Task 4 check `anchors`.)

---

### Task 1: Site-wide sentence case

**Files:**
- Modify: `New Perfection/css/styles.css`, `css/service-pages.css`, `css/faq.css`, `css/contact.css`, `css/lash-extensions.css`, `css/lash-lift.css`
- Modify (only where running text is typed in literal caps): page HTML
- Test: scratchpad `checks/case.cjs` (Playwright, all 7 pages, desktop + mobile)

- [ ] **Step 1: Write the check.** For each page, assert computed `text-transform`:
  `uppercase` for `.main-navigation a`, `.nav-trigger`, `.button`, `.eyebrow`, footer headings, `h1`, `h2`;
  `none` for `p` inside `main` except elements whose class matches `eyebrow|label|tag|kicker|price`, `blockquote`, FAQ question/answer elements, footer `address`.
  Also assert no visible text node in running text is fully uppercase in HTML source when ≥ 4 words (catches literal caps).
- [ ] **Step 2: Run, expect FAIL** (`body` is uppercase today).
- [ ] **Step 3: Implement.** Drop `text-transform:uppercase` from `body` and the native-controls rule; add explicit uppercase to label classes that relied on inheritance; reset caps-only `letter-spacing` on running text to ≤ .01em; add type tokens `--fs-display`, `--fs-h2`, `--fs-h3`, `--fs-lead`, `--fs-body`, `--fs-label` and `--measure: 68ch` in `:root`.
- [ ] **Step 4: Run check, expect PASS; take after-screenshots; compare visually with baseline** (every page, both widths): no label lost its caps, no running text still in caps.
- [ ] **Step 5: Commit** `style: sentence case for running text site-wide`.

### Task 2: Story progress engine

**Files:**
- Create: `New Perfection/js/story.js`
- Create: `tests/story.test.cjs`
- Modify: `.github/workflows/site-ci.yml` (run `node --test tests/`)

**Interfaces:**
- Produces: `window.PerfectionStory = { progress(top, height, viewport) }` — returns clamped `0…1`, where `0` = section top at viewport top and `1` = section bottom at viewport bottom; `height <= viewport` returns `0` when `top > 0`, `1` when `top < 0`.
- Produces: sections marked `[data-story-pin]` get `--p` written each frame while intersecting; `html.story-on` is set when motion is allowed (not reduced) so CSS can scope pinning to it.

- [ ] **Step 1: Write tests** in `tests/story.test.cjs` (vm pattern of `pmu-results.test.cjs`): `progress(0, 2000, 800) === 0`; `progress(-600, 2000, 800) === 0.5`; `progress(-1200, 2000, 800) === 1`; `progress(-5000, 2000, 800) === 1`; `progress(300, 2000, 800) === 0`; reduced motion → `story-on` not added and no scroll listener registered.
- [ ] **Step 2: Run** `node --test tests/story.test.cjs` → FAIL (file missing).
- [ ] **Step 3: Implement** `story.js`: IntersectionObserver tracks active pins; one passive `scroll` + `resize` listener schedules one rAF that writes `--p` with `style.setProperty`; word-splitting for `[data-story-words]` (wraps words in `span.w`, sets `--i` index and `--n` count on the container).
- [ ] **Step 4: Run tests → PASS; run** `node --check` on the file.
- [ ] **Step 5: Commit** `feat: scroll progress engine for pinned homepage chapters`.

### Task 3: Homepage chapters

**Files:**
- Modify: `New Perfection/index.html`, `New Perfection/css/styles.css` (new `/* Homepage story */` block), `New Perfection/js/main.js` (reveal targets list, hero arming)
- Test: scratchpad `checks/home.cjs`

**Interfaces:**
- Consumes: `[data-story-pin]`, `--p`, `[data-story-words]`, `html.story-on` from Task 2.

- [ ] **Step 1: Write checks:** anchors exist; booking links keep `data-booking-url`; four `data-results` buttons open the dialog; review next/pause work; `services-focus` (desktop: Tab to 4th Explore link → its panel's bounding box is inside viewport); `services-resize` (1440 → 900 → 1440, `scrollWidth <= innerWidth` each time); CLS 0; hero image computed opacity is `1` at first paint.
- [ ] **Step 2: Run → FAIL** on hero opacity and on missing chapter structure.
- [ ] **Step 3: Implement** chapters per spec table: prologue with trust line (remove `.trust-strip` and `.experience-grid`); Philosophy pinned section with the quote in `[data-story-words]`; About pinned portrait with clip-path reveal driven by `--p`; Services horizontal track on `min-width:1024px` (`translateX(calc(var(--p) * -1 * (track width − viewport)))`, section height = track width) and vertical stack below; Results with four different photos; Reviews in sentence-case italic with Google 5.0 in the left column and a progress line; Finale with the hero photo as dim background. Hero animates scale only. Focus handler on track links scrolls window to the progress of that panel.
- [ ] **Step 4: Run checks → PASS; screenshot desktop + mobile; review each chapter visually.**
- [ ] **Step 5: Commit** `feat: storytelling homepage chapters`.

### Task 4: Resilience checks and draft PR

**Files:**
- Test: scratchpad `checks/resilience.cjs`

- [ ] **Step 1: Write checks:** `reduced-motion` (emulate reduce: no `story-on`, all `.w` opacity 1, pinned sections not sticky); `no-js` (JS disabled: every chapter heading visible after load); `anchors` (open `services/lash-lift/` then click nav `#services`/`#about` → heading top ≥ header bottom and < viewport height); console errors none.
- [ ] **Step 2: Run → fix anything failing → PASS.**
- [ ] **Step 3: Run CI-equivalent locally:** `node --check` all JS, `node --test tests/`.
- [ ] **Step 4: Push; open draft PR** using the four template sections with before/after screenshots and the not-verified list (real-domain LCP, real iPhone Safari, Setmore widget).
