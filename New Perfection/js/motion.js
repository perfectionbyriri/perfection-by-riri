'use strict';

/*
  Site-wide motion: smooth scrolling (Lenis) and scroll choreography (GSAP,
  ScrollTrigger, SplitText). Loaded on every page after the vendor files.

  - Headlines rise line by line from masks.
  - Content images open like a curtain and drift slowly inside their frame.
  - Copy, labels and buttons settle in, a few at a time.
  - The first section of each page plays as an intro; its photo settles and
    then moves with parallax as the page scrolls away.
  - Home only: the four services travel horizontally on desktop.

  Reduced motion, or a missing library, leaves the page fully static.
*/
(() => {
  const root = document.documentElement;
  const ready = () => {
    root.classList.remove('motion-pending');
    clearTimeout(window.__perfectionMotionFallback);
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { gsap, ScrollTrigger, SplitText, Lenis } = window;
  if (reduce || !gsap || !ScrollTrigger || !SplitText) { ready(); return; }

  gsap.registerPlugin(ScrollTrigger, SplitText);
  root.classList.add('motion-on');
  const ease = 'expo.out';
  const main = document.querySelector('main');
  if (!main) { ready(); return; }

  // Smooth scrolling. Regions with their own scrolling keep native behaviour.
  let lenis = null;
  if (Lenis) {
    lenis = new Lenis({
      lerp: 0.09,
      anchors: true,
      prevent: node => !!(node.closest && node.closest('dialog, .pmu-results-track, .main-navigation, [data-lenis-prevent]'))
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(time => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    // The results dialog and the mobile menu lock the page; pause smoothing meanwhile.
    const menuButton = document.querySelector('.menu-toggle');
    const syncLock = () => {
      const locked = document.body.classList.contains('dialog-open') || (menuButton && menuButton.getAttribute('aria-expanded') === 'true');
      if (locked) lenis.stop(); else lenis.start();
    };
    new MutationObserver(syncLock).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (menuButton) new MutationObserver(syncLock).observe(menuButton, { attributes: true, attributeFilter: ['aria-expanded'] });
  }

  // Home: services travel horizontally on desktop. Created first: pins change
  // the positions of every trigger after them.
  const services = document.querySelector('[data-h-scroll]');
  if (services) {
    gsap.matchMedia().add('(min-width: 1024px)', () => {
      services.classList.add('h-scroll-on');
      const list = services.querySelector('.signature-list');
      const track = services.querySelector('.services-track');
      const bar = services.querySelector('.services-progress span');
      const distance = () => Math.max(0, list.scrollWidth + 2 * parseFloat(getComputedStyle(track).paddingLeft) - track.clientWidth);
      const timeline = gsap.timeline({
        scrollTrigger: { trigger: services, start: 'top top', end: () => '+=' + distance(), pin: true, scrub: 1, invalidateOnRefresh: true }
      });
      timeline.to(list, { x: () => -distance(), ease: 'none' }, 0);
      if (bar) timeline.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'none' }, 0);
      // Keyboard: bring a focused panel into view.
      const onFocus = event => {
        const item = event.target.closest('li');
        const st = timeline.scrollTrigger;
        const total = distance();
        if (!item || !st || !total) return;
        const progress = Math.min(1, Math.max(0, (item.offsetLeft - (track.clientWidth - item.offsetWidth) / 2) / total));
        const y = st.start + progress * (st.end - st.start);
        services.querySelector('.story-stage').scrollLeft = 0;
        if (lenis) lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y);
      };
      list.addEventListener('focusin', onFocus);
      ScrollTrigger.refresh();
      return () => {
        list.removeEventListener('focusin', onFocus);
        services.classList.remove('h-scroll-on');
      };
    });
  }

  const intro = main.querySelector(':scope > section');
  const inIntro = el => intro && intro.contains(el);
  const skip = el => el.closest('dialog, nav, header, noscript, .review-slide:not(.is-active), [hidden]');

  // Headlines: lines rise from masks.
  const headings = [...main.querySelectorAll('h1, h2, .story-quote, .le-result-quote')]
    .filter(el => !skip(el) && !el.classList.contains('eyebrow'));
  headings.forEach(el => {
    const first = inIntro(el);
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'm-line',
      autoSplit: true,
      onSplit: self => gsap.from(self.lines, {
        yPercent: 115,
        duration: first ? 1.4 : 1.25,
        ease,
        stagger: 0.09,
        delay: first ? 0.15 : 0,
        scrollTrigger: first ? undefined : { trigger: el, start: 'top 88%', once: true }
      })
    });
  });
  ready();

  // Copy, labels, buttons: settle in a few at a time.
  const textSelector = 'p, li, blockquote, dt, dd, figcaption, summary, table, .button, .faq-item, .review-arrows, .review-dots';
  const candidates = [...main.querySelectorAll(textSelector)].filter(el => !skip(el) && !el.closest('h1, h2, .story-quote'));
  const texts = candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)));
  const introTexts = texts.filter(inIntro);
  const bodyTexts = texts.filter(el => !inIntro(el));
  gsap.from(introTexts, { y: 26, opacity: 0, duration: 1.2, ease, stagger: 0.08, delay: 0.45, clearProps: 'transform,opacity' });
  gsap.set(bodyTexts, { y: 30, opacity: 0 });
  ScrollTrigger.batch(bodyTexts, {
    start: 'top 92%',
    once: true,
    onEnter: batch => gsap.to(batch, { y: 0, opacity: 1, duration: 1.1, ease, stagger: 0.07, overwrite: true, clearProps: 'transform,opacity' })
  });

  // Images.
  [...main.querySelectorAll('img')].filter(img => !skip(img)).forEach(img => {
    const frame = img.parentElement;
    img.setAttribute('data-motion', '');
    if (inIntro(img)) {
      // Intro photo: visible at once (it is the page's main image), settles, then drifts.
      gsap.fromTo(img, { scale: 1.16 }, { scale: 1.04, duration: 2.6, ease });
      gsap.to(img, { yPercent: 12, ease: 'none', scrollTrigger: { trigger: intro, start: 'top top', end: 'bottom top', scrub: true } });
      return;
    }
    const clipped = ['hidden', 'clip'].includes(getComputedStyle(frame).overflow);
    if (clipped && img.offsetWidth > 120) {
      gsap.fromTo(frame, { clipPath: 'inset(100% 0% 0% 0%)' }, {
        clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'expo.inOut',
        scrollTrigger: { trigger: frame, start: 'top 90%', once: true },
        onComplete: () => gsap.set(frame, { clearProps: 'clipPath' })
      });
      gsap.fromTo(img, { scale: 1.3 }, { scale: 1.1, duration: 1.8, ease, scrollTrigger: { trigger: frame, start: 'top 90%', once: true } });
      gsap.fromTo(img, { yPercent: -4 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: frame, start: 'top bottom', end: 'bottom top', scrub: true } });
    } else {
      gsap.from(img, { opacity: 0, scale: 1.04, duration: 1.4, ease, scrollTrigger: { trigger: img, start: 'top 92%', once: true } });
    }
  });

  // Intro copy lifts away as the first section scrolls off.
  const introCopy = intro && intro.querySelector('.hero-content, .le-hero-body, .pmu-hero-body, .faq-hero-copy');
  if (introCopy) {
    gsap.to(introCopy, { y: -70, opacity: 0.15, ease: 'none', scrollTrigger: { trigger: intro, start: 'top top', end: 'bottom top', scrub: true } });
  }

  // Late layout changes (fonts, lazy images, the services pin) move trigger
  // positions. Re-measure, then land on the URL's #anchor again, because the
  // browser's own jump can happen before (or be undone by) that re-measure.
  window.addEventListener('load', () => {
    ScrollTrigger.refresh();
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'instant', block: 'start' }));
  });
})();
