// Step 1 · Choose a service (docs/booking/DESIGN_SPEC.md §4, §7).
//
// Returns HTML strings; js/booking/main.js inserts them and wires clicks.
// Text-only editorial service menu (no photos): names, prices and durations
// come from the catalog API (Setmore), never from this file.

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

function categoryNav(groups) {
  if (groups.length < 2) return '';
  const items = groups.map((group, index) => `<button type="button" class="bk-group-tab${index === 0 ? ' is-active' : ''}" data-group-jump="${escapeHtml(group.key)}">${escapeHtml(group.label)}</button>`).join('');
  return `<nav class="bk-group-nav" aria-label="Service categories">${items}</nav>`;
}

export function renderServices({ groups, selectedId = null, focusGroup = null }) {
  const ordered = focusGroup
    ? [...groups.filter((group) => group.key === focusGroup), ...groups.filter((group) => group.key !== focusGroup)]
    : groups;
  let index = 0;
  const sections = ordered.map((group) => {
    const headingId = `bk-group-${escapeHtml(group.key)}`;
    const cards = group.services.map((service) => card(service, service.service_id === selectedId, index++)).join('');
    return `<section class="bk-group" data-group="${escapeHtml(group.key)}" aria-labelledby="${headingId}">`
      + `<h3 class="bk-group-label" id="${headingId}">${escapeHtml(group.label)}<span class="bk-group-count">${group.services.length}</span></h3>`
      + `<div class="bk-card-grid">${cards}</div></section>`;
  }).join('');
  return `${categoryNav(ordered)}${sections}`;
}

export function renderCatalogUnavailable() {
  return '<p>Online booking is taking a short break. Please call (425) 845 0045 and we&rsquo;ll book you in.</p>'
    + '<a class="button button-gold" href="tel:+14258450045">Call (425) 845 0045</a>';
}
