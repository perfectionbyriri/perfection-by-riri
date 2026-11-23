// Shared bottom action bar for booking Steps 1-4 (Variant C, docs/superpowers/specs/2026-11-23-booking-variant-c-design.md §5.4).
// The primary button stays inside #bk-step, so main.js primaryButton() and the mobile bar keep finding it.

export const STUDIO_ADDRESS_LINE = '18205 Alderwood Mall Pkwy A, Suite 918 · Lynnwood, WA 98037';
const ADDRESS_HTML = '18205 Alderwood Mall Pkwy A, Suite 918 &middot; Lynnwood, WA 98037';

export function renderActionBar({ step, primary, hint = '' }) {
  const lead = step === 1
    ? '<p class="bk-cinema-step">Step 01 of 04</p>'
    : '<button type="button" class="button button-outline" data-action="back">Back</button>';
  return `<div class="bk-actions bk-cinema-bar">${lead}<p class="bk-cinema-address">${ADDRESS_HTML}</p>${hint}${primary}</div>`;
}
