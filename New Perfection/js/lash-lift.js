'use strict';

/* Enhance the two readable anchored service articles into a manual-activation
   tab interface, reusing the same interaction principle as the Lash Extensions
   edit. Content and prices remain in the HTML as the source of truth, and with
   no JavaScript both services stay fully readable. */
(() => {
  const root = document.querySelector('[data-lift-edit]');
  if (!root) return;
  const nav = root.querySelector('.ll-options');
  if (!nav) return;
  const tabs = [...nav.querySelectorAll('a')];
  const panels = tabs.map(tab => document.getElementById(tab.hash.slice(1)));
  if (!tabs.length || panels.some(panel => !panel)) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let arrival;

  function activate(index, animate = false) {
    arrival?.cancel();
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (animate && !reduced.matches) {
      arrival = panels[index].animate([{opacity: .65}, {opacity: 1}], {duration: 180, easing: 'ease-out'});
    }
  }
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Choose your lift');
  tabs.forEach((tab, i) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panels[i].id);
    panels[i].setAttribute('role', 'tabpanel');
    panels[i].setAttribute('aria-labelledby', tab.id);
    panels[i].tabIndex = 0;
    tab.addEventListener('click', event => { event.preventDefault(); activate(i, true); });
    tab.addEventListener('keydown', event => {
      if (event.key === ' ') { event.preventDefault(); activate(i, true); return; }
      const steps = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};
      if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + steps[event.key] + tabs.length) % tabs.length;
      tabs.forEach((item, j) => { item.tabIndex = j === next ? 0 : -1; });
      tabs[next].focus();
    });
  });
  root.classList.add('ll-tabs-ready');
  function revealHash() {
    const index = panels.findIndex(panel => '#' + panel.id === location.hash);
    if (index < 0) return;
    activate(index);
    panels[index].scrollIntoView({block: 'start', behavior: 'instant'});
  }
  activate(0);
  revealHash();
  window.addEventListener('hashchange', revealHash);
  reduced.addEventListener('change', () => { if (reduced.matches) arrival?.finish(); });
})();
