// Horizontal swipe detection for the week view (Step 2).
// A swipe is a quick, mostly horizontal drag: left means the next week,
// right the previous one. Anything short, slow or diagonal is left to the
// browser (taps, vertical scrolling).

const MIN_DISTANCE = 60;
const MAX_DURATION_MS = 800;
const HORIZONTAL_RATIO = 1.8;

export function swipeDirection(start, end) {
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.t - start.t > MAX_DURATION_MS) return null;
  if (Math.abs(dx) < MIN_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) return null;
  return dx < 0 ? 'next' : 'prev';
}
