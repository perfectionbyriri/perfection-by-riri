// Step 1 · Choose a service (docs/booking/DESIGN_SPEC.md §4, §7).
//
// Returns HTML strings; js/booking/main.js inserts them and wires clicks.
// Names, prices and durations come from the catalog API (Setmore), never
// from this file.

import { escapeHtml } from './html.js';

const FIRST_ROW = 3;

export function formatPrice(cents) {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function card(service, selected, index) {
  const photo = service.photo;
  const priority = index < FIRST_ROW ? ' fetchpriority="high"' : ' loading="lazy"';
  const blurb = service.blurb ? `<span class="bk-card-blurb">${escapeHtml(service.blurb)}</span>` : '';
  const deposit = service.deposit?.required
    ? `<span class="bk-card-deposit">${formatPrice(service.deposit.deposit_cents)} deposit to book</span>`
    : '';
  return `<button type="button" class="bk-card" data-service-id="${escapeHtml(service.service_id)}" aria-pressed="${selected ? 'true' : 'false'}">`
    + `<span class="bk-card-photo"><img src="${escapeHtml(photo.src)}" width="${Number(photo.width)}" height="${Number(photo.height)}" alt="${escapeHtml(photo.alt)}" style="object-position: ${escapeHtml(photo.focal)}" decoding="async"${priority}></span>`
    + `<span class="bk-card-body"><span class="bk-card-name">${escapeHtml(service.name)}</span>${blurb}`
    + `<span class="bk-card-meta">${formatDuration(service.duration_minutes)} · ${formatPrice(service.price_cents)}</span>${deposit}</span>`
    + '</button>';
}

export function renderServices({ groups, selectedId = null, focusGroup = null }) {
  const ordered = focusGroup
    ? [...groups.filter((group) => group.key === focusGroup), ...groups.filter((group) => group.key !== focusGroup)]
    : groups;
  let index = 0;
  return ordered.map((group) => {
    const headingId = `bk-group-${escapeHtml(group.key)}`;
    const cards = group.services.map((service) => card(service, service.service_id === selectedId, index++)).join('');
    return `<section class="bk-group" data-group="${escapeHtml(group.key)}" aria-labelledby="${headingId}">`
      + `<h3 class="bk-group-label" id="${headingId}">${escapeHtml(group.label)}</h3>`
      + `<div class="bk-card-grid">${cards}</div></section>`;
  }).join('');
}

export function renderCatalogUnavailable() {
  return '<p>Online booking is taking a short break. Please call (425) 845 0045 and we&rsquo;ll book you in.</p>'
    + '<a class="button button-gold" href="tel:+14258450045">Call (425) 845 0045</a>';
}
