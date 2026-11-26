'use strict';

// Google Ads tag for the "Setmore - Confirmed Paid Booking" conversion, which
// the booking confirmation view sends (js/booking/ad-tags.js).
try {
  if (typeof window.gtag === 'function') window.gtag('config', 'AW-16731910684');
} catch (error) { /* analytics must never break the page */ }

// Measure intent on the site: booking_click fires on links to the /book/ flow.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link || typeof window.gtag !== 'function') return;

  let eventName;
  if (link.hasAttribute('data-booking-url')) eventName = 'booking_click';
  else if (link.getAttribute('href').toLowerCase().startsWith('tel:')) eventName = 'phone_click';
  else if (link.href.startsWith('https://maps.app.goo.gl/2zzJp92GvUAGifaV8')) eventName = 'directions_click';
  if (!eventName) return;

  const area = link.closest('header, footer, section, .announcement');
  window.gtag('event', eventName, {
    link_location: area ? (area.id || area.tagName.toLowerCase()) : 'other',
    transport_type: 'beacon'
  });
}, true);

