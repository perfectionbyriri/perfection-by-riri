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
    // One language for every page: text comes into focus — from a soft blur to
    // sharp, with a short rise. Brisk, never slow. Only opacity, transform and
    // filter animate, and only once per element.
    const motion = {
      ease: 'cubic-bezier(.22,1,.36,1)',
      header: 600,
      group: 450,
      heading: 720,
      section: 650,
      media: 900,
      mediaSettle: 1400,
      rise: 16,
      headingRise: 18,
      blur: 10,
      textBlur: 6,
      step: 70
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
      // Write the final state inline, then drop the held animation (and its filter).
      const done = () => { animations.delete(animation); settle(element); animation.cancel(); };
      if (animation.finished && typeof animation.finished.then === 'function') animation.finished.then(done, done);
      else done();
    };
    // Children of a group play in sequence; they are not armed themselves, so
    // they only need a backwards fill until their turn comes.
    const play = (element, frames, duration, delay) => {
      if (!element.animate) return;
      const animation = element.animate(frames, { duration: duration, delay: delay, easing: motion.ease, fill: 'backwards' });
      animations.add(animation);
      const done = () => animations.delete(animation);
      if (animation.finished && typeof animation.finished.then === 'function') animation.finished.then(done, done);
    };
    const isMedia = (element) => !!element.querySelector('img, video') && (element.matches('figure') || /media|photo|portrait|image/.test(element.className));
    const reveal = (element, delay) => {
      if (!element) return;
      delay = delay || 0;
      if (headingTargets && element.matches(headingTargets)) {
        // Editorial cascade: label, headline rising out of its own clip, then copy.
        animated(element, [{ opacity: 0 }, { opacity: 1 }], motion.group, delay, motion.ease);
        Array.prototype.forEach.call(element.children, (child, index) => {
          const headline = /^H[1-3]$/.test(child.tagName);
          const at = delay + index * motion.step;
          if (headline) {
            play(child, [
              { opacity: 0, transform: 'translateY(' + motion.headingRise + 'px)', filter: 'blur(' + motion.blur + 'px)' },
              { opacity: 1, transform: 'none', filter: 'blur(0px)' }
            ], motion.heading, at);
          } else {
            play(child, [
              { opacity: 0, transform: 'translateY(' + motion.rise / 2 + 'px)', filter: 'blur(' + motion.textBlur + 'px)' },
              { opacity: 1, transform: 'none', filter: 'blur(0px)' }
            ], motion.section, at);
          }
        });
        return;
      }
      if (isMedia(element) && element.closest('main > section:first-of-type, main > :first-child')) {
        // The page's main photo is visible from the first paint; it only settles.
        const photo = element.querySelector('img, video');
        if (photo) play(photo, [{ transform: 'scale(1.06)' }, { transform: 'none' }], motion.mediaSettle, 0);
        settle(element);
        return;
      }
      if (isMedia(element)) {
        // Photos fade up and settle inside their frame.
        animated(element, [{ opacity: 0 }, { opacity: 1 }], motion.media, delay, motion.ease);
        const photo = element.querySelector('img, video');
        if (photo) play(photo, [{ transform: 'scale(1.08)' }, { transform: 'none' }], motion.mediaSettle, delay);
        return;
      }
      animated(element, [
        { opacity: 0, transform: 'translateY(' + motion.rise + 'px)', filter: 'blur(' + motion.textBlur + 'px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0px)' }
      ], motion.section, delay, motion.ease);
    };

    animated(document.querySelector('.site-header'), [{ opacity: 0 }, { opacity: 1 }], motion.header, 60, motion.ease);

    if ('IntersectionObserver' in window) {
      const compact = window.innerWidth <= 800;
      const reveals = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveals.unobserve(entry.target);
          const element = entry.target;
          const child = staggerClasses.length > 0 && staggerClasses.some((name) => element.classList.contains(name));
          const delay = child && element.parentElement ? Math.min(Array.prototype.indexOf.call(element.parentElement.children, element), 4) * motion.step : 0;
          reveal(element, delay);
        });
      }, { rootMargin: '0px 0px -10% 0px', threshold: .1 });
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
