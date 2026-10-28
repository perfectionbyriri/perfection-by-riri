'use strict';

/*
  Service-page behaviour for the /services/* routes.

  Deliberately independent of js/main.js: the Home script is bound to the Home
  document (its own dialog element, its reveal target list, its footer year) and
  is not loaded on this route. This file owns only what the service pages need:

    1. a footer year fallback
    2. the mobile navigation toggle (mirrors the Home behaviour)
    3. a page-local dialog for appointment / privacy / terms information
    4. the accessible FAQ accordion
    5. the shared page-entry reveal (js/page-entry.js)

  No frameworks, no build step. Every lookup is guarded.
*/
(() => {
  const root = document.documentElement;

  /* The shared stylesheet reveals the mobile toggle only in the enhanced state. */
  root.classList.add('enhanced');

  /* 1 · Footer year fallback (js/main.js is not loaded here). */
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* 2 · Mobile navigation toggle. */
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#main-navigation');
  if (menuButton && navigation) {
    const desktopMenu = window.matchMedia('(min-width: 801px)');
    const setMenu = (open) => {
      navigation.classList.toggle('is-open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      navigation.inert = !desktopMenu.matches && !open;
      if (!open && window.PerfectionServiceNav) window.PerfectionServiceNav.reset();
    };
    const closeMenu = () => setMenu(false);
    setMenu(false);
    menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('click', (event) => {
      if (event.target.closest('#main-navigation a') || (!navigation.contains(event.target) && !menuButton.contains(event.target))) closeMenu();
    });
    document.addEventListener('focusin', (event) => {
      if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        menuButton.focus({ preventScroll: true });
      }
    });
    desktopMenu.addEventListener('change', closeMenu);
  }

  /* 3 · Page-local dialog. Content is the studio's verified information only. */
  const studioLinks = {
    google: 'https://maps.app.goo.gl/2zzJp92GvUAGifaV8?g_st=ic',
    instagram: 'https://www.instagram.com/perfection.byriri?stkn=eHcyYW1jODF5bXNi'
  };
  const dialogs = {
    appointment: '<p class="eyebrow">CONTACT</p><h2 id="svc-dialog-title">Perfection by Riri</h2><address class="dialog-contact"><a class="dialog-map-link" href="' + studioLinks.google + '" target="_blank" rel="noopener noreferrer" aria-label="Open Perfection by Riri location in Google Maps">18205 Alderwood Mall Pkwy A<br>Suite 918<br>Lynnwood, WA 98037</a><a class="dialog-phone" href="tel:+14253193887">(425) 319-3887</a></address><p class="eyebrow dialog-hours-title">Hours</p><p class="dialog-hours">Monday&ndash;Saturday<br>10:00 AM&ndash;5:00 PM<br>Sunday<br>Closed</p>',
    privacy: '<p class="eyebrow">WEBSITE INFORMATION</p><h2 id="svc-dialog-title">Privacy Policy</h2><p>Perfection by Riri respects your privacy. This website uses Google Analytics to understand visits and interactions, including appointment, phone and directions clicks. Google Analytics may use cookies and process usage data. This website does not collect personal information through its own forms or accounts.</p><p>Appointment bookings are handled through Setmore, our third-party booking provider. A hosting provider may process ordinary connection information when serving this website.</p><p>If you have questions about how your information is handled, please contact the studio at (425) 319-3887.</p>',
    terms: '<p class="eyebrow">WEBSITE INFORMATION</p><h2 id="svc-dialog-title">Terms &amp; Conditions</h2><p>All services, prices and availability are subject to change. Prices shown on this website describe the services offered at Perfection by Riri and are confirmed at the time of booking.</p><p>Appointments can be reserved through Setmore, our third-party booking provider. Please contact the studio at (425) 319-3887 with any questions before your appointment.</p><p>Viewing this website does not create an appointment or purchase a service.</p>'
  };
  const dialog = document.getElementById('svc-dialog');
  const dialogContent = document.getElementById('svc-dialog-content');
  if (dialog && dialogContent) {
    const closeButton = dialog.querySelector('.dialog-close');
    let opener = null;
    const openDialog = (key, trigger) => {
      const markup = dialogs[key];
      if (!markup) return;
      opener = trigger || document.activeElement;
      dialogContent.innerHTML = markup;
      document.body.classList.add('dialog-open');
      dialog.showModal();
      dialog.scrollTop = 0;
      if (closeButton) closeButton.focus({ preventScroll: true });
    };
    const closeDialog = () => { if (dialog.open) dialog.close(); };
    const triggers = [
      ['[data-privacy]', 'privacy'],
      ['[data-terms]', 'terms']
    ];
    document.addEventListener('click', (event) => {
      for (const entry of triggers) {
        const trigger = event.target.closest(entry[0]);
        if (trigger) { event.preventDefault(); openDialog(entry[1], trigger); return; }
      }
    });
    if (closeButton) closeButton.addEventListener('click', closeDialog);
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
    dialog.addEventListener('close', () => {
      document.body.classList.remove('dialog-open');
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    });
  }

  /* 4 · Page-entry reveal. The shared PerfectionPageEntry system
     (js/page-entry.js) owns the timing, curves and settle model — the same one
     used by the Contact and FAQ routes. This route supplies only its own
     targets, so every service page shares the one cohesive arrival and the
     hero is composed from the first frame. */
  if (window.PerfectionPageEntry) {
    window.PerfectionPageEntry.init({
      headingTargets: '.le-hero-lead, .pmu-hero-lead, .pmu-intro-grid, .pmu-pricing-head, .pmu-standard-head, .pmu-process-head, .pmu-results-head, .pmu-cta-copy, .brow-services-head, .brow-cta-copy',
      targets: '.le-hero-lead, .le-hero-photo, .le-hero-body, .le-hero-caption, .le-discovery, .le-results, .le-care, .le-questions, .le-booking, .pmu-hero-lead, .pmu-hero-media, .pmu-hero-body, .pmu-intro-grid, .pmu-pricing-head, .pmu-initial-pricing, .pmu-touchups, .pmu-standard-head, .pmu-standard-list, .pmu-process-head, .pmu-process-item, .pmu-results-head, .pmu-results-carousel, .pmu-results-quote, .pmu-cta-copy, .ll-edit, .brow-services-head, .brow-services-inner, .brow-why-media, .brow-why-copy, .brow-combined-grid, .brow-results-head, .ll-results-grid, .brow-results-feature, .brow-results-support, .brow-cta-copy',
      finishOnFocus: true
    });
  } else {
    root.classList.remove('motion-armed');
    clearTimeout(window.__perfectionMotionFallback);
  }

  /* 5 · Active navigation. This route is not a Home section, so the pass only
     marks a nav link when the current hash actually matches one. */
  const hash = window.location.hash;
  if (hash) {
    document.querySelectorAll('#main-navigation a').forEach((link) => {
      if (link.getAttribute('href') === hash) link.setAttribute('aria-current', 'location');
    });
  }

})();
