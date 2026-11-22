# Booking UI — Design Spec

Status: **approved by the owner 2026-11-22** (amended: no card fee by default) · Companion to [ARCHITECTURE.md](ARCHITECTURE.md).

This spec defines how the white-label booking flow at `/book/` looks and behaves. Every token, font and photo below is taken from the site source in `New Perfection/`. Nothing here introduces a new visual language. The only new token is an error colour; the site has none today.

Client-facing language: **English**. Studio time zone: **America/Los_Angeles**.

---

## 1. Intent

The booking flow must feel like the rest of perfectionbyriri.com: ivory pages, Bodoni Moda display type, Jost interface type, square-edged gold buttons, and real studio photography. Right now every "Book appointment" button sends the client to `perfectionbyriri1.setmore.com`. That handoff is abrupt, looks different from the site, and leaves the studio domain. The new flow keeps the client on `perfectionbyriri.com/book/`, works first on a phone, and ends on a confirmation page that the studio controls. Analytics and the Google Ads conversion fire from that page.

Anti-goals (a failure even if it "works"):

- A flow that looks like a generic SaaS widget (rounded pills, drop shadows, blue links, emoji).
- Showing a price, duration or service that Setmore does not confirm.
- Showing a slot in the visitor's device time zone without saying so.
- Losing the client's typed details when a slot is taken.

---

## 2. Design tokens (from `New Perfection/css/styles.css`)

Reuse the existing custom properties. Do not copy their values into new names.

### 2.1 Colour

| Token | Value | Use in booking UI |
|---|---|---|
| `--ivory` | `#f5f2ef` | Page background |
| `--card` | `#efebe7` | Summary panel, selected-day background, skeleton fill |
| `--ink` | `#262620` | Body text, headings, selected-slot border |
| `--dark` | `#141413` | Dark closing band, text on gold buttons |
| `--gold` | `#b99a6d` | Accent lines and rules **on dark only** (6.94:1 on `--dark`) |
| `--muted` | `#6d6a62` | Secondary text, field underlines, unavailable-day labels |
| `--line` | `#d2cbc3` | Decorative dividers only (not control boundaries) |
| `.button-gold` bg | `#ad8c60` (hover `#987949`) | Primary action (`Continue`, `Pay deposit & book`) |
| `.button-outline` border | `#aaa197` (hover bg `#e7e0d8`) | Secondary action (`Back`, time-slot buttons) |
| focus ring | `#8a6c44`, 2px, offset 5px (2px inside dense grids) | All focusable controls |
| **new** `--error` | `#8c2f23` | Field errors, conflict banner rule |

Measured contrast (WCAG 2.x relative luminance, computed 2026-11-22):

| Pair | Ratio | Verdict |
|---|---|---|
| `--ink` on `--ivory` | 13.64 | AA/AAA text |
| `--muted` on `--ivory` | 4.84 | AA body text |
| `--muted` on `--card` | 4.55 | AA body text |
| `--dark` on `#ad8c60` | 5.88 | AA text on primary button |
| `--error` on `--ivory` | 7.40 | AA text |
| `--gold` on `--ivory` | **2.38** | **Never use gold for text or control borders on light backgrounds** |
| `--line` on `--ivory` | **1.44** | **Decorative only; fails 3:1 for control boundaries** |
| `#aaa197` on `--ivory` | **2.28** | Outline buttons need their text label to carry meaning; slot buttons switch to `--ink` border when selected |

Form-field underlines use `--muted` (4.84:1) so they meet the 3:1 non-text contrast rule.

### 2.2 Typography

Fonts are self-hosted from `New Perfection/images/branding/` with existing `@font-face` rules in `styles.css`:

- `--serif`: Bodoni Moda (normal + italic, 400–900). Use for step titles, the service name on a card, and the confirmation headline.
- `--sans`: Jost (100–900). Use for everything else.
- `--price-font` / `--price-weight: 300` / `--price-numeric: tabular-nums lining-nums`. Use for every price and the deposit total.

