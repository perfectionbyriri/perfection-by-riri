# Google Ads conversion and Meta Pixel for the booking flow — design

Date: 2026-11-26. Status: approved by the owner in chat (variant B, no GTM).

## Intent

Bookings are moving from Setmore to `perfectionbyriri.com/book/`. Google Ads and Meta must keep seeing a **paid booking** after the move: the owner wants to monitor Google Ads (Search campaign R2) and run Meta ads. Today the Google Ads conversion `Setmore - Confirmed Paid Booking` fires from Setmore, and no Meta Pixel runs on the site.

## Goals

- The existing Google Ads conversion action `Setmore - Confirmed Paid Booking` (conversion type ID `7882529756`, source Website, Google tag manual event) fires from the booking confirmation view. History and the R2 campaign goal stay unchanged.
- Enhanced conversions: the Google tag receives the customer's email and phone at conversion time (Google hashes them; the site stores nothing new).
- Meta Pixel dataset `1864195751687018`: `PageView` on every site page, `Purchase` on the booking confirmation view.
- A failure of any ad tag never breaks the booking, payment or confirmation view.

## Non-goals

- No Google Tag Manager on the site (owner decision 2026-11-26). `GTM-P3PCZHXT` stays in Setmore and is not touched.
- No Meta Conversions API (server side) yet. It is the planned next step; `eventID` is set now so it can deduplicate later.
- No cookie-consent banner, no Meta advanced matching, no changes to Setmore, GA4 admin, Google Ads or Meta settings.

## Anti-goals

- Double counting: one conversion per booking id, in every system.
- Firing on anything short of a confirmed paid booking (page view, payment attempt, `pending_capture`).
- Third-party scripts beyond Google and Meta on the page that hosts the Square card field.

## Constraints

- Fire under exactly the conditions of the existing GA4 `purchase`: `isConversion(result)` in `New Perfection/js/booking/confirm.js` (`booking.status === 'CONFIRMED'` and `deposit.status` in `captured`, `none`), guarded by the existing once-per-booking memory and `purchase_sent:<id>` sessionStorage flag.
- Every ad call is wrapped in `try/catch`, like the existing calls in `fireConfirmation`.
- `/book/*` has a strict CSP in `New Perfection/_headers` with a hash for the one inline Google tag snippet; `tests/booking/book-page.test.mjs` enforces it. No new inline scripts: the pixel loads from a first-party file.
- GitHub-only workflow; merging to `main` deploys. Work stays on `claude/dazzling-shannon-7jkxc1` until the owner approves.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A | GTM container on all pages, tags configured in GTM | Edits without deploys, but outside GitHub review; the container is shared with Setmore (unknown tags would fire on the site); needs a weaker CSP next to the card field; risk of double counting with tags in code. |
| **B (picked)** | Tags in site code: Google Ads via the existing `gtag.js`, Meta Pixel from a first-party script | Reviewed, tested, deployed with the site; minimal CSP change. Every tag change needs a PR. |
| C | B plus Meta Conversions API from the Worker | Best Meta accuracy (ad blockers, Safari), but needs a Meta token secret and more work. Deferred to a later step. |

The owner picked B after asking which option is most reliable and whether GTM is needed.

## Design (decided)

1. **Google tag config.** `New Perfection/js/analytics.js` (loaded on all 8 pages) calls `gtag('config', 'AW-16731910684')` when `window.gtag` exists. The inline snippet in `book/index.html` is not changed, so the CSP hash stays valid.
2. **Google Ads conversion.** In `fireConfirmation`, after `purchase`:
   - `gtag('set', 'user_data', { email, phone_number })` with the email trimmed and lowercased and the phone in E.164 (`+1XXXXXXXXXX`); a field that is empty or invalid is omitted; no call when both are missing.
   - `gtag('event', 'conversion', { send_to: 'AW-16731910684/qZuaCNy3164dEJzksqo-', value, currency: 'USD', transaction_id: <booking id> })`.
   - The contact data comes from the form state passed into `fireConfirmation` by `main.js`; it is not added to `dataLayer`, the `pbr:booking-confirmed` event, or logs.
3. **Meta Pixel.** New `New Perfection/js/meta-pixel.js`, included with `defer` on all 8 pages next to `analytics.js`: the standard `fbq` stub, loads `https://connect.facebook.net/en_US/fbevents.js`, `fbq('init', '1864195751687018')`, `fbq('track', 'PageView')`.
4. **Meta Purchase.** In `fireConfirmation`: `fbq('track', 'Purchase', { value, currency: 'USD', content_ids: [service_id], content_type: 'product' }, { eventID: <booking id> })`. `main.js` passes `window.fbq` the same way it passes `window.gtag`.
5. **CSP for `/book/*`.** Add `https://connect.facebook.net` to `script-src`, and `https://www.facebook.com` to `img-src` and `connect-src`. Nothing else changes.
6. **Privacy text.** The privacy and terms content updated by the booking work also names Google Ads conversion tracking (with enhanced conversions) and the Meta Pixel; `tests/booking/policy-text.test.mjs` is extended to check this.

## Verification

- Unit tests (`tests/booking/ui-confirm.test.mjs` and new ones): the conversion, `user_data` and `Purchase` fire once per booking only for a conversion; never for `pending_capture` or a failed booking; a throwing `gtag` or `fbq` does not stop the others or the view; the phone is normalized to E.164; contact data is absent from `dataLayer`.
- Page tests: each of the 8 pages includes `meta-pixel.js`; the `/book/*` CSP contains the Meta hosts and the unchanged script hash.
- CI run on the branch, and a local Playwright run in mock mode that records `gtag`/`fbq` calls through a full booking.
- Live proof only after deploy (Task 23): one real $50 booking shows in GA4, in Google Ads (the conversion's tag status becomes active) and in Meta Events Manager. Until then nothing is claimed as working in production.

## Left to the builder

- Exact helper names and module layout for the ad calls.
- How the Playwright check stubs the third-party scripts.

Builder calls (owner can override): enhanced conversions included; `content_type: 'product'` for Meta; the pixel loads on every page, not only `/book/`.
