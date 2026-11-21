# Homepage Story & Typography — Design

Date: 2026-11-21 · Status: awaiting owner approval · Scope: steps 1–2 of the approved audit plan

## Intent

The owner wants perfectionbyriri.com to look and feel like a premium, hand-crafted studio site
("a $20,000 site"), with beautiful motion and a storytelling homepage. The design audit (private
artifact, 2026-11-21) found a strong base (own photography, coherent ivory/graphite/gold palette,
Cormorant + Jost, clean accessible code, CLS 0) held back by three things: all-caps body text,
a homepage built from equal-rhythm stock blocks, and motion limited to a one-time entry reveal.

Owner decisions (2026-11-21):

1. Capitalisation: "do what's best" → designer's call (below).
2. Scroll-linked motion on the homepage: approved, without scroll hijacking.
3. Start with typography + homepage (audit steps 1–2); decide on the rest afterwards.
4. Copy: replace wording only when the new text is clearer and better for the client; otherwise keep it.
   No new facts, numbers, prices or promises.

## Goals

- Body text that reads calmly: sentence case for paragraphs, quotes, descriptions, FAQ answers.
- A homepage that reads as one story of a visit, in seven chapters, using existing copy, photos and videos.
- Motion that feels expensive: masked headline reveals, words lighting up as you read, a pinned
  portrait, a horizontal services scene on desktop, gentle image settling. Every effect serves the story.
- Keep everything that works today: booking links, analytics, review carousel with pause, results
  dialogs, service deep links, skip link, reduced-motion support, CLS 0, no horizontal scroll.

## Non-goals (this round)

- Service pages, FAQ and Contact layouts (they receive only the site-wide typography change).
- Page-to-page transitions, header hide/show, grain texture (audit step 3).
- Before/after drag slider (the before/after photos are single combined images; cutting them is separate work).
- Image recompression, `styles.css` mojibake in comments (separate small task).

## Anti-goals (failure even if it "works")

