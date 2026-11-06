'use strict';

/*
  Contact-page behaviour for the /contact/ route.

  Deliberately independent of js/main.js and js/service-page.js: the Home script
  is bound to the Home document, and the service script is bound to the service
  routes. This file owns only what the contact page needs:

    1. a footer year fallback
    2. the mobile navigation toggle (mirrors the shared behaviour)
    3. a page-local dialog for appointment / privacy / terms information
    4. the restrained reveal pass (same tokens and curves as the rest of the site)

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

  /* 3 · Page-local dialog. Content is the studio's verified information only —
     there is no form, no submission and no fabricated email. */
  const studioLinks = {
    google: 'https://maps.app.goo.gl/2zzJp92GvUAGifaV8?g_st=ic',
    instagram: 'https://www.instagram.com/perfection.byriri?stkn=eHcyYW1jODF5bXNi'
  };
  const dialogs = {
    appointment: '<p class="eyebrow">CONTACT</p><h2 id="contact-dialog-title">Perfection by Riri</h2><address class="dialog-contact"><a class="dialog-map-link" href="' + studioLinks.google + '" target="_blank" rel="noopener noreferrer" aria-label="Open Perfection by Riri location in Google Maps">18205 Alderwood Mall Pkwy A<br>Suite 918<br>Lynnwood, WA 98037</a><a class="dialog-phone" href="tel:+14258450045">(425) 845 0045</a></address><p class="eyebrow dialog-hours-title">Hours</p><p class="dialog-hours">Monday&ndash;Saturday<br>10:00 AM&ndash;5:00 PM<br>Sunday<br>Closed</p>',
    privacy: '<p class="eyebrow">WEBSITE INFORMATION</p><h2 id="contact-dialog-title">Privacy Policy</h2><p>Perfection by Riri respects your privacy. This website uses Google Analytics to understand visits and interactions, including appointment, phone and directions clicks. Google Analytics may use cookies and process usage data. This website does not collect personal information through its own forms or accounts.</p><p>Appointment bookings are handled through Setmore, our third-party booking provider. A hosting provider may process ordinary connection information when serving this website.</p><p>If you have questions about how your information is handled, please contact the studio at (425) 845 0045.</p>',
    terms: '<p class="eyebrow">WEBSITE INFORMATION</p><h2 id="contact-dialog-title">Terms &amp; Conditions</h2><p>All services, prices and availability are subject to change. Prices shown on this website describe the services offered at Perfection by Riri and are confirmed at the time of booking.</p><p>Appointments can be reserved through Setmore, our third-party booking provider. Please contact the studio at (425) 845 0045 with any questions before your appointment.</p><p>Viewing this website does not create an appointment or purchase a service.</p>'
  };
  const dialog = document.getElementById('contact-dialog');
  const dialogContent = document.getElementById('contact-dialog-content');
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
     (js/page-entry.js) owns the timing, curves and settle model; this route
     supplies only its own target selectors, so the entrance is identical to the
     rest of the site. */
  if (window.PerfectionPageEntry) {
    window.PerfectionPageEntry.init({
      headingTargets: '.le-hero-lead, .contact-details-head, .contact-cta-inner',
      targets: '.le-hero-lead, .le-hero-photo, .le-hero-body, .le-hero-caption, .contact-details-head, .contact-columns, .contact-cta-inner',
      staggerClass: ''
    });
  } else {
    root.classList.remove('motion-armed');
    clearTimeout(window.__perfectionMotionFallback);
  }
})();
