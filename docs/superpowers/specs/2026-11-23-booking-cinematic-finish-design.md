# Booking UI — Cinematic Hero Scene for Step 4 & Step 5

Date: 2026-11-23 · Status: **approved by the owner 2026-11-23** · Amends [DESIGN_SPEC.md](../../booking/DESIGN_SPEC.md) §3 and §4 (Steps 4–5).

## 1. Intent & Why

On the live preview (`Booking_Finish_Page.png` and `Booking_Finish_Page_2.png`), Step 4 (*Deposit & confirm*) and Step 5 (*Confirmed*) looked raw and unfinished:
- The right-hand `YOUR BOOKING` sidebar stayed visible on Steps 4 and 5, repeating the same 3 lines of text shown on the left across a wide empty void.
- On Step 4, the primary `BOOK APPOINTMENT` button sat inside the form above a horizontal divider while a solitary `BACK` button hung below the divider.
- Step 5 kept the `BOOK YOUR APPOINTMENT` wizard header and 4-step progress bar above 3 plain text lines with no photography or architectural presence.

The owner selected the **Cinematic Hero Scene** direction, using only the website's own self-hosted fonts (`Bodoni Moda` with `font-variation-settings: 'opsz' 24` and `Jost`) and borrowing the photographic hero band (`.le-hero`) + vertical-hairline editorial strip (`.svc-exp-grid`) grammar from the service pages.

## 2. Constraints

- **Fonts:** Strictly `--serif` (`Bodoni Moda`, normal & italic, `'opsz' 24`) and `--sans` (`Jost`, weight `300` tabular numerals for prices, weight `500` tracked uppercase for labels). No third-party fonts.
- **Geometry:** `border-radius: 0` everywhere, `box-shadow: none` everywhere (enforced by `tests/booking/book-page.test.mjs`).
- **Capitalisation:** New uppercase label classes (`.bk-cinema-kicker`, `.bk-cinema-caption`, `.bk-cinema-col-label`, `.bk-cinema-edit`, `.bk-cinema-address`) are registered in `New Perfection/css/type-case.css`; serif display titles (`.bk-cinema-title`, `.bk-cinema-col-title`, `.bk-confirm-service`) are registered under serif display headings in `type-case.css`.
- **Existing contracts preserved:** All DOM IDs (`#bk-checkout`, `#bk-card`, `#bk-card-error`, `#bk-turnstile`), data attributes (`data-action="back"`, `data-action="add-to-calendar"`, `data-goto-step`), error mapping, Turnstile, Square tokenization, `.ics` generation, and analytics (`fireConfirmation`, `trackFunnel`) remain unchanged.

## 3. Layout & Component Design

### 3.1 Stage Layout on Steps 4 & 5

- `.bk-layout` gets `data-step="<1..5>"` (and `.bk-shell` gets `data-step="<1..5>"`).
- **Steps 1–3:** Two columns on desktop (`minmax(0, 1fr)` + `340px` sticky `.bk-summary`), unchanged.
- **Step 4:** `.bk-summary` is hidden (`display: none`) and `.bk-layout` spans the full container width (`grid-template-columns: minmax(0, 1fr)`), eliminating duplicate summary text. `.bk-head` (title + 4-step progress bar) remains visible.
- **Step 5 (Confirmed):** Both `.bk-summary` and `.bk-head` are hidden (`display: none`), so the Cinematic Hero Scene opens directly beneath the site header.

### 3.2 Step 4 — `renderReview({ service, details, timeLabel })`

1. **Photographic Hero Banner (`.bk-cinema-hero`):**
   - Uses `service.photo?.src` (or fallback `/images/hero/hero-lash.webp`), `service.photo?.alt` (or `""`), and `object-position: ${service.photo?.focal || '78% 42%'}`.
   - Dark editorial gradient overlay (`linear-gradient(90deg, ...), linear-gradient(180deg, ...)`) and `2px` champagne-gold top rule.
   - Left content:
     - `<p class="bk-cinema-kicker">Step 04 of 04 &middot; Final review</p>`
     - `<p class="bk-cinema-title">Your appointment,<br><em>considered.</em></p>`
   - Right caption:
     - `<p class="bk-cinema-caption">Personal by design.<br>Perfection in the details.</p>`