Scale (reuse existing tokens):

| Role | Token / value | Case |
|---|---|---|
| Page title (`Book your appointment`) | `--fs-h2` `clamp(36px,4.2vw,60px)`, serif 400, line-height 1.06, letter-spacing −1.1px | Uppercase via `type-case.css` serif-display rule |
| Step title (`Choose a service`) | `--fs-h3` `clamp(22px,2vw,28px)`, serif 400 | Sentence case |
| Service name on card | 22px serif 400 | Sentence case, as named in Setmore unless `display_name` overrides |
| Body / descriptions | `--fs-body` 16px Jost 400, line-height 1.6 | Sentence case |
| Labels, eyebrows, buttons | 11–12px Jost 500, letter-spacing 1.1–1.7px | Uppercase; add new classes to the label list in `css/type-case.css` |
| Price | 16px Jost 300, tabular | — |
| Fine print (policy, fee note) | 13px Jost 400, `--muted` | Sentence case |

New label classes (`.bk-eyebrow`, `.bk-step-count`, `.bk-field-label`, `.bk-day-name`, `.bk-summary-label`) must be added to the label list in `css/type-case.css`. Text defaults to sentence case.

### 2.3 Spacing, layout and breakpoints

- Page width `--page-width: 1272px`. Side gutter is the service-page gutter `--le-gutter: max(5.9vw, calc((100vw - 1272px) / 2))`.
- Spacing steps used across the site: 8, 12, 16, 20, 25, 30, 40, 64px. Booking UI uses only these.
- Breakpoints already in the codebase: `1050px`, `800px`, `540px`, `360px`. Booking layout switches from two columns to one at `800px`.
- Touch targets: at least 44×44px. Primary buttons keep the site's `min-height: 54px`.
- Corners: `border-radius: 0` everywhere. No shadows. Separation comes from `--card` fills and 1px rules.
- Motion: reuse `css/motion.css` easing. Every transition sits behind `prefers-reduced-motion: no-preference`.

### 2.4 Buttons

Reuse `.button`, `.button-gold`, `.button-outline`, `.button-small` unchanged.

- Primary: `.button.button-gold`, full width under 800px.
- Secondary: `.button.button-outline`.
- Disabled: the site's `button:disabled { opacity:.35 }`. A disabled primary button also gets `aria-disabled="true"` plus a visible hint saying why (for example, "Choose a time to continue").

---

## 3. Page structure

New page: `New Perfection/book/index.html`. It uses the same announcement bar, header, footer and `css/styles.css` + `css/type-case.css` as other pages, plus a new `css/booking.css` and `js/booking.js`. There is no hero photo; the flow starts above the fold.

```
┌───────────────────────────────────────────────────────────────┐
│ ANNOUNCEMENT · LASH · BROW · PERMANENT MAKEUP                 │
│ PERFECTION BY RIRI            Services  FAQ  Contact  [BOOK]  │
├───────────────────────────────────────────────────────────────┤
│ BOOK ONLINE                                                   │
│ BOOK YOUR APPOINTMENT                                         │
│ Step 2 of 4 — Date & time                                     │
│ ───────────────── ●───●───○───○                               │
│                                                    ┌────────┐ │
│  [ step content ]                                  │SUMMARY │ │
│                                                    │service │ │
│                                                    │date    │ │
│                                                    │deposit │ │
│                                                    └────────┘ │
├───────────────────────────────────────────────────────────────┤
│ footer (existing)                                             │
└───────────────────────────────────────────────────────────────┘
```

- Desktop (≥801px): two columns, step content `minmax(0,1fr)` + summary `340px`, gap 64px. The summary is `position: sticky; top: 24px`.
- Mobile (≤800px): one column. The summary collapses into a **sticky bottom bar** (see §5).
- Deep link: `/book/?service=<service_id>` opens at step 2 with that service selected. Every existing "Book appointment" CTA moves to `/book/`. A service page CTA links with its own `service` parameter where a single service is unambiguous; otherwise it links to `/book/?group=<group key>`.

