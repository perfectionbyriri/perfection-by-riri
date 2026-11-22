// Booking flow entry (docs/booking/DESIGN_SPEC.md §3–§5).
//
// Loaded as an ES module from /book/. Each step's rendering lives in its own
// module; this file wires them to the page.

const app = document.querySelector('[data-booking-app]');
if (app) document.documentElement.classList.add('bk-enhanced');
