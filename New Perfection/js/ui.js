'use strict';

/*
  Shared header behaviour for every page.
  - The black header stays within reach: it tucks away while scrolling down
    and returns as soon as the visitor scrolls up (never while the menu is
    open or the header holds focus).
  - On phones the open menu fills the screen below the header, the page
    behind it stays still, and the menu ends with the booking button, the
    phone number and Instagram.
*/
(() => {
  const shell = document.querySelector('.header-shell');
  if (!shell) return;
  const root = document.documentElement;
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#main-navigation');
  const menuOpen = () => !!toggle && toggle.getAttribute('aria-expanded') === 'true';

  let lastY = window.scrollY;
  let queued = false;
  const update = () => {
    queued = false;
    const y = window.scrollY;
    const deep = y > shell.offsetHeight + 120;
    if (menuOpen() || shell.matches(':focus-within') || !deep || y < lastY - 6) shell.classList.remove('is-tucked');
    else if (y > lastY + 6) shell.classList.add('is-tucked');
    lastY = y;
  };
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }, { passive: true });

  if (!toggle || !nav) return;

  const sync = () => {
    const open = menuOpen();
    if (open) root.style.setProperty('--menu-top', Math.max(0, Math.round(shell.getBoundingClientRect().bottom)) + 'px');
    root.classList.toggle('menu-open', open);
    if (open) shell.classList.remove('is-tucked');
  };
  new MutationObserver(sync).observe(toggle, { attributes: true, attributeFilter: ['aria-expanded'] });

  // Menu footer: reuse the page's own booking, phone and Instagram links.
  const book = document.querySelector('.header-cta');
  const phone = document.querySelector('footer a[href^="tel:"]');
  const instagram = document.querySelector('footer a[href*="instagram.com"]');
  if (book || phone || instagram) {
    const extras = document.createElement('div');
    extras.className = 'nav-extras';
    if (book) {
      const cta = book.cloneNode(true);
      cta.classList.remove('header-cta');
      extras.append(cta);
    }
    const row = document.createElement('div');
    row.className = 'nav-extras-row';
    if (phone) {
      const link = document.createElement('a');
      link.href = phone.getAttribute('href');
      link.textContent = phone.textContent.trim();
      row.append(link);
    }
    if (instagram) {
      const link = document.createElement('a');
      link.href = instagram.getAttribute('href');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Instagram';
      row.append(link);
    }
    if (row.children.length) extras.append(row);
    nav.append(extras);
  }
})();