---

## 4. Steps

### Step 1 — Choose a service

Services are grouped by `group` from `services-meta.json` (§6), in `order`. Each group has an eyebrow label and a horizontal rule.

Service card:

```
┌──────────────────────────┐
│                          │
│     photo, 4:5 frame     │   object-fit: cover; object-position: focal
│                          │
├──────────────────────────┤
│ Classic full set         │   serif 22px
│ Soft & understated       │   Jost 14px --muted (meta blurb, optional)
│ 2 hr · $165              │   Jost 300 tabular
│ $50 deposit to book      │   13px --muted (only when a deposit applies)
└──────────────────────────┘
```

- Grid: 3 columns ≥1050px, 2 columns 541–1049px, 1 column ≤540px with a 3:2 photo frame instead of 4:5, so more cards fit per scroll.
- The whole card is one `<button>` with `aria-pressed`. Selected state: 1px `--ink` outline inset plus a gold 2px top rule. No background change, because the photo carries the card.
- Photos load with `loading="lazy"`, `decoding="async"` and explicit `width`/`height`. The first row uses `fetchpriority="high"`.
- Duration and price come from the BFF catalog (Setmore). They are never typed into HTML or meta.
- Price label: `$165`. The deposit line reads `$50 deposit to book` and does not mention the fee; the fee appears at step 4, where the total is shown.

### Step 2 — Date & time

```
 Pacific Time (Lynnwood, WA)                 ‹  Nov 23 – Nov 29  ›
 ┌────┬────┬────┬────┬────┬────┬────┐
 │SUN │MON │TUE │WED │THU │FRI │SAT │   day name: label style
 │ 23 │ 24 │ 25 │ 26 │ 27 │ 28 │ 29 │   date: serif 22px
 │ —  │ 6  │ 4  │ 0  │ 3  │ 5  │ 2  │   "n times" 12px --muted
 └────┴────┴────┴────┴────┴────┴────┘
 MORNING
 [10:00 AM] [10:30 AM] [11:00 AM]
 AFTERNOON
 [12:30 PM] [1:00 PM] [2:30 PM] [3:00 PM]
```

- One request loads a **7-day window**. This matches the Setmore v2 slot-range limit (see ARCHITECTURE §6). The arrows move one week. The back arrow is disabled on the current studio week, and the forward arrow is disabled past `BOOKING_HORIZON_DAYS`.
- Days with zero slots and closed days (Sunday) are shown but disabled, with `--muted` text and `aria-disabled="true"`.
- Default selected day: the first day in the window that has a slot.
- Slot buttons: `.button.button-outline.button-small`, min-width 104px, in a wrapping flex row with gap 12px. Selected: `--ink` 1px border, `--card` fill, and `aria-pressed="true"`.
- Times are always rendered in **America/Los_Angeles**, formatted `h:mm AM`. If the device time zone differs, a one-line note appears under the strip: "Times are shown in Pacific Time."
- Loading: a skeleton row in `--card`, with `aria-busy="true"` on the region and an `aria-live="polite"` status ("Loading available times…").
- Empty week: "No openings this week." plus a `Next week ›` text button and the phone fallback.

### Step 3 — Your details

Fields (all required except Notes):

| Field | Input | Validation (client mirrors server) |
|---|---|---|
| First name | `text`, `autocomplete="given-name"` | 1–60 chars |
| Last name | `text`, `autocomplete="family-name"` | 1–60 chars |
| Email | `email`, `autocomplete="email"` | RFC-lite pattern, ≤254 chars |
| Mobile phone | `tel`, `autocomplete="tel-national"`, `inputmode="tel"` | US 10 digits after stripping; shown as `(425) 845 0045` |
| Notes for Riri (optional) | `textarea`, 3 rows | ≤500 chars |
| Policy consent | checkbox | Must be checked |

