// Step 1 · Choose a service (docs/booking/DESIGN_SPEC.md §4, §7).
//
// Returns HTML strings; js/booking/main.js inserts them and wires clicks.
// Text-only editorial accordion menu (no photos): categories start collapsed
// unless deep-linked or holding the chosen service, so clients click a
// category first to reveal its treatments. Names, prices and durations come
// strictly from the catalog API (Setmore).

import { escapeHtml } from './html.js';

const MAX_STAGGER = 10;

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

function minPriceCents(services) {
  let min = Infinity;
  for (const service of services) {
    if (typeof service.price_cents === 'number' && service.price_cents < min) {
      min = service.price_cents;
    }
  }
  return Number.isFinite(min) ? min : null;
}

function card(service, selected, index) {
  const blurb = service.blurb ? `<span class="bk-card-blurb">${escapeHtml(service.blurb)}</span>` : '';
  const deposit = service.deposit?.required
    ? `<span class="bk-card-deposit">${formatPrice(service.deposit.deposit_cents)} deposit to book</span>`
    : '';
  const stagger = Math.min(index, MAX_STAGGER);
  return `<button type="button" class="bk-card" data-service-id="${escapeHtml(service.service_id)}" aria-pressed="${selected ? 'true' : 'false'}" style="--bk-i: ${stagger}">`
    + `<span class="bk-card-body"><span class="bk-card-name">${escapeHtml(service.name)}</span>${blurb}${deposit}</span>`
    + `<span class="bk-card-aside"><span class="bk-card-meta">${formatDuration(service.duration_minutes)} · ${formatPrice(service.price_cents)}</span>`
    + '<span class="bk-card-indicator" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" focusable="false"><path d="M3 8.5 6.4 11.8 13 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/></svg></span></span>'
    + '</button>';
}

export function renderServices({ groups, selectedId = null, focusGroup = null, openGroup = undefined }) {
  const ordered = focusGroup
    ? [...groups.filter((group) => group.key === focusGroup), ...groups.filter((group) => group.key !== focusGroup)]
    : groups;
  const selectedGroupKey = selectedId
    ? ordered.find((group) => group.services.some((service) => service.service_id === selectedId))?.key ?? null
    : null;
  const initialOpenKey = openGroup !== undefined ? openGroup : (selectedGroupKey ?? focusGroup ?? null);

  const sections = ordered.map((group, groupIndex) => {
    const key = escapeHtml(group.key);
    const headingId = `bk-group-${key}`;
    const panelId = `bk-panel-${key}`;
    const isOpen = group.key === initialOpenKey;
    const hasSelected = group.services.some((service) => service.service_id === selectedId);
    const selectedService = hasSelected ? group.services.find((service) => service.service_id === selectedId) : null;
    const count = group.services.length;
    const countText = `${count} ${count === 1 ? 'service' : 'services'}`;
    const minPrice = minPriceCents(group.services);
    const metaText = minPrice !== null ? `${countText} · From ${formatPrice(minPrice)}` : countText;
    const numeral = String(groupIndex + 1).padStart(2, '0');
    const chosenNote = selectedService
      ? `<span class="bk-cat-chosen">Selected · ${escapeHtml(selectedService.name)}</span>`
      : '';
    const cards = group.services.map((service, idx) => card(service, service.service_id === selectedId, idx)).join('');

    return `<section class="bk-group${isOpen ? ' is-open' : ''}${hasSelected ? ' has-selected' : ''}" data-group="${key}" style="--bk-g: ${Math.min(groupIndex, 8)}">`
      + `<h3 class="bk-group-label" id="${headingId}">`
      + `<button type="button" class="bk-cat-trigger" data-group-toggle="${key}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="${panelId}">`
      + `<span class="bk-cat-num" aria-hidden="true">${numeral}</span>`
      + `<span class="bk-cat-copy"><span class="bk-cat-title">${escapeHtml(group.label)}</span>${chosenNote}</span>`
      + `<span class="bk-cat-right"><span class="bk-cat-meta">${metaText}</span>`
      + '<span class="bk-cat-icon" aria-hidden="true"><span></span><span></span></span></span>'
      + '</button></h3>'
      + `<div class="bk-cat-panel" id="${panelId}" role="region" aria-labelledby="${headingId}"${isOpen ? '' : ' inert'}>`
      + `<div class="bk-cat-panel-inner"><div class="bk-card-grid">${cards}</div></div>`
      + '</div></section>';
  }).join('');

  return `<p class="bk-step-lead">Select a service category to explore available treatments.</p>`
    + `<div class="bk-accordion">${sections}</div>`;
}

export function renderCatalogUnavailable() {
  return '<p>Online booking is taking a short break. Please call (425) 845 0045 and we&rsquo;ll book you in.</p>'
    + '<a class="button button-gold" href="tel:+14258450045">Call (425) 845 0045</a>';
}