2. **4-Column Architectural Strip (`.bk-cinema-grid`):**
   - Four columns on desktop (`grid-template-columns: repeat(4, minmax(0, 1fr))`), separated by `1px` vertical hairlines (`border-left: 1px solid var(--bk-line)`):
     - **Column 1 (`01 · Treatment`):** header with `<button type="button" class="bk-cinema-edit" data-goto-step="1">Edit</button>`, `<p class="bk-review-line bk-review-service bk-cinema-col-title">${service.name} &middot; ${formatDuration(service.duration_minutes)}</p>`, and service price line (`Service price: ${formatMoney(service.price_cents)}`).
     - **Column 2 (`02 · Date & time`):** header with `<button type="button" class="bk-cinema-edit" data-goto-step="2">Edit</button>`, `<p class="bk-review-line bk-cinema-col-title">${timeLabel} Pacific Time</p>`.
     - **Column 3 (`03 · Guest`):** header with `<button type="button" class="bk-cinema-edit" data-goto-step="3">Edit</button>`, `<p class="bk-review-line">${who}</p>` (plus optional notes if present).
     - **Column 4 (`04 · Due today`):**
       - When `deposit.required` is `true`: `<dl class="bk-quote">` with `Deposit`, optional `Card processing fee (x%)`, `Due today` (`$50.00`), and `<p class="bk-fine">Remaining balance is paid at the studio.</p>`.
       - When `deposit.required` is `false`: `<p class="bk-cinema-price">$0.00</p><p class="bk-fine">No deposit is needed for this service. You pay at the studio.</p>`.
3. **Payment & Verification Band (`.bk-cinema-payband`):**
   - If `deposit.required`: `<div class="bk-review-block bk-cinema-card-wrap"><h3 class="bk-review-label">Card</h3><div class="bk-card-field" id="bk-card"></div><p class="bk-field-error" id="bk-card-error" role="alert" hidden></p><p class="bk-fine bk-secured">Payment secured by Square.</p></div>` alongside `<div class="bk-turnstile" id="bk-turnstile"></div>`.
   - If `!deposit.required`: `<div class="bk-turnstile" id="bk-turnstile"></div>`.
4. **Unified Bottom Action Bar (`.bk-actions.bk-cinema-bar` inside `#bk-checkout`):**
   - `<button type="button" class="button button-outline" data-action="back">Back</button>`
   - `<p class="bk-cinema-address">18205 Alderwood Mall Pkwy A, Suite 918 &middot; Lynnwood, WA 98037</p>`
   - `<button type="submit" class="button button-gold bk-pay" data-label="${payLabel(deposit)}">${payLabel(deposit)}</button>`

### 3.3 Step 5 — `renderConfirmation({ result, service, firstName, email, timeLabel, policyText })`

1. **Photographic Hero Banner (`.bk-cinema-hero.bk-cinema-hero--confirm`):**
   - Uses `service?.photo?.src` (or fallback `/images/hero/hero-lash.webp`).
   - Left content:
     - `<p class="bk-eyebrow">You&rsquo;re booked &middot; Lynnwood, WA</p>`
     - `<h2 class="bk-step-title bk-confirm-title" tabindex="-1">See you soon${name ? `, <em>${name}.</em>` : '.'}</h2>`
     - `<div class="bk-actions bk-confirm-actions"><button type="button" class="button button-gold" data-action="add-to-calendar">Add to calendar</button><a class="button button-outline" href="${DIRECTIONS_URL}" target="_blank" rel="noopener noreferrer">Directions</a></div>`
   - Right caption:
     - `<p class="bk-cinema-caption">Personal by design.<br>Perfection in the details.</p>`
2. **4-Column Confirmed Strip (`.bk-cinema-grid`):**
   - **Column 1 (`Treatment`):** `<p class="bk-confirm-service bk-cinema-col-title">${booking.service_name}</p>` (plus duration & price when `service` is passed).
   - **Column 2 (`Date & time`):** `<p class="bk-confirm-line bk-cinema-col-title bk-cinema-col-title--gold">${timeLabel} Pacific Time</p>`.
   - **Column 3 (`Studio location`):** `<p class="bk-confirm-line">Perfection by Riri &middot; Lynnwood, WA <a href="${DIRECTIONS_URL}" target="_blank" rel="noopener noreferrer">Directions</a></p><p class="bk-fine">18205 Alderwood Mall Pkwy A, Suite 918</p>`.
   - **Column 4 (`Deposit & changes`):** optional `depositLine` (`Deposit paid $50.00 · Receipt from Square sent to anna@…` or pending capture copy) + `<p class="bk-confirm-line">Need to change or cancel? Call <a href="tel:+14258450045">(425) 845 0045</a>.</p>`.
3. **Policy Footer:**
   - `<p class="bk-fine bk-cinema-policy">Booking policy: ${policyText}</p>`
