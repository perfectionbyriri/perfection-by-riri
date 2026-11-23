import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_ADDRESS_LINE, renderActionBar } from '../../New Perfection/js/booking/action-bar.js';

const PRIMARY = '<button type="button" class="button button-gold" data-action="continue">Continue</button>';

test('the step 1 action bar shows the step status instead of Back', () => {
  const html = renderActionBar({ step: 1, primary: PRIMARY });
  assert.match(html, /^<div class="bk-actions bk-cinema-bar">/);
  assert.match(html, /<p class="bk-cinema-step">Step 01 of 04<\/p>/);
  assert.doesNotMatch(html, /data-action="back"/);
});

test('steps 2 to 4 start the action bar with Back', () => {
  for (const step of [2, 3, 4]) {
    const html = renderActionBar({ step, primary: PRIMARY });
    assert.match(html, /^<div class="bk-actions bk-cinema-bar"><button type="button" class="button button-outline" data-action="back">Back<\/button>/);
    assert.doesNotMatch(html, /bk-cinema-step/);
  }
});

test('every action bar carries the studio address, then the hint, then the primary button last', () => {
  assert.equal(STUDIO_ADDRESS_LINE, '18205 Alderwood Mall Pkwy A, Suite 918 · Lynnwood, WA 98037');
  const hint = '<p class="bk-hint" id="bk-continue-hint">Choose a time to continue.</p>';
  const html = renderActionBar({ step: 2, primary: PRIMARY, hint });
  assert.match(html, /<p class="bk-cinema-address">18205 Alderwood Mall Pkwy A, Suite 918 &middot; Lynnwood, WA 98037<\/p>/);
  assert.ok(html.indexOf('bk-cinema-address') < html.indexOf(hint));
  assert.ok(html.endsWith(`${hint}${PRIMARY}</div>`));
});
