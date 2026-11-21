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

  // Pointer offset from an element's centre -> a small, capped pull toward it.
  function magnet(dx, dy) {
    const pull = value => Math.max(-8, Math.min(8, Math.round(value * 0.2)));
    return { x: pull(dx) + 0, y: pull(dy) + 0 };
  }

  window.PerfectionStory = { progress, magnet };

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

  // Keyboard users: when focus lands on a panel of a horizontal track, scroll the
  // page to the progress at which that panel is fully in view.
  document.querySelectorAll('[data-story-track]').forEach(track => {
    const section = track.closest('[data-story-pin]');
    track.addEventListener('focusin', event => {
      const item = event.target.closest('li');
      const travel = section.offsetHeight - window.innerHeight;
      const stage = track.parentElement.parentElement;
      stage.scrollLeft = 0;
      const shift = track.getBoundingClientRect().width + 2 * parseFloat(getComputedStyle(track.parentElement).paddingLeft) - stage.clientWidth;
      if (!item || travel <= 0 || shift <= 0) return;
      const rect = item.getBoundingClientRect();
      const margin = 24;
      const delta = rect.right > stage.clientWidth - margin ? rect.right - (stage.clientWidth - margin)
        : rect.left < margin ? rect.left - margin : 0;
      if (!delta) return;
      const current = parseFloat(section.style.getPropertyValue('--p')) || 0;
      const target = Math.min(1, Math.max(0, current + delta / shift));
      window.scrollTo({ top: section.offsetTop + target * travel, behavior: 'instant' });
    });
  });

  // A gentle magnetic pull on marked buttons, for fine pointers only.
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('[data-magnetic]').forEach(button => {
      button.addEventListener('pointermove', event => {
        const rect = button.getBoundingClientRect();
        const pull = magnet(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
        button.style.translate = pull.x + 'px ' + pull.y + 'px';
      });
      button.addEventListener('pointerleave', () => { button.style.translate = ''; });
    });
  }
})();
