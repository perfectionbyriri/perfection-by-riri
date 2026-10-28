'use strict';

/*
  Shared Services navigation component.

  Loaded by both the Home page and the /services/* routes before their own
  page script. It owns the desktop hover/focus/click behaviour, the mobile
  accordion toggle, active-destination marking and the deep-link free API
  (window.PerfectionServiceNav). No dependencies, no build step. Idempotent:
  a second load is a no-op.
*/
(() => {
  if (window.PerfectionServiceNav) return;

  const desktopQuery = window.matchMedia('(min-width: 801px)');
  const HOVER_CLOSE_DELAY = 180;
  const FOCUS_OPEN_SUPPRESS_MS = 250;
  const groups = Array.prototype.slice.call(document.querySelectorAll('[data-service-nav]'));

  /* `/services/lash-extensions/` and `/services/lash-extensions/index.html`
     both normalize to `/services/lash-extensions`; `/` and `/index.html`
     both normalize to `/`. */
  const normalizePath = (pathname) => {
    const value = pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
    return value === '' ? '/' : value;
  };

  const controllers = [];
  let openController = null;

  function createController(group) {
    const trigger = group.querySelector('[data-service-group]');
    const panel = group.querySelector('.nav-dropdown-panel');
    if (!trigger || !panel) return null;

    const header = group.closest('.header-shell');
    const navigation = group.closest('nav');
    let pinned = false;
    let closeTimer = 0;
    /* Timestamp guard: a programmatic focus restore (e.g. Escape) must not be
       treated as a user focus and re-open the panel. The focusin handler always
       consumes it, but it only suppresses while Date.now() is still below the
       armed timestamp, so a stale guard can never outlive
       FOCUS_OPEN_SUPPRESS_MS and block a genuine later focus. */
    let focusOpenSuppressedUntil = 0;

    function clearClose() {
      if (!closeTimer) return;
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    }

    function isOpen() {
      return trigger.getAttribute('aria-expanded') === 'true';
    }

    function setOpen(open) {
      clearClose();
      if (open && openController && openController !== controller && openController.isOpen()) openController.close();
      group.classList.toggle('is-open', open);
      header.classList.toggle('services-open', open && desktopQuery.matches);
      trigger.setAttribute('aria-expanded', String(open));
      panel.inert = !open;
      if (open) {
        openController = controller;
      } else if (openController === controller) {
        openController = null;
      }
    }

    function close() {
      pinned = false;
      setOpen(false);
    }

    function scheduleClose() {
      clearClose();
      closeTimer = window.setTimeout(() => {
        closeTimer = 0;
        if (panel.contains(document.activeElement)) return;
        try { if (header.matches(':hover')) return; } catch (error) { /* :hover unsupported */ }
        close();
      }, HOVER_CLOSE_DELAY);
    }

    /* Active destination. Links carrying a `service` query param are the Home
       deep-links and are skipped so they cannot falsely match `/`. */
    let active = false;
    Array.prototype.slice.call(panel.querySelectorAll('[data-service-link]')).forEach((link) => {
      const href = link.getAttribute('href');
      if (!href) return;
      let url;
      try { url = new URL(href, window.location.href); } catch (error) { return; }
      if (url.searchParams.has('service')) return;
      if (normalizePath(url.pathname) !== normalizePath(window.location.pathname)) return;
      link.setAttribute('aria-current', 'page');
      active = true;
    });
    if (active) group.classList.add('is-active-parent');

    trigger.addEventListener('click', () => {
      /* Opened by hover/focus only (not pinned): the activation pins it
         instead of closing, so a cold click reliably opens the menu. */
      if (isOpen() && !pinned) {
        pinned = true;
        clearClose();
        return;
      }
      const next = !isOpen();
      pinned = next;
      setOpen(next);
    });
    trigger.addEventListener('pointerenter', () => {
      if (!desktopQuery.matches) return;
      clearClose();
      if (!isOpen()) setOpen(true);
    });
    panel.addEventListener('pointerenter', () => {
      if (!desktopQuery.matches) return;
      clearClose();
    });
    header.addEventListener('pointerenter', clearClose);
    header.addEventListener('pointerleave', () => {
      if (!desktopQuery.matches) return;
      scheduleClose();
    });
    group.addEventListener('focusin', () => {
      if (focusOpenSuppressedUntil) {
        const armed = Date.now() < focusOpenSuppressedUntil;
        focusOpenSuppressedUntil = 0;          /* always consume */
        if (armed) { clearClose(); return; }   /* swallow only while genuinely armed */
      }
      if (!desktopQuery.matches) return;
      clearClose();
      if (!isOpen()) setOpen(true);
    });
    group.addEventListener('focusout', (event) => {
      if (!desktopQuery.matches) return;
      if (group.contains(event.relatedTarget)) return;
      close();
    });
    /* A different primary destination dismisses even a click-opened band. */
    navigation.querySelectorAll(':scope > a').forEach((link) => {
      link.addEventListener('pointerenter', () => {
        if (desktopQuery.matches) close();
      });
    });
    document.addEventListener('click', (event) => {
      if (group.contains(event.target)) return;
      if (isOpen()) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isOpen()) return;
      /* Arm the guard before restoring focus so the resulting focusin cannot
         re-open the panel. The guard is consumed by the next focusin; if no
         focusin follows, it silently expires after FOCUS_OPEN_SUPPRESS_MS and
         no longer suppresses anything. */
      focusOpenSuppressedUntil = Date.now() + FOCUS_OPEN_SUPPRESS_MS;
      close();
      trigger.focus({ preventScroll: true });
    });

    panel.inert = true;

    const controller = {
      isOpen: isOpen,
      close: close,
      reset() {
        pinned = false;
        clearClose();
        setOpen(false);
      }
    };
    return controller;
  }

  groups.forEach((group) => {
    const controller = createController(group);
    if (controller) controllers.push(controller);
  });

  const api = {
    reset() { controllers.forEach((controller) => controller.reset()); },
    close() { controllers.forEach((controller) => controller.close()); }
  };
  window.PerfectionServiceNav = api;

  const handleDesktopChange = () => api.reset();
  if (desktopQuery.addEventListener) desktopQuery.addEventListener('change', handleDesktopChange);
  else if (desktopQuery.addListener) desktopQuery.addListener(handleDesktopChange);

})();
