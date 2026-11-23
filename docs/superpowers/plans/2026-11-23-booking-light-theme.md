# /book/ Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recolor `/book/` from obsidian black to the warm-white site palette without changing layout, markup, copy or behavior.

**Architecture:** All colors already flow through `--bk-*` tokens scoped to `.book-page` in `New Perfection/css/booking.css`. Swap the token values to light, add a local "dark island" token override for the photo banners (which keep a dark overlay with light text), add one token for gold used as text, and convert the roughly 25 hardcoded `rgba()`/hex values outside the token block. A contrast test reads the tokens from the CSS so the palette cannot regress.

**Tech Stack:** Plain CSS, `node --test` (ESM `.mjs`), Playwright (preinstalled) for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-23-booking-light-theme-design.md`

## Global Constraints

- Recolor only: no layout, markup, copy, JS or animation changes. Edits stay in `css/booking.css`, `book/index.html` (theme-color only) and tests.
- Everything scoped to `.book-page`; do not touch `css/styles.css` or other pages.
- Light values (spec table): `--bk-bg #f5f2ef`, `--bk-bg-deep #f5f2ef`, `--bk-surface #efebe7`, inset/hover/active `#e9e4de`/`#e6e0d9`/`#e0d9d0`, `--bk-ink #262620`, `--bk-muted #6d6a62`, `--bk-subtle #76726a`, `--bk-gold #b99a6d`, `--bk-error #8c2f23`, `<meta name="theme-color" content="#f5f2ef">`.
- Gold used as text uses a darker token (`--bk-gold-text`, start at `#8a6b3d`, adjust only to pass the contrast test).
- Contrast: 4.5:1 body text, 3:1 large text and UI borders.
- The top announcement strip stays dark; photo banners (`.bk-monolith`, Step 4–5 cinematic scene) keep a dark overlay with light text.
- Branch `claude/dazzling-shannon-7jkxc1` only; never main; no PR unless asked.

## Review Focus

1. Selected service card, focus rings and the active sub-tab are clearly visible on light (gold on ivory is faint).
2. Unavailable/disabled slots and days stay distinguishable from available ones.
3. Error summary, invalid field borders and error text read on light (`#8c2f23`).
4. Summary sheet, detail dialog and their backdrops look right over a light page.
5. Phone menu and sticky bar are light and nothing from the page shows through (z-index fix from `c25c933` stays).
6. Mock payment card and the photo banners keep legible text after the token swap.

## File structure

- Modify `New Perfection/css/booking.css` — tokens, dark island, hardcoded colors.
- Modify `New Perfection/book/index.html:15` — `theme-color`.
- Create `tests/booking/booking-theme.test.mjs` — contrast and light-theme assertions.

---

### Task 1: Contrast and theme test (fails first)

**Files:**
- Create: `tests/booking/booking-theme.test.mjs`

**Interfaces:**
- Produces: helpers inside the test file only: `tokens(block: string): Record<string,string>` (parses `--name: value;` declarations from the first `.book-page {…}` block and from a `.bk-dark-island` block), `contrast(hexA: string, hexB: string): number` (WCAG relative luminance ratio).

- [ ] **Step 1: Write the test file** with these tests, reading `css/booking.css` and `book/index.html` like `book-page.test.mjs` does:
  - `the page background and surfaces are light`: `--bk-bg`, `--bk-bg-deep`, `--bk-surface` each have relative luminance > 0.8; `--bk-ink` luminance < 0.1.
  - `body text and muted text pass AA on bg and surface`: `contrast(ink, bg)`, `contrast(ink, surface)` ≥ 7; `contrast(muted, bg)`, `contrast(muted, surface)`, `contrast(subtle, surface)` ≥ 4.5.
  - `gold text and error text pass AA on light`: `contrast(--bk-gold-text, bg)` and `contrast(--bk-gold-text, surface)` ≥ 4.5; `contrast(--error, surface)` ≥ 4.5.
  - `decorative gold stays the site gold`: assert `--bk-gold` is `#b99a6d` (hairlines and accent bars only, no contrast requirement).
  - `the dark island keeps light text`: in the `.bk-dark-island` block `--bk-ink` luminance > 0.8 and `contrast(--bk-ink, #0c0c0b)` ≥ 7; `.bk-monolith` and the cinematic hero selector are listed in that block's selector list.
  - `no old obsidian values remain outside the dark island`: the CSS has no `#0c0c0b`/`#080807`/`#141312`/`rgba(12, 12, 11` outside the island and the photo-overlay gradients.
  - `theme-color meta is the light background`: `book/index.html` contains `content="#f5f2ef"` for `theme-color`.
- [ ] **Step 2: Run** `node --test tests/booking/booking-theme.test.mjs`. Expected: FAIL (tokens still dark).
- [ ] **Step 3: Commit** `test(booking): light-theme contrast and token assertions`.

### Task 2: Swap tokens, dark island, header/footer/menu

**Files:**
- Modify: `New Perfection/css/booking.css:14-95` (token block and the `.book-page` header/footer/menu/dialog overrides), `:1-6` (header comment), `New Perfection/book/index.html:15`.

