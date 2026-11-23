# Lip Blushing FAQ notice: design (short)

Date: 2026-11-23 · Branch: `claude/dazzling-shannon-7jkxc1` · Status: awaiting owner approval

## Intent and why

Lip procedures can trigger a cold sore (HSV-1). The owner already has a "Lip Blushing & Cold Sores" block in the FAQ. She wants every client who books Lip Blushing to be sent to that block and to confirm they read it before booking, so there is no later claim of "I didn't know". The notice itself must not state the medical content; the FAQ carries that text.

## Decision

Approach 1 of 3, chosen by the owner: an inline notice right under the selected Lip Blushing card in Step 1, with a required checkbox. Not chosen: a modal on selection (intrusive, worse on phones), and a checkbox only at Step 3 (client learns it too late).

## What the client sees (Step 1)

Under the selected card, a calm block (same light panel style as the page):

```
IMPORTANT BEFORE YOU BOOK
Please read our "Lip Blushing & Cold Sores" FAQ.
[ Read the FAQ ↗ ]            (opens /faq/#lip-blushing-cold-sores in a new tab)
☐ I have read the FAQ and understand it applies to me.
```

"Continue to date & time" stays disabled until the box is ticked. Changing to another service clears the notice and the tick; choosing Lip Blushing again asks again. The wording above is a draft the owner approves.

## Goals

- Every Lip Blushing booking carries a recorded confirmation, enforced on the server, not only in the browser.
- The record is visible to the owner on the appointment in Setmore.
- The FAQ block opens directly from the notice.

## Non-goals and anti-goals

- No medical wording written by me. The notice only points to the owner's FAQ text.
- No change to the booking policy checkbox, deposit, pricing or other services.
- Anti-goal: a checkbox that can be bypassed by calling the API directly.

## Parts

1. **Service meta** (`worker/config/services-meta.json`): optional field `"notice": "lip-blushing-faq"` on Lip Blushing and Lip Blushing Touch-Up (my call: the touch-up is also a lip procedure). `catalog.js` validates it and passes `notice` to the client.
2. **Server** (`worker/src/appointments.js`): request field `faq_acknowledged`. If the chosen service has a `notice` and the field is not `true`, reject with the field error `faq_acknowledged: "Please confirm you have read the FAQ."`. On success, `bookingNotes` appends a line: `Lip Blushing FAQ read and confirmed online: <date> <time> Pacific.`
3. **Client** (`render-services.js`, `main.js`, `state.js`, `checkout.js`): notice block under the selected card, state `faqAcknowledged` (reset when the service changes), Continue gated on it, the flag sent with the booking request. Step 4 shows "Lip Blushing FAQ: confirmed" in the review.
4. **FAQ page** (`faq/index.html`): `id="lip-blushing-cold-sores"` on the existing subsection, `scroll-margin-top` so the sticky header does not cover it. No FAQ text changes.

## Constraints

- Everything stays on this branch and the preview; no production release.
- The booking state is in memory, so the FAQ must open in a new tab (`target="_blank" rel="noopener"`).
- Notes to Setmore stay under their existing limits (client notes ≤ 500 chars; the added line is short).

## Verification

Unit tests for catalog meta, the server rule (rejected without the flag, accepted with it, note line present, other services unaffected) and the client (notice appears only for flagged services, Continue gated, flag sent). Playwright run in mock mode through Step 1 to Step 4. CI `site-ci.yml`.

## Left to the builder

Exact class names and spacing; the date format in the Setmore note; focus handling for the checkbox.
