import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swipeDirection } from '../../New Perfection/js/booking/swipe.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, 'New Perfection', file), 'utf8');
const at = (x, y, t) => ({ x, y, t });

test('a left swipe means next week, a right swipe means previous week', () => {
  assert.equal(swipeDirection(at(300, 100, 0), at(200, 105, 250)), 'next');
  assert.equal(swipeDirection(at(100, 100, 0), at(220, 98, 250)), 'prev');
});

test('short, slow, or mostly vertical gestures are not swipes', () => {
  assert.equal(swipeDirection(at(300, 100, 0), at(270, 100, 200)), null, 'under 60px');
  assert.equal(swipeDirection(at(300, 100, 0), at(200, 100, 1200)), null, 'slower than 800ms');
  assert.equal(swipeDirection(at(300, 100, 0), at(220, 220, 300)), null, 'diagonal / scrolling down');
  assert.equal(swipeDirection(at(300, 100, 0), at(300, 100, 300)), null, 'a tap');
  assert.equal(swipeDirection(null, at(1, 1, 1)), null, 'no start point');
});

test('step 2 wires the swipe to the week arrows and keeps vertical scroll', () => {
  const js = read('js/booking/main.js');
  assert.match(js, /import \{ swipeDirection \} from '\.\/swipe\.js'/);
  assert.match(js, /touchstart/);
  assert.match(js, /touchend/);
  assert.match(js, /\[data-action="\$\{direction\}-week"\]/, 'clicks the same prev-week / next-week arrows');
  assert.match(read('css/booking.css'), /\.bk-week\s*\{[^}]*touch-action:\s*pan-y/);
});
