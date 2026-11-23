# /book/ light theme: design (short)

Date: 2026-11-23 · Branch: `claude/dazzling-shannon-7jkxc1` · Status: awaiting owner approval

## Intent and why

The owner finds the obsidian-black /book/ unpleasant for the eyes and wants the same warm-white look as the service pages (see the Lash Extensions style list and grey panel). /book/ is a long form and payment flow, so readability matters most. It also removes the jump from the light site into a black page.

## Decision

Approach 1 of 3, chosen by the owner: **recolor only.** Layout, components, copy, animations and behavior stay exactly as they are.

Other approaches considered: (2) recolor plus rebuilding Step 1 as a list with a grey panel; (3) two-column rebuild of every step. Not chosen: more work for little extra benefit.

## Goals

- /book/ looks light: ivory page, grey panels, dark ink text, same serif/sans type.
- Text keeps WCAG AA contrast (4.5:1 body, 3:1 large text and UI borders), checked by a script, not by eye.
- One source of truth stays: the `--bk-*` tokens in `css/booking.css`.

## Non-goals and anti-goals

- No layout, markup, copy or JS changes beyond colors. No Step 1 redesign.
- No change to other pages or to shared `styles.css`; everything stays scoped to `.book-page`.
- Not a production release: stays on this branch and the preview Worker.
- Anti-goal: a half-converted page with dark leftovers or unreadable gold text on white.

## Palette (reuses the site tokens in `styles.css`)

| Token | Dark now | Light |
|---|---|---|
| `--bk-bg` | `#0c0c0b` | `#f5f2ef` (`--ivory`) |
| `--bk-bg-deep` (header, footer, menu sheet) | `#080807` | `#f5f2ef` |
| `--bk-surface` (grey panels, cards) | `#141312` | `#efebe7` (`--card`) |
| `--bk-surface-inset`, hover, active | dark steps | `#e9e4de`, `#e6e0d9`, `#e0d9d0` |
| `--bk-ink` | `#f4efe8` | `#262620` (`--ink`) |
| `--bk-muted`, `--bk-subtle` | greys | `#6d6a62`, `#76726a` |
| `--bk-line`, `--bk-line-strong` | gold at 15%/34% | ink at ~16%/34% |
| `--bk-gold` (hairlines, decoration) | `#c6a471` | `#b99a6d` (`--gold`) |
| gold used as **text** | `#c6a471` | darker `#8a6b3d`, value fixed by the contrast script |
| `--bk-error` | `#eb8f82` | `#8c2f23` |

## My calls (please check these)

1. **Photo banner stays dark.** The "Book your appointment" banner (and the Step 4–5 cinematic scene) keep their dark photo overlay with light text, like the dark hero bands on the service pages. Everything below and around them is light. Making the photo itself light would hurt legibility.
2. **Header, footer and phone menu become light** (ivory, ink text), as on the rest of the site. The thin top announcement strip stays dark, as on the site.
3. **Hardcoded dark colors** (about 40 `rgba(...)` and hex values outside the tokens, the dialog backdrop, the sticky bar, the mock payment card) are converted to tokens or to light equivalents.
4. `<meta name="theme-color">` changes from `#0b0b0a` to `#f5f2ef`.
5. The real Square card form (live payments, not mock) takes its styles from the page; if it needs separate light styling, I will treat that as a finding and report it, not guess.

## Verification (done means evidence)

- Contrast script over the final token pairs, results kept in the PR text/commit.
- Playwright screenshots of Steps 1–4, the summary sheet and the phone menu at 390 px and 1280 px, checked for unreadable text and dark leftovers.
- `node --test tests/*.test.cjs tests/booking/*.test.mjs` and CI `site-ci.yml`.
- Not verifiable here: real Square widget, Safari/Firefox, real devices.

## Left to the builder

Exact hex steps for hover/active states, and which of the roughly 40 hardcoded colors map to which token.
