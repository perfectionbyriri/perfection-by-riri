'use strict';

// Meta Pixel, dataset 1864195751687018 (docs/superpowers/specs/2026-11-26-ads-tracking-design.md).
// PageView on every page. The booking conversion event is sent from
// js/booking/ad-tags.js. A first-party file, not an inline snippet, so the
// /book/ Content-Security-Policy needs no new script hash.
(function (window, document) {
  if (window.fbq) return;
  var fbq = window.fbq = function () {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
    else fbq.queue.push(arguments);
  };
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://connect.facebook.net/en_US/fbevents.js';
  var first = document.getElementsByTagName('script')[0];
  if (first && first.parentNode) first.parentNode.insertBefore(script, first);
  else document.head.appendChild(script);

  try {
    fbq('init', '1864195751687018');
    fbq('track', 'PageView');
  } catch (error) { /* the pixel must never break the page */ }
})(window, document);