- Any scroll hijacking: wheel/touch interception, smooth-scroll libraries, scroll snapping on the homepage.
- Content that stays hidden if JS fails or is slow; a hero image that starts at `opacity: 0`.
- Booking becoming harder to reach at any scroll position.
- New claims, numbers or prices; changing the wordmark (PR #13 restored the original — keep it).
- Gimmicks: custom cursors, glitter, bouncing, autoplaying sound, effects on every element.
- Layout shift (CLS must stay 0) or horizontal page scroll at 390 px.

## Constraints

- Static site, vanilla HTML/CSS/JS, no build step; served from `New Perfection/` by Cloudflare.
- CI (`site-checks`) runs `node --check` on every JS file and `tests/pmu-results.test.cjs`.
- `styles.css` is shared by every page, so the typography step is site-wide.
- Cross-page anchors must keep working: `index.html#home`, `#about`, `#services`, `#gallery`, `#reviews`.
- Respect `prefers-reduced-motion: reduce` and the existing `html.motion-armed` + 2 s fallback pattern.
- GitHub-only workflow: branch → PR → owner review; one PR per step.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | GSAP 3 + ScrollTrigger + SplitText, vendored, homepage only | Industry standard, robust pinning; ~50 KB gzip (estimate) and a third-party dependency for choreography this page does not need |
| B | Pure CSS scroll-driven animations (`animation-timeline: view()`) | Zero JS; not shipped in Firefox and only recent Safari, so many visitors would get a degraded page |
| **C** | **Native `position: sticky` scenes + one small scroll-progress script writing CSS custom properties; reveals via the existing IntersectionObserver/WAAPI system** | **Chosen.** Zero dependencies, works in all browsers, the browser moves the page (no hijacking — lesson of PR #21/#22), extends the motion system already in `main.js`. Costs: we hand-write the progress math (small) |

The owner handed the "how" to the designer; C is the designer's call.

## Step 1 — Typography (site-wide, PR 1)

**Rule:** uppercase only for short labels; sentence case for anything people read.

- Remove `text-transform: uppercase` from `body` and from the native-controls rule in `styles.css`.
- Keep uppercase explicitly (per class) on: main navigation and dropdown labels, buttons and CTAs,
  `.eyebrow` and all eyebrow-like labels, trust labels, footer headings, price labels, announcement bar,
  card/section titles that are letter-spaced Jost labels (e.g. `.signature-name`, `.result-title`),
  and serif display headings `h1`/`h2` (the brand's editorial voice).
- Sentence case (no transform) for: paragraphs, leads, `.signature-note`, `.result-note`, review
  quotes, review disclaimers, footer text and addresses, FAQ questions and answers, dialog body text,
  form text. Remove caps-only letter-spacing from these (tracking ≤ 0.01em on running text).
- Check every page's own stylesheet (`service-pages.css`, `faq.css`, `contact.css`, `lash-*.css`)
  so nothing that relied on the inherited uppercase now renders lowercase by accident, and fix
  HTML text that is literally typed in caps where it becomes running text.
- Body copy measure ≤ ~68ch; a small type-scale token set in `:root` (display / h2 / h3 / lead /
  body / label) used by the homepage; service pages keep their sizes this round.

## Step 2 — Homepage story (PR 2)

Seven chapters, top to bottom. IDs in brackets are preserved anchors.

| Chapter | Content (existing unless noted) | Motion | Pinned |
|---|---|---|---|
| Prologue `#home` | Current hero photo, H1, lead, two CTAs. The trust strip becomes one quiet line under the CTAs: "Google 5.0 client reviews · 10+ years European experience · English, Русский, Українська" (all already stated on the page) | Photo visible at first paint, settles 1.06 → 1 scale; H1 lines rise from masks; light parallax of photo vs text on scroll | no |
| Philosophy | Riri's line from About: "Beauty isn't about becoming someone else. It's about being seen more clearly as yourself." on dark ground | Words light up as the chapter is scrolled (rest state: readable at ~0.3 opacity, never 0) | yes, ~1 viewport |
| The artist `#about` | About portrait + the three About paragraphs (sentence case); optional muted loop from existing process videos | Portrait reveals from a narrow vertical slit (clip-path) and stays put while paragraphs scroll past and fade in one by one | yes (desktop); natural flow on mobile |
| Services `#services` | The four services (photo, name, note, Explore link) | Desktop ≥ 1024 px: vertical scroll drives a horizontal track of four full-height panels. Mobile: vertical stack of large cards | desktop only |
| Results `#gallery` | Four different before/after photos from the existing folders (not the ones used in Services); "View results" dialogs and Instagram link stay | Cards rise in a cascade; image settles from a soft scale | no |
| Voices `#reviews` | Same four Google reviews, sentence-case Cormorant italic quote, small-caps name; left column carries "Google 5.0" and the Google link instead of empty space | Existing carousel; crossfade per slide; thin progress line shows time to next slide; pause stays | no |
| Finale `#booking` | "Ready for your transformation?", support line, gold button; hero photo returns as a dim background (bookend) | Photo fades up from dark; button follows the cursor slightly on fine pointers | no |

Removed: the four-item "experience" grid (Premium quality / Thoughtful artistry / …). It repeats
the services copy without adding information. **Designer's call — owner to confirm.**

Copy: H1 "Enhance Your Natural Beauty." stays (clear, matches search intent). All other copy is
reused verbatim or shortened only where clearer; no new facts.

### Motion system

- One `js/story.js` (homepage only, deferred) owns pinned chapters: for each `[data-story-pin]`
  section, an IntersectionObserver marks it active; a single passive scroll listener + rAF writes
  `--p` (0…1 progress) on active sections only. CSS derives transforms/opacity/clip-path from `--p`.
- Entry reveals keep using the existing `main.js` reveal language and tokens (`--ease-reveal`, tiers);
  new targets join that system instead of a second one.
- Only `transform`, `opacity`, `clip-path` animate. No layout properties.
- Reduced motion or no JS: pinned sections render as normal flow, words fully lit, everything visible.
- Hero image is never armed to `opacity: 0` (fixes the audit's LCP risk); it animates scale only.
- Booking stays one tap away: header CTA remains visible throughout.
- Keyboard: when focus moves to a services panel that is off-screen in the horizontal track, the page
  scrolls to the progress where that panel is fully visible; tab order follows visual order.

### Designer's calls the owner should check while reading

1. Removing the "experience" grid (see above).
2. Trust strip → one line; the "Lasting style / Signature quality" item is dropped (it states no fact).
3. Languages written in their own scripts ("English, Русский, Українська") — a signal to
   Russian- and Ukrainian-speaking clients; the About text already says she works in all three.
4. H1 kept as is.

## Verification (both PRs)

- Before/after screenshots, desktop 1440 and iPhone 13, every page (step 1) / homepage (step 2).
- Reduced-motion screenshots of the homepage; JS-disabled render.
- Scripted checks: CLS = 0, no horizontal scroll at 390 px, no console errors, all anchors resolve,
  every booking link still has `data-booking-url`, results dialogs and review carousel still work.
- CI `site-checks` green.
- Not verifiable before merge: real-domain LCP (PageSpeed after deploy), real iPhone Safari feel.

## Left to the builder

Exact durations within the existing token tiers, panel widths, which four result photos (pick by
visual check, all from existing folders), breakpoint fine-tuning, CSS organisation inside
`styles.css` (homepage section may move to its own block).