Field style (site principle: "no boxes, no shadows"):

```
FIRST NAME                     ← label: Jost 12px 500, 1.1px tracking, uppercase
Anna                           ← input: Jost 16px, transparent background
──────────────────────────     ← 1px --muted underline; 2px --ink on focus
Please enter your first name.  ← --error 13px, shown after blur or submit
```

- Errors are linked with `aria-describedby`. On submit with errors, focus moves to the first invalid field, and a summary appears at the top of the step.
- Consent label text (verbatim policy from the studio's Setmore page, see ARCHITECTURE §11): "I agree to the booking policy: Cancellations made on the same day as your appointment will result in the forfeiture of your $50 deposit. The deposit is non-refundable for same-day cancellations."
- Under the form, in fine print: "We use these details only to manage your appointment." The text links to the updated Privacy Policy.

### Step 4 — Deposit & confirm

```
 REVIEW
 Classic full set · 2 hr
 Thursday, November 27 · 1:00 PM Pacific Time
 Anna Smith · anna@… · (425) …

 Deposit                         $50.00
 ──────────────────────────────────────
 Due today                       $50.00
 Remaining balance is paid at the studio.

 CARD
 [ Square card field ]
 [ PAY $50.00 & BOOK ]           ← .button-gold, full width on mobile
 Payment secured by Square.
```

- All amounts come from the BFF quote in the catalog response. The UI never calculates money. The card fee is **0% by default** (owner decision 2026-11-22), so no fee line is shown. A `Card processing fee (x%)` line appears only if the server quote has `fee_cents > 0` (`CARD_FEE_BASIS_POINTS` above 0).
- The Square Web Payments SDK card field is styled through its `style` option: Jost (system fallback inside the iframe), 16px, `--ink` text, `--muted` placeholder, `--error` invalid colour, and an `--ivory`-matched background.
- Services without a deposit (`deposit: "none"` in meta, for example Lash Removal at $30) skip the card block. The button reads `BOOK APPOINTMENT`.
- While submitting: the button shows "Booking…" and `aria-busy`, and every step control is locked. A second submit is ignored (the idempotency key stays the same, see ARCHITECTURE §8).

### Step 5 — Confirmed

```
 YOU'RE BOOKED
 See you soon, Anna.                     ← serif --fs-h2, italic accent like site H2s
 Classic full set
 Thursday, November 27 · 1:00 PM Pacific Time
 Perfection by Riri · Lynnwood, WA  [Directions]
 Deposit paid $50.00 · Receipt from Square sent to anna@…
 [ ADD TO CALENDAR ]  (.ics, generated client-side)
 Need to change or cancel? Call (425) 845 0045.
 Booking policy (verbatim)
```

The page URL becomes `/book/confirmed/?ref=<booking id>` (history `replaceState`, no new server page). Analytics fire here, once (ARCHITECTURE §10).

---

## 5. Mobile flow (≤800px)

1. Step 1 shows a full-width card list. Tapping a card selects it and advances to step 2 automatically after 250ms (instantly with reduced motion).
2. A **sticky bottom bar** appears once a service is selected:

```
┌─────────────────────────────────────┐
│ Classic full set · Thu 27, 1:00 PM  │  13px, one line, ellipsis
│ [ CONTINUE ]                        │  .button-gold, full width, 54px
└─────────────────────────────────────┘
```

   - Height 54px + 12px padding + `env(safe-area-inset-bottom)`. Background `--ivory`, with a 1px `--line` top rule.
   - Tapping the summary line opens the full summary as a bottom sheet (`<dialog>`, focus-trapped, `Esc` and a close button).
3. Step 2's week strip scrolls horizontally with `scroll-snap-type: x mandatory` when the 7 columns do not fit (≤360px).
4. Step 3's inputs use the correct mobile keyboards (`inputmode`) and autofill. The bar's `CONTINUE` submits the form.
5. Step 4's Square card field is full width. The pay button lives in the sticky bar.
6. The browser back button moves one step back (each step pushes `history.state`). It never drops form data.

---

## 6. `services-meta.json`

Location: `worker/config/services-meta.json`. The Worker imports it at build time, so changing it requires a PR. The BFF merges it with the live Setmore catalog.

Purpose: a **whitelist**, plus presentation data. Setmore stays the source of truth for name, price, duration and existence. The meta file never holds price or duration.

### 6.1 Format (version 1)

```json
{
  "version": 1,
  "groups": [
    {
      "key": "lash-extensions",
      "label": "Lash extensions",
      "order": 10,
      "photo": {
        "src": "/images/Lash%20Extensions/lash-extensions-classic.webp",
        "width": 1536,
        "height": 1024,
        "alt": "Close-up of soft classic lash extensions",
        "focal": "50% 45%"
      }
    }
  ],
  "services": [
    {
      "service_id": "<Setmore v2 service id>",
      "group": "lash-extensions",
      "order": 10,
      "display_name": "Classic full set",
      "blurb": "Soft & understated",
      "photo": null,
      "deposit": "standard"
    }
  ]
}
```

### 6.2 Field rules

| Field | Required | Rule |
|---|---|---|
| `version` | yes | Integer. The BFF rejects unknown major versions at startup. |
| `groups[].key` | yes | kebab-case, unique. Also used as the `/book/?group=` value. |
| `groups[].label` | yes | Sentence case, ≤40 chars. |
| `groups[].order` | yes | Integer, ascending. |
| `groups[].photo` | yes | Fallback photo for every service in the group. |
| `photo.src` | yes | Root-relative URL to an existing file under `New Perfection/images/`, percent-encoded (the CI resource check must pass). |
| `photo.width` / `photo.height` | yes | Intrinsic pixels, used for `width`/`height` attributes. |
| `photo.alt` | yes | Describes the image, ≤120 chars. |
| `photo.focal` | no | CSS `object-position`, default `50% 50%`. |
| `services[].service_id` | yes | Setmore v2 service `id` (the v1 API called it `key`). Unique. |
| `services[].group` | yes | Must match a `groups[].key`. |
| `services[].order` | yes | Order within its group. |
| `services[].display_name` | no | Overrides the Setmore name for display only. If omitted, the Setmore name is shown. |
| `services[].blurb` | no | ≤60 chars, sentence case. |
| `services[].photo` | no | `null` or a photo object. `null` falls back to the group photo. |
| `services[].deposit` | yes | `"standard"` (deposit + fee) or `"none"`. |

Merge behaviour (implemented in the BFF, see ARCHITECTURE §5):

- A Setmore service that is **not** in meta is **hidden** (whitelist).
- A meta entry whose `service_id` is missing in Setmore is skipped and logged as `meta_service_missing`. It is never shown.
- If the Setmore price is at or below the deposit amount, the service is treated as `deposit: "none"`, whatever meta says, and `deposit_meta_overridden` is logged.

### 6.3 Initial group photos (canonical files)

These are chosen from files the live pages already reference, so the site and the booking flow share imagery. Duplicate-named files (`lashlift.webp`, `powderbrows.webp`, `eye liner.webp`, `lipblush.webp`) are **not** used.

| Group key | Photo `src` | Size | Focal |
|---|---|---|---|
| `lash-extensions` | `/images/Lash%20Extensions/lash-extensions-classic.webp` | 1536×1024 | `50% 45%` |
| `wispy-lashes` | `/images/Lash%20Extensions/lash-extensions-results-155.webp` | 868×560 | `50% 50%` |
| `lash-refills` | `/images/Lash%20Extensions/lash-extensions.webp` | 600×548 | `50% 50%` |
| `lash-lift` | `/images/Lash%20Lift/lash-lift.webp` | 736×736 | `50% 40%` |
| `brows` | `/images/Brow%20Lamination%20%26%20Tint/brow-lamination-tint.webp` | 901×1200 | `50% 35%` |
| `permanent-makeup` | `/images/PMU%20Services%20Content/powder-brows.webp` | 1200×1200 | `50% 50%` |

Service-level overrides for PMU: Lip blushing uses `/images/PMU%20Services%20Content/lip-blush.webp` (735×695). Eyeliner, lash line and bottom eyeliner use `/images/PMU%20Services%20Content/eyeliner.webp` (1200×1200). Ombre powder eyebrows uses `/images/PMU%20Services%20Content/ombre-brows.webp` (1200×1500).

`service_id` values are filled in once the live catalog is read with the owner's token (IMPLEMENTATION_PLAN, verification task). The mock fixtures use placeholder ids.

### 6.4 Initial whitelist (from the public Setmore page, read 2026-11-22)

The public page lists 44 services in 7 Setmore categories: Permanent Makeup 10, Eyelash Extensions 6, Wispy Eyelashes 4, Lash Lift 2, Eyebrow Services 4, Eyelash Refills 10, Wispy Refills 8. All of them are proposed for the whitelist (43) **except** `MEGA Volume Wispy`, which has no Book link on the public page. Touch-ups and refills are included because existing clients book them. The owner can remove any entry by PR.

Category-to-group mapping: Permanent Makeup → `permanent-makeup`; Eyelash Extensions (including Lash Removal, `deposit: "none"`) → `lash-extensions`; Wispy Eyelashes → `wispy-lashes`; Lash Lift → `lash-lift`; Eyebrow Services → `brows`; Eyelash Refills and Wispy Refills → `lash-refills`.

---

## 7. States and messages (English copy)

| Situation | UI |
|---|---|
| Catalog loading | Card skeletons (6), `aria-busy` |
| Catalog unavailable | "Online booking is taking a short break. Please call (425) 845 0045 and we'll book you in." + `tel:` button |
| Slots loading | Skeleton row, polite live region |
| Slot taken at submit (409 `SLOT_TAKEN`) | Return to step 2 with the times refreshed. Banner with a 2px `--error` left rule: "That time was just booked by someone else. Please choose another time — your details are saved." Focus moves to the banner. |
| Busy / rate limited (503 `UPSTREAM_BUSY`) | "Our booking calendar is busy right now. Please try again in a minute, or call (425) 845 0045." + `Try again` (outline) |
| Payment declined (402) | Inline under the card field: Square's decline category mapped to plain text ("Your card was declined. Please try another card."). No booking is made. |
| Booking failed after authorization | "We couldn't complete your booking and your card was not charged. Please try again or call (425) 845 0045." |
| Booking outcome unknown (503 `BOOKING_PENDING_CONFIRMATION`) | "We couldn't confirm your booking yet. Your card has not been charged. The studio will confirm with you shortly, or call (425) 845 0045." No retry button (prevents a duplicate request). |
| No deposit service | The card block is hidden; the button reads `BOOK APPOINTMENT` |

---

## 8. Accessibility checklist

- One `<h1>` (page title). Each step title is an `<h2>` and receives focus (`tabindex="-1"`) on step change.
- Progress: `<ol>` with `aria-current="step"`.
- Every control is reachable by keyboard. The week strip and the slot grid follow normal tab order; there are no roving-tabindex tricks.
- Live regions: one polite region for loading and results, one assertive region for errors at submit.
- Colour is never the only signal. Selected states also change border weight and set `aria-pressed`.
- Without JS: `<noscript>` shows the phone number and a link to the Setmore page as the fallback.

---

## 9. Out of scope (this phase)

- Rescheduling or cancelling from the site (these stay with Setmore emails and the phone).
- Staff selection UI (single provider, configured on the server).
- Gift cards, packages, add-ons, multi-service baskets.
- Translations other than English.
