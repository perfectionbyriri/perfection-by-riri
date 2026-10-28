'use strict';

/*
 * Shared Setmore enhancement for every booking page.
 *
 * The official Setmore script is loaded on the Home page only and attaches its
 * click handler directly to every `.anywhere-book-now-button`. This adapter
 * never renders Setmore's sample button or branding; it only steers the
 * vendor's own behaviour so the existing Perfection by Riri CTAs keep their
 * exact design while opening the Setmore booking experience on the website.
 *
 * Two vendor behaviours are corrected for this shared integration:
 *   1. The vendor does not cancel the anchor's default navigation, so without
 *      this adapter a CTA would also follow its own href and leave the page.
 *   2. The vendor intentionally opens a new browser tab below 600px. The trial
 *      requires the booking experience to stay on the website at every width,
 *      so narrow viewports are routed to the vendor's own in-page overlay.
 *
 * Progressive enhancement: if the vendor script never becomes active, the
 * adapter stays out of the way and each CTA's href leads to the real booking
 * URL as a normal fallback.
 */
(() => {
  const TRIGGER = '.anywhere-book-now-button';
  document.querySelectorAll('a[data-booking-url]').forEach((trigger) => {
    trigger.classList.add('anywhere-book-now-button');
  });

  let lastTrigger = null;
  let overlay = null;
  let closeControl = null;
  let iframe = null;
  let overlayOpen = false;
  const previousInert = new Map();

  function syncOverlay() {
    const vendorOverlay = overlay && overlay.isConnected ? overlay : document.querySelector('.anywhere-overlay');
    if (!vendorOverlay) return;

    if (vendorOverlay !== overlay) {
      overlay = vendorOverlay;
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Book appointment');
      closeControl = overlay.querySelector('.anywhere-close');
      if (closeControl) {
        closeControl.setAttribute('role', 'button');
        closeControl.setAttribute('tabindex', '0');
        closeControl.setAttribute('aria-label', 'Close booking');
        closeControl.addEventListener('keydown', (event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            if (iframe) iframe.focus();
            return;
          }
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          closeControl.click();
        });
      }
      iframe = overlay.querySelector('iframe');
      if (iframe) iframe.title = 'Perfection by Riri booking';
      if (iframe) {
        const endGuard = document.createElement('span');
        endGuard.tabIndex = 0;
        endGuard.setAttribute('aria-hidden', 'true');
        endGuard.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
        endGuard.addEventListener('focus', () => {
          if (closeControl) closeControl.focus();
        });
        iframe.after(endGuard);
      }
      new MutationObserver(syncOverlay).observe(overlay, { attributes: true, attributeFilter: ['style'] });
    }

    const visible = getComputedStyle(overlay).display !== 'none';
    if (visible && !overlayOpen) {
      overlayOpen = true;
      for (const child of document.body.children) {
        if (child === overlay) continue;
        previousInert.set(child, child.inert);
        child.inert = true;
      }
      if (closeControl) closeControl.focus();
    } else if (!visible && overlayOpen) {
      overlayOpen = false;
      for (const [child, wasInert] of previousInert) child.inert = wasInert;
      previousInert.clear();
      if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true });
      lastTrigger = null;
    }
  }

  new MutationObserver(syncOverlay).observe(document.body, { childList: true });
  document.addEventListener('focusin', (event) => {
    if (overlayOpen && !overlay.contains(event.target) && closeControl) closeControl.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (!overlayOpen || event.key !== 'Escape' || !closeControl) return;
    event.preventDefault();
    closeControl.click();
  }, true);

  function widgetActive() {
    // The vendor adds this class while wiring its triggers, so its presence
    // means the overlay and click handlers are ready to use.
    return document.body.classList.contains('anywhere-active');
  }

  // The real viewport descriptor is parked here only while the vendor's click
  // handler runs, so the in-page overlay is chosen at every width.
  let parkedViewport = null;

  function restoreViewport() {
    if (parkedViewport === null) return;
    const descriptor = parkedViewport;
    parkedViewport = null;
    if (descriptor) Object.defineProperty(window, 'innerWidth', descriptor);
    else delete window.innerWidth;
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest(TRIGGER);
    if (!trigger || !widgetActive()) return;
    lastTrigger = trigger;
    setTimeout(syncOverlay, 0);

    // Keep the visitor on the page: the vendor overlay renders here instead.
    event.preventDefault();

    if (window.innerWidth < 600 && parkedViewport === null) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        // Present a wide viewport to the vendor's synchronous handler only.
        Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => 1024 });
        parkedViewport = descriptor || false;
        // Safety net in case the event does not bubble back to the document.
        setTimeout(restoreViewport, 0);
      } catch (error) {
        // If the viewport cannot be shadowed, leave the vendor behaviour intact.
      }
    }
  }, true);

  // Bubble phase runs after the vendor's own listener on the trigger. For the
  // parked descriptor `false` means the property was inherited and is removed.
  document.addEventListener('click', restoreViewport, false);
})();