**Interfaces:**
- Consumes: Task 1 test.
- Produces: new token `--bk-gold-text`; selector list `.bk-monolith, .bk-cinema-hero` (plus any step-4/5 hero container found in the file) that re-declares `--bk-ink #f4efe8`, `--bk-muted #a69e94`, `--bk-subtle #8f877c`, `--bk-line`, `--bk-line-strong`, `--bk-gold #c6a471`, `--bk-gold-text #dfc094` for its subtree, in a block commented as the dark island. Define it with the comment name `.bk-dark-island` so the test finds it (use a grouped selector list ending in `.bk-dark-island`).

- [ ] **Step 1: Replace token values** in the `.book-page` block with the spec palette; `--bk-line` / `--bk-line-strong` become `rgba(38, 38, 32, .16)` / `rgba(38, 38, 32, .34)`; `--bk-error` becomes `#8c2f23`; keep `--bk-bg-announcement` dark.
- [ ] **Step 2: Add the dark-island block** immediately after the token block (values above).
- [ ] **Step 3: Light header, footer, phone menu, nav dropdown, menu toggle, detail dialog** use the tokens already (`var(--bk-bg-deep)`, `var(--bk-ink)`); fix only the hardcoded ones at `:40`, `:48`, `:52`, `:89` (menu toggle border `rgba(38, 38, 32, .32)`, dialog backdrop `rgba(20, 19, 18, .5)`). Update the file's header comment to describe the light palette.
- [ ] **Step 4: Set** `theme-color` to `#f5f2ef` in `book/index.html`.
- [ ] **Step 5: Run** `node --test tests/booking/booking-theme.test.mjs`. Expected: contrast tests PASS; "no old obsidian values" may still FAIL until Task 3.
- [ ] **Step 6: Commit** `feat(booking): light palette tokens and dark photo banners`.

### Task 3: Convert hardcoded colors and gold text

**Files:**
- Modify: `New Perfection/css/booking.css` at the lines listed (`:161`, `:393`, `:550`, `:606`, `:673`, `:924`, `:2154`, mock card `~:1727-1760`, and every `color: var(--bk-gold)` / `var(--bk-gold-bright)` used for text).

**Interfaces:**
- Consumes: `--bk-gold-text` from Task 2.

- [ ] **Step 1: Page background** `:161` radial gradient becomes a faint gold glow on ivory: `rgba(185, 154, 109, .10)` to `rgba(245, 242, 239, 0)`.
- [ ] **Step 2: Hairlines and fills** `:393`, `:673`, `:924` (gold 10–26%) become ink-based `rgba(38, 38, 32, …)` with the same alphas; `:550` fill `rgba(185, 154, 109, .14)`; `:606` `rgba(239, 235, 231, .8)`.
- [ ] **Step 3: Backdrops** `.bk-sheet::backdrop` `:2154` → `rgba(20, 19, 18, .5)`.
- [ ] **Step 4: Gold text**: every rule that sets `color` to `var(--bk-gold)` or `var(--bk-gold-bright)` on text (eyebrows, selected states, links, step labels) uses `var(--bk-gold-text)`; borders, hairlines and the 2px accent bars keep `var(--bk-gold)`. Selected card, focus ring and active sub-tab get a clearly visible treatment on light (Review Focus 1): `outline: 2px solid var(--bk-gold-text)` or border `var(--bk-gold-text)`.
- [ ] **Step 5: Mock payment card** (`.bk-mock-card*`) gets light surface/ink tokens, readable badge.
- [ ] **Step 6: Gold buttons** keep `color: #0b0b0a` on gold background (`:116,140,144,641,750,994,1004`); no change, verify only.
- [ ] **Step 7: Run** `node --test tests/*.test.cjs tests/booking/*.test.mjs`. Expected: all PASS, including the "no old obsidian values" test.
- [ ] **Step 8: Commit** `feat(booking): convert hardcoded colors and gold text for the light theme`.

### Task 4: Visual verification, push, CI

**Files:**
- Create (scratchpad, not committed): a Playwright script that starts from `wrangler dev` mock mode (`cp .env.example .dev.vars`, remove it after) and captures Steps 1–4, summary sheet and phone menu at 390×844 and 1280×900.

- [ ] **Step 1: Capture** the screenshots; read each one. Check Review Focus 1–6: selected card, disabled slots, error state (submit empty details form), sheet and dialog, phone menu, mock card, both photo banners.
- [ ] **Step 2: Fix** any dark leftovers or unreadable text in `booking.css` only; re-run the full test command from Task 3 Step 7. Expected: PASS.
- [ ] **Step 3: Update docs**: one line in `docs/booking/DESIGN_SPEC.md` (palette section) pointing to the light-theme spec.
- [ ] **Step 4: Push** to `claude/dazzling-shannon-7jkxc1`, dispatch `site-ci.yml` on the branch, report the run ID and conclusion.
- [ ] **Step 5: Final report** lists what was not verified: real Square widget, Safari/Firefox, real devices, preview Worker deploy status.
