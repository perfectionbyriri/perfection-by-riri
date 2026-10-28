'use strict';

/* Enhance a fully readable set of anchored articles into a manual-activation
   tab interface. Content and prices remain in HTML as the source of truth. */
(() => {
  const root = document.querySelector('[data-lash-edit]');
  if (!root) return;
  const nav = root.querySelector('.le-style-nav');
  const tabs = [...nav.querySelectorAll('a')];
  const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));
  if (panels.some(panel => !panel)) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hint = root.querySelector('.le-mobile-hint');
  let active = 0;
  let arrival;

  /* Mobile (<= 800px) the tab list is a horizontal segmented scroller. Keep
     the active (or keyboard-focused) tab centred INSIDE the nav container —
     computed from rects and scrolled via nav.scrollTo, never scrollIntoView,
     so the page itself never jumps vertically. On desktop the nav does not
     overflow, the target left clamps to 0 and this is a no-op. */
  const scrollTabIntoView = (tab, smooth) => {
    const navBox = nav.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    const left = nav.scrollLeft + (tabBox.left - navBox.left) - (nav.clientWidth - tabBox.width) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: smooth && !reduced.matches ? 'smooth' : 'auto' });
  };

  /* The swipe hint stays readable if JS never runs; once the user has
     interacted (first tap or first scroll) it fades out. */
  const dismissHint = () => { if (hint) hint.classList.add('le-hint-dismissed'); };
  nav.addEventListener('pointerdown', dismissHint, { passive: true });
  nav.addEventListener('wheel', dismissHint, { passive: true });

  /* Soft edge fades: has-prev / has-next are toggled from the scroll position
     (rAF-batched) and CSS turns them into mask gradients on the nav. */
  let fadeTicking = false;
  const updateFades = () => {
    fadeTicking = false;
    const max = nav.scrollWidth - nav.clientWidth;
    nav.classList.toggle('has-prev', nav.scrollLeft > 2);
    nav.classList.toggle('has-next', nav.scrollLeft < max - 2);
  };
  const requestFadeUpdate = () => {
    if (!fadeTicking) {
      fadeTicking = true;
      requestAnimationFrame(updateFades);
    }
  };
  nav.addEventListener('scroll', requestFadeUpdate, { passive: true });
  window.addEventListener('resize', requestFadeUpdate);

  function activate(index, animate = false) {
    active = index;
    arrival?.cancel();
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    const jump = document.querySelector('[data-refill-jump]');
    if (jump) jump.href = '#' + panels[index].querySelector('.le-refills').id;
    scrollTabIntoView(tabs[index], animate);
    if (animate && !reduced.matches) {
      arrival = panels[index].animate([{opacity: .65}, {opacity: 1}], {duration: 180, easing: 'ease-out'});
    }
  }
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Choose your lash style');
  tabs.forEach((tab, i) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panels[i].id);
    panels[i].setAttribute('role', 'tabpanel');
    panels[i].setAttribute('aria-labelledby', tab.id);
    panels[i].tabIndex = 0;
    tab.addEventListener('click', event => { event.preventDefault(); dismissHint(); activate(i, true); });
    tab.addEventListener('keydown', event => {
      if (event.key === ' ') { event.preventDefault(); activate(i, true); return; }
      const steps = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};
      if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + steps[event.key] + tabs.length) % tabs.length;
      tabs.forEach((item, j) => { item.tabIndex = j === next ? 0 : -1; });
      tabs[next].focus();
      scrollTabIntoView(tabs[next], true);
    });
  });
  root.classList.add('le-tabs-ready');
  updateFades();
  function revealHash() {
    const index = panels.findIndex(panel => '#' + panel.id === location.hash || '#' + panel.querySelector('.le-refills').id === location.hash);
    if (index < 0) return;
    activate(index);
    const target = location.hash.startsWith('#refills-') ? panels[index].querySelector('.le-refills') : panels[index];
    target.scrollIntoView({block: 'start', behavior: 'instant'});
  }
  activate(0);
  revealHash();
  window.addEventListener('hashchange', revealHash);
  reduced.addEventListener('change', () => { if (reduced.matches) arrival?.finish(); });
})();
