'use strict';

(() => {
  // The inline head script may have armed the Home reveal; once we run, we own it.
  // If its safety timer already fired (slow main.js) or WAAPI is missing, never
  // animate from a hidden state: drop the arm and leave the page fully visible.
  const motionArmed = document.documentElement.classList.contains('motion-armed') && window.__perfectionMotionFallbackFired !== true;
  const supportsAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const motionEnabled = motionArmed && supportsAnimate;
  if (!motionEnabled) document.documentElement.classList.remove('motion-armed');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#main-navigation');
  const dialog = document.querySelector('#detail-dialog');
  const dialogContent = document.querySelector('#dialog-content');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let dialogOpener = null;
  let resultKey = '';
  let resultIndex = 0;
  let activeDialog = '';

  // Real Results. Every entry points at an existing .webp result photograph in
  // images/; no illustrative before/after assets are referenced here. The PMU
  // gallery keeps the prepared 1.55 aspect result assets that fixed the
  // over-zoom framing, and each image carries its own description so the copy,
  // counter, and photograph advance together.
  const results = {
    lashExtensions: {
      name: 'Lash extensions',
      note: 'Individual extensions for soft, natural definition.',
      items: [
        { image: 'images/Lash%20Extensions/lash-extensions-results-155.webp', alt: 'Lash extensions result: natural lashes on the left, softly defined extensions on the right.', description: 'A SOFT, FULL SET WITH A NATURAL, DEFINED FINISH.' },
        { image: 'images/Lash%20Extensions/eyelashextensions-results-155.webp', alt: 'Lash extensions result: a wispy, lightweight set.', description: 'A WISPY SET FOR LIGHTWEIGHT TEXTURE AND DEFINITION.' },
        { image: 'images/Lash%20Extensions/lashextensions1-results-155.webp', alt: 'Lash extensions result: full volume lashes above natural lashes.', description: 'A FULL SET WITH A SOFT, DEFINED FINISH.' },
        { image: 'images/Lash%20Extensions/lashextensions2-results-155.webp', alt: 'Lash extensions result: a dramatic, softly wisped set.', description: 'A DRAMATIC SET WITH A SOFT, WISPY FINISH.' }
      ]
    },
    permanentMakeup: {
      name: 'Permanent makeup',
      note: 'Subtle, refined definition designed to last.',
      items: [
        { image: 'images/PMU/eye-liner-results-155.webp', alt: 'Permanent makeup result: softly defined eyeliner along the upper lash line.', description: 'A SOFTLY DEFINED EYELINER ALONG THE UPPER LASH LINE.' },
        { image: 'images/PMU/eyeliner-results-155.webp', alt: 'Permanent makeup result: refined eyeliner with a delicate, natural finish.', description: 'REFINED EYELINER WITH A DELICATE, NATURAL FINISH.' },
        { image: 'images/PMU/lip-blush-results-155.webp', alt: 'Permanent makeup result: lip blush with a soft, even tint.', description: 'LIP BLUSH WITH A SOFT, EVEN TINT.' },
        { image: 'images/PMU/lip-blush3-results-155.webp', alt: 'Permanent makeup result: lip blush with a fuller, rosier tint.', description: 'LIP BLUSH WITH A FULLER, ROSIER TINT.' },
        { image: 'images/PMU/lipblush-results-155.webp', alt: 'Permanent makeup result: lip blush with a smooth, natural-looking tint.', description: 'LIP BLUSH WITH A SMOOTH, NATURAL-LOOKING TINT.' },
        { image: 'images/PMU/ombre-brows-results-155.webp', alt: 'Permanent makeup result: ombré powder brows with a soft, defined shape.', description: 'OMBRÉ POWDER BROWS WITH A SOFT, DEFINED SHAPE.' },
        { image: 'images/PMU/powder-brows-results-155.webp', alt: 'Permanent makeup result: powder brows with a softly shaded finish.', description: 'POWDER BROWS WITH A SOFTLY SHADED FINISH.' },
        { image: 'images/PMU/powderbrows-results-155.webp', alt: 'Permanent makeup result: powder brows with gently defined arches.', description: 'POWDER BROWS WITH GENTLY DEFINED ARCHES.' }
      ]
    },
    lashLift: {
      name: 'Lash lift',
      note: 'An upward curl and deeper tint for effortless definition.',
      items: [
        { image: 'images/Lash%20Lift/lash-lift-results-155.webp', alt: 'Lash lift result: relaxed lashes on the left, lifted lashes on the right.', description: 'A NATURAL LIFT WITH A SOFT, DEFINED CURL.' },
        { image: 'images/Lash%20Lift/lashlift-results-155.webp', alt: 'Lash lift result: natural lashes on the left, lifted and curled lashes on the right.', description: 'A LIFTED, DEFINED CURL FOR A NATURALLY OPEN LOOK.' }
      ]
    },
    browLamination: {
      name: 'Brow lamination &amp; tint',
      note: 'Fuller, defined brows with a soft, natural finish.',
      items: [
        { image: 'images/Brow%20Lamination%20%26%20Tint/browlamination-results-155.webp', alt: 'Brow lamination and tint result: natural brows on the left, fuller defined brows on the right.', description: 'A FULLER, SMOOTHED SHAPE WITH SOFT DEFINITION.' },
        { image: 'images/Brow%20Lamination%20%26%20Tint/brow-lamination-tint-results-155.webp', alt: 'Brow lamination and tint result: fuller, defined brows with a soft finish.', description: 'FULLER, DEFINED BROWS WITH A SOFT, NATURAL FINISH.' },
        { image: 'images/Brow%20Lamination%20%26%20Tint/browlamination1-results-155.webp', alt: 'Brow lamination and tint result: a fluffed, styled brow shape with defined arches.', description: 'A FLUFFED, STYLED SHAPE WITH DEFINED ARCHES.' }
      ]
    }
  };
  // Verified external destinations. Google is the verified studio listing used
  // by the MORE RESULTS action and by every studio address link; Instagram is
  // the verified studio profile. Both render as real anchors. Empty values
  // still fall back to an unavailable control rather than a fabricated link.
  const studioLinks = {
    google: 'https://maps.app.goo.gl/2zzJp92GvUAGifaV8?g_st=ic',
    instagram: 'https://www.instagram.com/perfection.byriri?stkn=eHcyYW1jODF5bXNi'
  };
  // Studio address destination, shared by the contact surfaces.
  const mapsUrl = studioLinks.google;
  const information = {
    lashExtensions: '<p class="eyebrow">MY SIGNATURE SERVICES</p><h2 id="dialog-title">Lash extensions</h2><p>Individual extensions designed around your natural features and the look you love. Every set is customized to enhance your features and fit your lifestyle.</p><p>Softly defined, softly textured, or full and fluffy — from a natural everyday look to a touch of drama.</p>',
    lashLift: '<p class="eyebrow">MY SIGNATURE SERVICES</p><h2 id="dialog-title">Lash lift</h2><p>An upward curl and a deeper tint enhance your natural lashes for an effortless, low-maintenance look.</p>',
    browLamination: '<p class="eyebrow">MY SIGNATURE SERVICES</p><h2 id="dialog-title">Brow lamination &amp; tint</h2><p>Fuller, defined brows with a soft, natural finish. Brow lamination smooths and lifts the natural brow hairs for a softly groomed shape.</p>',
    permanentMakeup: '<p class="eyebrow">MY SIGNATURE SERVICES</p><h2 id="dialog-title">Permanent makeup</h2><p>Subtle, refined definition designed to last, tailored to your features. Ombré powder brows, lip blush and eyeliner are designed around your features.</p>',
    appointment: '<p class="eyebrow">CONTACT</p><h2 id="dialog-title">Perfection by Riri</h2><address class="dialog-contact"><a class="dialog-map-link" href="' + mapsUrl + '" target="_blank" rel="noopener noreferrer" aria-label="Open Perfection by Riri location in Google Maps">18205 Alderwood Mall Pkwy A<br>Suite 918<br>Lynnwood, WA 98037</a><a class="dialog-phone" href="tel:+14253193887">(425) 319-3887</a></address><p class="eyebrow dialog-hours-title">Hours</p><p class="dialog-hours">Monday–Saturday<br>10:00 AM–5:00 PM<br>Sunday<br>Closed</p>',
    privacy: '<p class="eyebrow">WEBSITE INFORMATION</p><h2 id="dialog-title">Privacy Policy</h2><p>Perfection by Riri respects your privacy. This website uses Google Analytics to understand visits and interactions, including appointment, phone and directions clicks. Google Analytics may use cookies and process usage data. This website does not collect personal information through its own forms or accounts.</p><p>Appointment bookings are handled through Setmore, our third-party booking provider. A hosting provider may process ordinary connection information when serving this website.</p><p>If you have questions about how your information is handled, please contact the studio at (425) 319-3887.</p>',
    terms: '<p class="eyebrow">WEBSITE INFORMATION</p><h2 id="dialog-title">Terms &amp; Conditions</h2><p>All services, prices and availability are subject to change. Prices shown on this website describe the services offered at Perfection by Riri and are confirmed at the time of booking.</p><p>Appointments can be reserved through Setmore, our third-party booking provider. Please contact the studio at (425) 319-3887 with any questions before your appointment.</p><p>Viewing this website does not create an appointment or purchase a service.</p>'
  };


  const motionStyle = getComputedStyle(document.documentElement);
  // Tokens are read once at init (same as before): a live resize across the
  // mobile breakpoint does not re-read them.
  const readToken = (name, fallback) => {
    const value = parseFloat(motionStyle.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const motion = {
    fast: readToken('--duration-fast', 140),
    normal: readToken('--duration-normal', 260),
    slow: readToken('--duration-slow', 560),
    revealUI: readToken('--duration-reveal-ui', 680),
    revealHero: readToken('--duration-reveal-hero', 700),
    revealHeading: readToken('--duration-reveal-heading', 820),
    revealImage: readToken('--duration-reveal-image', 1000),
    revealSection: readToken('--duration-reveal-section', 780),
    revealGallery: readToken('--duration-reveal-gallery', 900),
    riseUI: readToken('--reveal-rise-ui', 14),
    riseHero: readToken('--reveal-rise-hero', 14),
    riseHeading: readToken('--reveal-rise-heading', 20),
    riseSection: readToken('--reveal-rise-section', 22),
    riseImage: readToken('--reveal-rise-image', 10),
    riseScale: readToken('--reveal-scale', 1.02),
    staggerHero: readToken('--stagger-hero', 80),
    staggerGroup: readToken('--stagger-group', 90),
    staggerChild: readToken('--stagger-child', 55),
    ease: motionStyle.getPropertyValue('--ease-premium').trim() || 'cubic-bezier(.16,1,.3,1)',
    easeIn: 'cubic-bezier(.4,0,1,1)',
    easeSoft: motionStyle.getPropertyValue('--ease-soft').trim() || 'cubic-bezier(.32,.72,0,1)',
    easeReveal: motionStyle.getPropertyValue('--ease-reveal').trim() || 'cubic-bezier(.22,1,.36,1)',
    easeRevealImage: motionStyle.getPropertyValue('--ease-reveal-image').trim() || 'cubic-bezier(.18,.98,.32,1)'
  };
  const animations = new Set();
  const focusAnimations = new Set();
  function animate(element, frames, duration = motion.normal, delay = 0, purpose = 'site', easing = motion.ease, fill = 'backwards') {
    if (reducedMotion.matches || !element.animate) return null;
    const animation = element.animate(frames, { duration, delay, easing, fill });
    animations.add(animation);
    if (purpose === 'site' && element.matches('a, button')) focusAnimations.add(animation);
    const release = () => { animations.delete(animation); focusAnimations.delete(animation); };
    animation.finished.then(release, release);
    return animation;
  }
  function finishMotion() { animations.forEach(animation => animation.finish()); }
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) finishMotion(); });
  window.addEventListener('pagehide', finishMotion);
  document.addEventListener('focusin', event => {
    focusAnimations.forEach(animation => { if (animation.effect.target === event.target) animation.finish(); });
  });
  // Pointer feedback never captures or prevents native pan/pinch gestures.
  const pressSelector = '.service-image[data-service], .transformation, .review-image, .button[data-service], .button[data-gallery], [data-dialog], [data-results], .result-explore, .result-social, .dialog-controls button, .dialog-close, .menu-toggle, #main-navigation a';
  let pressed = null;
  function releasePress() {
    if (pressed) pressed.element.classList.remove('is-pressed');
    pressed = null;
  }
  document.addEventListener('pointerdown', event => {
    document.documentElement.dataset.input = 'pointer';
    releasePress();
    if (!event.isPrimary || event.button !== 0) return;
    const element = event.target.closest(pressSelector);
    if (!element) return;
    pressed = { element, id: event.pointerId, x: event.clientX, y: event.clientY };
    element.classList.add('is-pressed');
  }, { passive: true });
  document.addEventListener('pointermove', event => {
    if (pressed && event.pointerId === pressed.id && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 9) releasePress();
  }, { passive: true });
  ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, releasePress, { passive: true }));
  window.addEventListener('blur', releasePress);
  document.addEventListener('keydown', event => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) document.documentElement.dataset.input = 'keyboard';
  });

  const desktopMenu = matchMedia('(min-width: 801px)');
  document.documentElement.classList.add('enhanced');
  function setMenu(open) {
    navigation.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    navigation.inert = !desktopMenu.matches && !open;
    if (!open && window.PerfectionServiceNav) window.PerfectionServiceNav.reset();
  }
  function closeMenu() { setMenu(false); }
  menuButton.addEventListener('click', () => setMenu(menuButton.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('click', event => {
    if (event.target.closest('#main-navigation a') || (!navigation.contains(event.target) && !menuButton.contains(event.target))) closeMenu();
  });
  document.addEventListener('focusin', event => {
    if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') { closeMenu(); menuButton.focus({ preventScroll: true }); }
  });
  desktopMenu.addEventListener('change', closeMenu);
  closeMenu();

  let savedScroll = 0;
  let savedBodyStyle = '';
  let dialogState = 'closed';
  let dialogRevision = 0;
  let pendingMarkup = '';
  const dialogClose = dialog.querySelector('.dialog-close');
  const ownedAnimations = new Map();
  const frozenElements = new Set();
  const dialogTiming = { open: 420, close: 260, closeDelay: 50, out: 140, incoming: 280, contentOut: 160, contentLead: 100, contentStep: 36, contentCap: 150, contentOpen: 300 };
  const compactDialog = matchMedia('(max-width:800px)');
  // Compact overrides are resolved where read; keep every duration in one place.
  const dialogDuration = {
    get shellOpen() { return compactDialog.matches ? 380 : dialogTiming.open; },
    get contentLead() { return compactDialog.matches ? 90 : dialogTiming.contentLead; },
    get contentStep() { return compactDialog.matches ? 30 : dialogTiming.contentStep; },
    get contentOpen() { return compactDialog.matches ? 280 : dialogTiming.contentOpen; }
  };

  function cancelOwned(name, freeze = false) {
    const animation = ownedAnimations.get(name);
    if (!animation) return;
    const element = animation.effect.target;
    if (freeze) {
      const style = getComputedStyle(element);
      element.style.opacity = style.opacity;
      element.style.transform = style.transform;
      frozenElements.add(element);
    }
    animation.cancel();
    ownedAnimations.delete(name);
  }
  function clearFrozen() {
    frozenElements.forEach(element => { element.style.removeProperty('opacity'); element.style.removeProperty('transform'); });
    frozenElements.clear();
  }
  function cancelDialogMotion(freeze = false) {
    [...ownedAnimations.keys()].forEach(name => cancelOwned(name, freeze));
  }
  function dialogMotion(name, element, frames, duration, delay = 0, easing, fill = 'backwards') {
    cancelOwned(name);
    const animation = animate(element, frames, duration, delay, 'dialog', easing, fill);
    if (animation) {
      ownedAnimations.set(name, animation);
      // A `forwards` fill must stay owned until cleanup cancels it; releasing it
      // on finish would leave its end state behind on the next open.
      if (fill !== 'forwards') {
        const release = () => { if (ownedAnimations.get(name) === animation) ownedAnimations.delete(name); };
        animation.finished.then(release, release);
      }
    }
    return animation;
  }
  const settled = animation => animation ? animation.finished.catch(() => {}) : Promise.resolve();
  function focusDialog(selector) {
    (selector && dialog.querySelector(selector) || dialogClose).focus({ preventScroll: true });
  }
  function enterContentGroups() {
    [...dialogContent.children].forEach((element, index) => {
      const base = element.matches('.eyebrow, h2') ? 0 : element.matches('img, .service-image') ? 44 : 84;
      const delay = dialogDuration.contentLead + Math.min(base + index * dialogDuration.contentStep, dialogTiming.contentCap);
      dialogMotion('group-' + index, element, [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0px)' }], dialogDuration.contentOpen, delay, motion.ease);
    });
  }
  async function openDialog(markup, type, opener, focusSelector, direction) {
    if (dialog.open && dialogState !== 'closing' && markup === pendingMarkup) return;
    const revision = ++dialogRevision;
    pendingMarkup = markup;
    dialog.classList.toggle('dialog--results', type === 'results');
    if (!dialog.open) {
      dialogState = 'opening';
      dialogOpener = opener || document.activeElement;
      savedScroll = window.scrollY;
      savedBodyStyle = document.body.getAttribute('style') || '';
      const scrollbar = innerWidth - document.documentElement.clientWidth;
      document.body.style.position = 'fixed';
      document.body.style.top = -savedScroll + 'px';
      document.body.style.width = '100%';
      document.body.style.paddingRight = scrollbar + 'px';
      document.body.classList.add('dialog-open');
      dialogContent.innerHTML = markup; // Fixed local templates only.
      activeDialog = type;
      dialog.classList.remove('is-closing');
      dialog.style.removeProperty('--backdrop-from');
      dialog.showModal();
      dialog.scrollTop = 0;
      focusDialog(focusSelector);
      const shellStart = compactDialog.matches ? 'translateY(12px) scale(.978)' : 'translateY(18px) scale(.972)';
      const opening = dialogMotion('shell', dialog, [{ opacity: 0, transform: shellStart }, { opacity: 1, transform: 'translateY(0px) scale(1)' }], dialogDuration.shellOpen, 0, motion.ease);
      enterContentGroups();
      await settled(opening);
      if (revision === dialogRevision) dialogState = 'open';
      return;
    }
    if (dialogState === 'closing') {
      const shell = getComputedStyle(dialog);
      const start = { opacity: shell.opacity, transform: shell.transform };
      const backdrop = getComputedStyle(dialog, '::backdrop').opacity;
      cancelDialogMotion();
      clearFrozen();
      dialog.style.setProperty('--backdrop-from', backdrop);
      dialog.classList.remove('is-closing');
      dialogMotion('shell', dialog, [start, { opacity: 1, transform: 'translateY(0px) scale(1)' }], dialogTiming.open);
    }
    dialogState = 'swapping';
    // Keep the sheet's footprint stable; longer content scrolls natively inside it.
    if (!dialog.style.height) dialog.style.height = dialog.offsetHeight + 'px';
    [...ownedAnimations.keys()].filter(name => name !== 'shell').forEach(name => cancelOwned(name, true));
    const outgoingStyle = getComputedStyle(dialogContent);
    // Gallery paging moves horizontally; every other swap moves vertically.
    const outgoingEnd = direction ? { opacity: 0, transform: `translateX(${-10 * direction}px)` } : { opacity: 0, transform: 'translateY(-6px)' };
    const incomingStart = direction ? `translateX(${14 * direction}px)` : 'translateY(10px)';
    const outgoing = dialogMotion('content', dialogContent, [{ opacity: outgoingStyle.opacity, transform: outgoingStyle.transform }, outgoingEnd], dialogTiming.out, 0, motion.easeIn);
    await settled(outgoing);
    if (revision !== dialogRevision || dialogState === 'closing') return;
    clearFrozen();
    dialogContent.innerHTML = markup;
    activeDialog = type;
    dialog.scrollTop = 0;
    focusDialog(focusSelector);
    const incoming = dialogMotion('content', dialogContent, [{ opacity: 0, transform: incomingStart }, { opacity: 1, transform: 'translateY(0px)' }], dialogTiming.incoming, 0, motion.ease);
    await settled(incoming);
    if (revision === dialogRevision) dialogState = 'open';
  }
  async function closeDialog() {
    if (!dialog.open || dialogState === 'closing') return;
    const revision = ++dialogRevision;
    dialogState = 'closing';
    const style = getComputedStyle(dialog);
    const start = { opacity: style.opacity, transform: style.transform };
    dialog.style.setProperty('--backdrop-from', getComputedStyle(dialog, '::backdrop').opacity);
    cancelDialogMotion(true);
    dialog.classList.add('is-closing');
    // Content leaves first (not awaited); both fills are held until cleanup cancels them.
    dialogMotion('content', dialogContent, [{ opacity: 1, transform: 'translateY(0px)' }, { opacity: 0, transform: 'translateY(-5px)' }], dialogTiming.contentOut, 0, motion.easeIn, 'forwards');
    const shellEnd = compactDialog.matches ? 'translateY(9px) scale(.988)' : 'translateY(12px) scale(.985)';
    const closing = dialogMotion('shell', dialog, [start, { opacity: 0, transform: shellEnd }], dialogTiming.close, dialogTiming.closeDelay, motion.easeIn, 'forwards');
    await settled(closing);
    if (revision === dialogRevision && dialog.open) { dialog.close(); cleanupDialog(); }
  }
  // Single source for the MORE RESULTS action pair. Both destinations are
  // verified, so both render as real anchors; the empty-URL branch remains as a
  // defensive fallback that would render a labelled, non-navigating control.
  function resultSocialMarkup() {
    const google = studioLinks.google
      ? '<a class="result-social" href="' + studioLinks.google + '" target="_blank" rel="noopener noreferrer" aria-label="View more results on Google"><svg class="icon result-social-icon icon-google" aria-hidden="true" focusable="false"><use href="#icon-google"/></svg><span>View on Google</span></a>'
      : '<button class="result-social is-unavailable" type="button" aria-disabled="true" aria-label="View on Google — unavailable"><svg class="icon result-social-icon icon-google" aria-hidden="true" focusable="false"><use href="#icon-google"/></svg><span>View on Google</span></button>';
    const instagram = studioLinks.instagram
      ? '<a class="result-social" href="' + studioLinks.instagram + '" target="_blank" rel="noopener noreferrer" aria-label="View more results on Instagram"><svg class="icon result-social-icon" aria-hidden="true" focusable="false"><use href="#icon-instagram"/></svg><span>View on Instagram</span></a>'
      : '<button class="result-social is-unavailable" type="button" aria-disabled="true" title="Instagram link unavailable" aria-label="View on Instagram — unavailable"><svg class="icon result-social-icon" aria-hidden="true" focusable="false"><use href="#icon-instagram"/></svg><span>View on Instagram</span></button>';
    return '<div class="result-more-actions"><p class="result-more-label">MORE RESULTS</p><div class="result-socials">' + google + instagram + '</div></div>';
  }

  function resultMarkup(key, index) {
    const result = results[key];
    if (!result) return '';
    const total = result.items.length;
    const item = result.items[index];
    const pad = value => String(value).padStart(2, '0');
    const prevDisabled = index <= 0 ? ' disabled' : '';
    const nextDisabled = index >= total - 1 ? ' disabled' : '';
    const thumbs = total > 1
      ? '<div class="result-more"><div class="result-thumbs" role="group" aria-label="More results">' + result.items.map((entry, i) => '<button class="result-thumb" type="button" data-result-thumb="' + i + '"' + (i === index ? ' aria-current="true"' : '') + ' aria-label="Result ' + (i + 1) + ' of ' + total + '"><img src="' + entry.image + '" alt="" width="1536" height="1024"></button>').join('') + '</div></div>'
      : '';
    return '<p class="result-progress" aria-live="polite">' + pad(index + 1) + ' / ' + pad(total) + '</p>'
      + '<div class="result-layout">'
      + '<div class="result-stage"><img src="' + item.image + '" alt="' + item.alt + '" aria-describedby="result-copy" width="1536" height="1024">'
      + '<div class="result-nav">'
      + '<button class="result-nav-previous" type="button" data-result-direction="-1" aria-label="Previous result"' + prevDisabled + '><svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-chevron"/></svg></button>'
      + '<button class="result-nav-next" type="button" data-result-direction="1" aria-label="Next result"' + nextDisabled + '><svg class="icon" aria-hidden="true" focusable="false"><use href="#icon-chevron"/></svg></button>'
      + '</div></div>'
      + '<div class="result-info"><p class="eyebrow">REAL RESULTS</p><h2 id="dialog-title">' + result.name + '</h2><span class="result-rule" aria-hidden="true"></span><p class="result-copy" id="result-copy">' + (item.description || result.note) + '</p>'
      + '<div class="result-pager">'
      + '<button type="button" data-result-direction="-1" aria-label="Previous result"' + prevDisabled + '>\u2190 Previous</button>'
      + '<span class="result-pager-divider" aria-hidden="true"></span>'
      + '<button type="button" data-result-direction="1" aria-label="Next result"' + nextDisabled + '>Next \u2192</button>'
      + '</div>'
      + resultSocialMarkup()
      + '</div></div>'
      + thumbs;
  }

  function showResult(key, index, opener, direction) {
    const result = results[key];
    if (!result) return;
    const clamped = Math.max(0, Math.min(index, result.items.length - 1));
    resultKey = key;
    resultIndex = clamped;
    const focusSelector = direction ? '[data-result-direction="' + direction + '"]:not([disabled])' : null;
    openDialog(resultMarkup(key, clamped), 'results', opener, focusSelector, direction);
  }

  document.addEventListener('click', (event) => {
    const info = event.target.closest('[data-dialog]');
    const resultsTrigger = event.target.closest('[data-results]');
    const resultThumb = event.target.closest('[data-result-thumb]');
    const resultDirection = event.target.closest('[data-result-direction]');
    if (info && information[info.dataset.dialog]) openDialog(information[info.dataset.dialog], info.dataset.dialog, info);
    else if (resultsTrigger) showResult(resultsTrigger.dataset.results, 0, resultsTrigger);
    else if (resultThumb) showResult(resultKey, Number(resultThumb.dataset.resultThumb), null);
    else if (resultDirection) showResult(resultKey, resultIndex + Number(resultDirection.dataset.resultDirection), null, Number(resultDirection.dataset.resultDirection));
  });

  dialog.querySelector('.dialog-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  function cleanupDialog() {
    if (dialog.open || dialogState === 'closed') return;
    document.body.setAttribute('style', savedBodyStyle);
    document.body.classList.remove('dialog-open');
    window.scrollTo({ top: savedScroll, behavior: 'instant' });
    ++dialogRevision;
    cancelDialogMotion();
    clearFrozen();
    dialog.style.removeProperty('height');
    dialog.style.removeProperty('--backdrop-from');
    dialog.classList.remove('is-closing');
    dialog.classList.remove('dialog--results');
    pendingMarkup = '';
    activeDialog = '';
    dialogState = 'closed';
    releasePress();
    if (dialogOpener && dialogOpener.isConnected) dialogOpener.focus({ preventScroll: true });
  }
  dialog.addEventListener('close', cleanupDialog);
  // Services deep-link: only the three verified service keys open a dialog.
  // Any other value is a strict no-op (no dialog, no throw, no redirect).
  const serviceDeepLinkKeys = ['permanentMakeup', 'lashLift', 'browLamination'];
  function stripServiceParam() {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    let url;
    try { url = new URL(window.location.href); } catch (error) { return; }
    if (!url.searchParams.has('service')) return;
    url.searchParams.delete('service');
    const search = url.searchParams.toString();
    window.history.replaceState(null, '', url.pathname + (search ? '?' + search : '') + url.hash);
  }
  function openServiceDeepLink() {
    let key = null;
    try { key = new URLSearchParams(window.location.search).get('service'); } catch (error) { key = null; }
    if (!key || serviceDeepLinkKeys.indexOf(key) === -1) return;
    if (!information[key]) return;
    openDialog(information[key], key, null);
    dialog.addEventListener('close', stripServiceParam, { once: true });
  }
  if (document.readyState === 'complete') openServiceDeepLink();
  else document.addEventListener('DOMContentLoaded', openServiceDeepLink, { once: true });
  dialog.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    if (activeDialog === 'results') {
      event.preventDefault();
      showResult(resultKey, resultIndex + direction, null, direction);
    }
  });

  if (motionEnabled) {
    const imageReveal = '.about-portrait, .transformation';
    const headingReveal = '.signature-head, .result-head, .reviews .section-intro, .offer';
    const uiReveal = '.trust-grid';
    const heroGroups = document.querySelectorAll('.hero-content > *');
    const revealTargets = document.querySelectorAll('.trust-grid, .signature-head, .signature-item, .experience-grid, .about-portrait, .about-copy, .result-head, .result-item, .transformation, .reviews .section-intro, .review-feature, .offer');
    // Persist the settled state inline so visibility never depends on animation
    // fill semantics. No animated container owns an author transform, so `none`
    // matches the frozen design; child hover transforms and the independent
    // `scale` press property on controls are untouched.
    let settledCount = 0;
    const settleTotal = 2 + heroGroups.length + revealTargets.length;
    function settle(element) {
      if (!element) return;
      element.style.opacity = '1';
      element.style.transform = 'none';
      settledCount += 1;
      if (settledCount >= settleTotal) document.documentElement.classList.remove('motion-armed');
    }
    // Plays the reveal and writes its final state once it settles; if the finish
    // hook is unavailable, the `forwards` fill still holds the settled values.
    function animated(element, frames, duration, delay, easing) {
      const animation = animate(element, frames, duration, delay, 'site', easing, 'forwards');
      if (!animation) { settle(element); return; }
      const done = () => settle(element);
      if (animation.finished && typeof animation.finished.then === 'function') animation.finished.then(done, done);
      else { try { animation.onfinish = done; } catch (error) { done(); } }
    }
    // One reveal language for the page. Text families settle with opacity plus a
    // short rise on the reveal curve; images settle a touch softer, slower, and
    // with a subtle scale. Only opacity/transform are animated.
    function reveal(element, delay = 0) {
      if (!element) return;
      if (element.matches(imageReveal)) {
        animated(element, [
          { opacity: 0, transform: 'translateY(' + motion.riseImage + 'px) scale(' + motion.riseScale + ')' },
          { opacity: 1, transform: 'none' }
        ], motion.revealGallery, delay, motion.easeRevealImage);
        return;
      }
      const isHeading = element.matches(headingReveal);
      const isUI = element.matches(uiReveal);
      const rise = isHeading ? motion.riseHeading : isUI ? motion.riseUI : motion.riseSection;
      const duration = isHeading ? motion.revealHeading : isUI ? motion.revealUI : motion.revealSection;
      animated(element, [
        { opacity: 0, transform: 'translateY(' + rise + 'px)' },
        { opacity: 1, transform: 'none' }
      ], duration, delay, motion.easeReveal);
    }
    // Initial load, one composition: image -> header/brand -> eyebrow -> headline
    // -> supporting copy -> CTA group. The hero image overlaps the text sequence.
    animated(document.querySelector('.hero-image'), [{ opacity: 0, transform: 'scale(' + motion.riseScale + ')' }, { opacity: 1, transform: 'none' }], motion.revealImage, 0, motion.easeRevealImage);
    animated(document.querySelector('.site-header'), [{ opacity: 0 }, { opacity: 1 }], motion.revealHero, 60, motion.easeReveal);
    heroGroups.forEach((element, index) => {
      const isHeading = element.matches('h1');
      const duration = isHeading ? motion.revealHeading : motion.revealHero;
      const rise = isHeading ? motion.riseHeading : motion.riseHero;
      animated(element, [{ opacity: 0, transform: 'translateY(' + rise + 'px)' }, { opacity: 1, transform: 'none' }], duration, 140 + index * motion.staggerHero, motion.easeReveal);
    });
    // Compact viewports read as they scroll, so the init boundary and observer
    // are gated once here; desktop keeps its certified predicate and params.
    const mobileInit = innerWidth <= 800;
    if ('IntersectionObserver' in window) {
      const reveals = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          reveals.unobserve(entry.target);
          const element = entry.target;
          // Layer separation stays restrained: logical groups ~90ms apart,
          // closely related children ~55ms. No serialised module waits.
          const delay = element.classList.contains('signature-item') ? motion.staggerGroup + Math.min([...element.parentElement.children].indexOf(element), 3) * motion.staggerChild
            : element.classList.contains('about-copy') ? motion.staggerGroup
            : element.classList.contains('transformation') || element.classList.contains('result-item') ? motion.staggerGroup
            : element.classList.contains('review-feature') ? motion.staggerGroup
            : 0;
          reveal(element, delay);
        });
      }, mobileInit
        ? { rootMargin: '0px 0px -8% 0px', threshold: .12 }
        : { rootMargin: '0px 0px -12% 0px', threshold: .15 });
      revealTargets.forEach(element => {
        // Category C: targets sitting in the lower 30% of the viewport at init
        // still take the observer so their entrance plays as the page is read;
        // targets genuinely in the upper band reveal at once and never strand.
        // On compact viewports only content fully scrolled off the top settles
        // instantly, so restored/hash loads still get a perceptible entrance.
        const top = element.getBoundingClientRect();
        if (mobileInit ? top.bottom > 0 : top.top >= innerHeight * 0.7) reveals.observe(element);
        else reveal(element, 0);
      });
      reducedMotion.addEventListener('change', () => {
        if (!reducedMotion.matches) return;
        reveals.disconnect();
        document.documentElement.classList.remove('motion-armed');
      });
    } else {
      revealTargets.forEach(element => reveal(element, 0));
    }
    // Setup is complete and synchronous; the safety timer can now be retired.
    clearTimeout(window.__perfectionMotionFallback);
  }

  // Client reviews: a calm, single-quote editorial carousel. One review is
  // primary at a time; every transition is a short crossfade with no geometry
  // change. Autoplay is lengthened for longer quotes. Manual navigation stops
  // playback until Play is pressed; hover and focus suspend it briefly.
  // Reduced motion starts with playback stopped.
  function initReviews() {
    const root = document.querySelector('[data-reviews]');
    if (!root) return;
    const slides = Array.prototype.slice.call(root.querySelectorAll('.review-slide'));
    if (slides.length < 2) return;
    const stage = root.querySelector('.review-slides');
    const dotsWrap = root.querySelector('.review-dots');
    const toggleButton = root.querySelector('.review-toggle');
    const prevButton = root.querySelector('.review-prev');
    const nextButton = root.querySelector('.review-next');
    let index = 0;
    let timer = null;
    let playing = !reducedMotion.matches;
    let hoverSuspended = false;
    let focusSuspended = false;
    let swipeSuspended = false;
    let onScreen = true;
    function slideDuration(i) {
      const quote = slides[i].querySelector('blockquote');
      const text = quote ? quote.textContent.trim() : '';
      const words = text ? text.split(/\s+/).length : 0;
      return Math.min(18000, Math.max(8000, words * 260));
    }
    const dots = slides.map((slide, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'review-dot';
      dot.setAttribute('aria-label', 'Show review ' + (i + 1) + ' of ' + slides.length);
      dot.innerHTML = '<span></span>';
      dot.addEventListener('click', () => go(i, true));
      dotsWrap.appendChild(dot);
      return dot;
    });
    function render() {
      slides.forEach((slide, i) => {
        const active = i === index;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
        if ('inert' in slide) slide.inert = !active;
      });
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
        if (i === index) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
    }
    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    function schedule() {
      stop();
      const rotating = playing && !hoverSuspended && !focusSuspended && !swipeSuspended && onScreen && !document.hidden;
      toggleButton.classList.toggle('is-paused', !playing);
      toggleButton.setAttribute('aria-label', playing ? 'Pause automatic reviews' : 'Play automatic reviews');
      stage.setAttribute('aria-live', rotating ? 'off' : 'polite');
      if (!rotating) return;
      timer = setTimeout(() => go(index + 1), slideDuration(index));
    }
    function go(target, manual = false) {
      if (manual) {
        playing = false;
        stage.setAttribute('aria-live', 'polite');
      }
      index = (target % slides.length + slides.length) % slides.length;
      render();
      schedule();
    }
    toggleButton.addEventListener('click', () => {
      playing = !playing;
      if (playing) {
        hoverSuspended = false;
        focusSuspended = false;
      }
      schedule();
    });
    prevButton.addEventListener('click', () => go(index - 1, true));
    nextButton.addEventListener('click', () => go(index + 1, true));
    root.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1, true); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1, true); }
    });
    root.addEventListener('mouseenter', () => { hoverSuspended = true; schedule(); });
    root.addEventListener('mouseleave', () => { hoverSuspended = false; schedule(); });
    root.addEventListener('focusin', (event) => {
      if (root.contains(event.relatedTarget)) return;
      focusSuspended = true;
      schedule();
    });
    root.addEventListener('focusout', (event) => {
      if (root.contains(event.relatedTarget)) return;
      focusSuspended = false;
      schedule();
    });
    // Swipe for touch and pen only; native pan/pinch gestures are never blocked.
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let pointerId = null;
    stage.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return;
      tracking = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      swipeSuspended = true;
      schedule();
    }, { passive: true });
    stage.addEventListener('pointerup', (event) => {
      if (!tracking || event.pointerId !== pointerId) return;
      tracking = false;
      swipeSuspended = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1), true);
      else schedule();
    }, { passive: true });
    stage.addEventListener('pointercancel', () => { tracking = false; swipeSuspended = false; schedule(); }, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          onScreen = entry.isIntersecting;
          schedule();
        });
      }, { threshold: .35 });
      observer.observe(root);
    }
    reducedMotion.addEventListener('change', () => {
      if (reducedMotion.matches) playing = false;
      schedule();
    });
    render();
    schedule();
  }
  initReviews();

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navigation.querySelectorAll('a').forEach((link) => {
          if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-15% 0px -60% 0px', threshold: 0 });
    document.querySelectorAll('#about, #services, #gallery, #experience, #reviews, #contact').forEach((section) => observer.observe(section));
  }

  document.querySelector('#year').textContent = new Date().getFullYear();
})();
