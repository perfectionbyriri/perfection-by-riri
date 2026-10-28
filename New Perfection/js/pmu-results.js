'use strict';

/*
  PMU "Real results" carousel enhancement (services/permanent-makeup only).

  The section works as a native horizontal scroller without JS; this layer
  adds the prev/next arrows, the 01 / 08 counter, the gold progress hairline
  and ArrowLeft/ArrowRight keyboard stepping. Everything is derived from the
  scroll position of the track, so native swipes, arrow clicks and keyboard
  steps stay in sync. Reduced-motion visitors get instant, easing-free moves.
*/
(() => {
  const section = document.querySelector('.pmu-results');
  if (!section) return;
  const track = section.querySelector('.pmu-results-track');
  if (!track) return;
  const slides = [...track.children];
  if (slides.length < 2) return;
  const prevButton = section.querySelector('[data-pmu-prev]');
  const nextButton = section.querySelector('[data-pmu-next]');
  const counter = section.querySelector('[data-pmu-counter]');
  const bar = section.querySelector('[data-pmu-bar]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Snap positions: each slide's start edge aligned to the left gutter
     (the track's padding-left, which mirrors the container gutter). */
  const gutter = () => parseFloat(getComputedStyle(track).paddingLeft) || 0;
  const snapPoints = () => slides.map((slide) => Math.max(0, slide.offsetLeft - gutter()));
  const maxScroll = () => Math.max(0, track.scrollWidth - track.clientWidth);

  const nearestIndex = () => {
    const points = snapPoints();
    const position = track.scrollLeft;
    /* At the far end the last snap points clamp to maxScroll, so the end
       position belongs to the final slide — never to a middle one. */
    if (position >= maxScroll() - 2) return slides.length - 1;
    let index = 0;
    for (let i = 0; i < points.length; i += 1) {
      if (Math.abs(points[i] - position) < Math.abs(points[index] - position)) index = i;
    }
    return index;
  };

  /* One slide per arrow click: the next snap point past the current position
     (or the previous one before it). maxScroll is the final target, so the
     last slide always scrolls fully into view even when its snap point
     clamps early (small viewports). */
  const targets = () => [...snapPoints(), maxScroll()];
  const stepNext = () => {
    const points = targets();
    const index = points.findIndex((point) => point > track.scrollLeft + 2);
    if (index < 0) return;
    track.scrollTo({ left: points[index], behavior: reduced.matches ? 'auto' : 'smooth' });
  };
  const stepPrev = () => {
    const points = targets();
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (points[i] < track.scrollLeft - 2) {
        track.scrollTo({ left: points[i], behavior: reduced.matches ? 'auto' : 'smooth' });
        return;
      }
    }
  };

  if (prevButton) prevButton.addEventListener('click', stepPrev);
  if (nextButton) nextButton.addEventListener('click', stepNext);

  /* The track is a focusable region: ArrowLeft/ArrowRight step one slide. */
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') { event.preventDefault(); stepNext(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); stepPrev(); }
  });

  /* Counter, progress hairline and arrow disabled states — batched into one
     animation frame per scroll burst. */
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = maxScroll();
    const position = track.scrollLeft;
    if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(position / max, 1) : 1) + ')';
    if (counter) {
      const current = String(nearestIndex() + 1).padStart(2, '0');
      counter.textContent = current + ' / ' + String(slides.length).padStart(2, '0');
    }
    if (prevButton) prevButton.disabled = position <= 1;
    if (nextButton) nextButton.disabled = position >= max - 1;
  };
  const requestUpdate = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  track.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  update();
})();
