'use strict';

/*
  Homepage story engine.

  Pinned chapters are plain `position: sticky` sections, so the browser moves
  the page and nothing intercepts wheel or touch input. This script only
  measures: for every `[data-story-pin]` section currently near the viewport it
  writes `--p`, the chapter's reading progress from 0 to 1, and CSS derives all
  motion from that number.

  `html.story-on` scopes the pinned layouts. It is set only when motion is
  allowed, so reduced-motion and no-JS visitors get ordinary flowing sections.

  `[data-story-words]` text is split into `span.w` words with `--i` (index) on
  each word and `--n` (count) on the container, for word-by-word lighting.
*/
(function () {
  function progress(top, height, viewport) {
    const distance = height - viewport;
    if (distance <= 0) return top < 0 ? 1 : 0;
    return Math.min(1, Math.max(0, -top / distance));
  }

  window.PerfectionStory = { progress };

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;

  document.documentElement.classList.add('story-on');

  document.querySelectorAll('[data-story-words]').forEach(element => {
    const words = element.textContent.trim().split(/\s+/);
    element.textContent = '';
    words.forEach((word, index) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.style.setProperty('--i', index);
      span.textContent = word;
      element.append(span, index < words.length - 1 ? ' ' : '');
    });
    element.style.setProperty('--n', words.length);
  });

  const active = new Set();
  let queued = false;

  function measure(section) {
    const rect = section.getBoundingClientRect();
    section.style.setProperty('--p', progress(rect.top, rect.height, window.innerHeight).toFixed(4));
  }

  function update() {
    queued = false;
    active.forEach(measure);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) active.add(entry.target);
      else {
        // Settle at 0 or 1 when a chapter leaves, so fast scrolls never strand it mid-way.
        measure(entry.target);
        active.delete(entry.target);
      }
    });
    schedule();
  }, { rootMargin: '25% 0px' });

  document.querySelectorAll('[data-story-pin]').forEach(section => observer.observe(section));
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
})();
