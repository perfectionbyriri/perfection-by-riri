'use strict';

/*
  Shared page-entry reveal system for the standalone content routes
  (/contact/ and /faq/).

  It is the exact reveal pass the Contact route already used, lifted out so a
  second route can join the same system instead of cloning an almost-identical
  animation. Each route still supplies its own target selectors and keeps its
  own page script; this file owns only the shared timing, curves and settle
  model.

  Contract:
    - The host document sets `html.motion-armed` from a tiny inline script in
      <head> (before first paint) unless reduced motion is requested. The
      matching start states live in the route's stylesheet.
    - The route script calls PerfectionPageEntry.init({ headingTargets, targets,
      staggerClass }). `targets`/`headingTargets` are CSS selector strings.
    - Reduced-motion and no-JS visitors are never hidden: the settle path simply
      clears the armed state so content renders fully.
*/
(() => {
  const init = (options = {}) => {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const supportsAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
    const armed = root.classList.contains('motion-armed') && window.__perfectionMotionFallbackFired !== true;
    const motionEnabled = armed && supportsAnimate && !reducedMotion.matches;
    if (!motionEnabled) {
      root.classList.remove('motion-armed');
      clearTimeout(window.__perfectionMotionFallback);
      return;
    }
    const motionStyle = getComputedStyle(root);
    const readToken = (name, fallback) => {
      const value = parseFloat(motionStyle.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const motion = {
      revealHero: readToken('--duration-reveal-hero', 700),
      revealHeading: readToken('--duration-reveal-heading', 820),
      revealSection: readToken('--duration-reveal-section', 780),
      riseHero: readToken('--reveal-rise-hero', 14),
      riseHeading: readToken('--reveal-rise-heading', 20),
      riseSection: readToken('--reveal-rise-section', 22),
      staggerChild: readToken('--stagger-child', 55),
      easeReveal: motionStyle.getPropertyValue('--ease-reveal').trim() || 'cubic-bezier(.22,1,.36,1)'
    };
    const animations = new Set();
    window.addEventListener('pagehide', () => animations.forEach((animation) => animation.finish()));
    if (options.finishOnFocus) {
      document.addEventListener('focusin', (event) => {
        animations.forEach((animation) => {
          if (animation.effect && animation.effect.target === event.target) animation.finish();
        });
      });
    }

    const headingTargets = options.headingTargets || '';
    const targets = options.targets ? document.querySelectorAll(options.targets) : [];
    const staggerClasses = Array.isArray(options.staggerClasses)
      ? options.staggerClasses
      : (options.staggerClass ? [options.staggerClass] : []);
    let settledCount = 0;
    const settleTotal = 1 + targets.length;

    const settle = (element) => {
      if (!element) return;
      element.style.opacity = '1';
      element.style.transform = 'none';
      settledCount += 1;
      if (settledCount >= settleTotal) root.classList.remove('motion-armed');
    };
    const animated = (element, frames, duration, delay, easing) => {
      if (!element) return;
      if (reducedMotion.matches || !element.animate) { settle(element); return; }
      const animation = element.animate(frames, { duration: duration, delay: delay, easing: easing, fill: 'forwards' });
      animations.add(animation);
      const done = () => { animations.delete(animation); settle(element); };
      if (animation.finished && typeof animation.finished.then === 'function') animation.finished.then(done, done);
      else done();
    };
    const reveal = (element, delay) => {
      if (!element) return;
      const isHeading = headingTargets && element.matches(headingTargets);
      const rise = isHeading ? motion.riseHeading : motion.riseSection;
      const duration = isHeading ? motion.revealHeading : motion.revealSection;
      animated(element, [
        { opacity: 0, transform: 'translateY(' + rise + 'px)' },
        { opacity: 1, transform: 'none' }
      ], duration, delay || 0, motion.easeReveal);
    };

    animated(document.querySelector('.site-header'), [{ opacity: 0 }, { opacity: 1 }], motion.revealHero, 60, motion.easeReveal);

    if ('IntersectionObserver' in window) {
      const compact = window.innerWidth <= 800;
      const reveals = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveals.unobserve(entry.target);
          const element = entry.target;
          const child = staggerClasses.length > 0 && staggerClasses.some((name) => element.classList.contains(name));
          const delay = child && element.parentElement ? Math.min(Array.prototype.indexOf.call(element.parentElement.children, element), 3) * motion.staggerChild : 0;
          reveal(element, delay);
        });
      }, compact ? { rootMargin: '0px 0px -8% 0px', threshold: .12 } : { rootMargin: '0px 0px -12% 0px', threshold: .15 });
      targets.forEach((element) => {
        const box = element.getBoundingClientRect();
        if (compact ? box.bottom > 0 : box.top >= window.innerHeight * 0.7) reveals.observe(element);
        else reveal(element, 0);
      });
      reducedMotion.addEventListener('change', () => {
        if (!reducedMotion.matches) return;
        reveals.disconnect();
        root.classList.remove('motion-armed');
      });
    } else {
      targets.forEach((element) => reveal(element, 0));
    }
    clearTimeout(window.__perfectionMotionFallback);
  };

  window.PerfectionPageEntry = { init };
})();
