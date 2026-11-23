// Step 1 · Choose a service (docs/booking/DESIGN_SPEC.md §4, §7).
//
// Returns HTML strings; js/booking/main.js inserts them and wires clicks.
// Text-only editorial accordion menu (no photos) matching the four categories
// of the site navigation menu (Lash Extensions, Permanent Makeup, Lash Lift,
// Brow Lamination & Tint). Categories start collapsed unless deep-linked or
// holding the chosen service. Multi-part categories (Lash Extensions, PMU)
// use compact sub-tabs so each view stays short and easy to scan.

import { escapeHtml } from './html.js';

const MAX_STAGGER = 10;

// Exact order, titles and descriptors from the site's Services menu.
const SITE_MENU = [
  {
    key: 'lash-extensions',
    title: 'Lash Extensions',
    subtitle: 'Custom lash design',
    defaultLabel: 'Lash extensions',
    sourceKeys: ['lash-extensions', 'wispy-lashes', 'lash-refills']
  },
  {
    key: 'permanent-makeup',
    title: 'Permanent Makeup',
    subtitle: 'Brows · Lips · Eyeliner',
    defaultLabel: 'Permanent makeup',
    sourceKeys: ['permanent-makeup']
  },
  {
    key: 'lash-lift',
    title: 'Lash Lift',
    subtitle: 'Natural lift & definition',
    defaultLabel: 'Lash lift',
    sourceKeys: ['lash-lift']
  },
  {
    key: 'brows',
    title: 'Brow Lamination & Tint',
    subtitle: 'Shape · Laminate · Define',
    defaultLabel: 'Brows',
    sourceKeys: ['brows']
  }
];

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

// Logical ordering helpers based on service names (works with both mock IDs
// and live Setmore UUIDs).
function lashStyleRank(name) {
  const lower = name.toLowerCase();
  if (lower.includes('classic')) return 10;
  if (lower.includes('hybrid')) return 20;
  if (lower.includes('mega')) return 40;
  if (lower.includes('volume')) return 30;
  if (lower.includes('wet')) return 50;
  return 90;
}

function refillWeeksRank(name) {
  const match = name.match(/(\d+)\s*week/i);
  return match ? Number(match[1]) : 0;
}

function sortLashList(list) {
  return [...list].sort((a, b) => (
    lashStyleRank(a.name) - lashStyleRank(b.name)
    || refillWeeksRank(a.name) - refillWeeksRank(b.name)
  ));
}

function pmuRank(name) {
  const lower = name.toLowerCase();
  if (lower.includes('brow')) return 10;
  if (lower.includes('lip')) return 20;
  if (lower.includes('lash line')) return 30;
  if (lower.includes('bottom')) return 50;
  if (lower.includes('eyeliner')) return 40;
  return 90;
}

function organizeCategoryServices(categoryKey, matchedGroups) {
  const services = matchedGroups.flatMap((group) => group.services);
  if (categoryKey === 'lash-extensions') {
    const fullSets = [];
    const wispyFull = [];
    const refills = [];
    const wispyRefills = [];
    const removal = [];
    // The Setmore source group decides first; name keywords only split services
    // the group does not classify (the main lash-extensions group or unknown ones).
    const entries = matchedGroups.flatMap((group) => group.services.map((service) => ({ service, groupKey: group.key })));
    for (const { service, groupKey } of entries) {
      const lower = service.name.toLowerCase();
      if (groupKey === 'lash-refills') (lower.includes('wispy') ? wispyRefills : refills).push(service);
      else if (groupKey === 'wispy-lashes') (lower.includes('refill') ? wispyRefills : wispyFull).push(service);
      else if (lower.includes('removal')) removal.push(service);
      else if (lower.includes('refill') && lower.includes('wispy')) wispyRefills.push(service);
      else if (lower.includes('refill')) refills.push(service);
      else if (lower.includes('wispy')) wispyFull.push(service);
      else fullSets.push(service);
    }
    return [
      { key: 'full-sets', label: 'Full Sets', services: sortLashList(fullSets) },
      { key: 'wispy-sets', label: 'Wispy Full Sets', services: sortLashList(wispyFull) },
      { key: 'refills', label: 'Refills', services: sortLashList(refills) },
      { key: 'wispy-refills', label: 'Wispy Refills', services: sortLashList(wispyRefills) },
      { key: 'removal', label: 'Removal', services: removal }
    ].filter((sub) => sub.services.length > 0);
  }

  if (categoryKey === 'permanent-makeup') {
    const initial = [];
    const touchUps = [];
    for (const service of services) {
      if (/touch[-\s]?up/i.test(service.name)) touchUps.push(service);
      else initial.push(service);
    }
    const sortPmu = (list) => [...list].sort((a, b) => pmuRank(a.name) - pmuRank(b.name));
    return [
      { key: 'pmu-initial', label: 'Initial Sessions', services: sortPmu(initial) },
      { key: 'pmu-touchup', label: 'Touch-Ups', services: sortPmu(touchUps) }
    ].filter((sub) => sub.services.length > 0);
  }

  if (categoryKey === 'lash-lift') {
    const sorted = [...services].sort((a, b) => (
      Number(/tint/i.test(a.name)) - Number(/tint/i.test(b.name))
      || (a.price_cents ?? 0) - (b.price_cents ?? 0)
    ));
    return [{ key: 'lash-lift', label: '', services: sorted }];
  }

  if (categoryKey === 'brows') {
    const rank = (name) => {
      const lower = name.toLowerCase();
      if (lower.includes('lamination') && lower.includes('tint')) return 10;
      if (lower.includes('lamination')) return 20;
      if (lower.includes('tint')) return 30;
      if (lower.includes('shap')) return 40;
      return 90;
    };
    const sorted = [...services].sort((a, b) => rank(a.name) - rank(b.name));
    return [{ key: 'brows', label: '', services: sorted }];
  }

  return [{ key: categoryKey, label: '', services }];
}

function buildMenuCategories(groups) {
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const consumed = new Set();
  const categories = [];

  for (const entry of SITE_MENU) {
    const matched = entry.sourceKeys.map((key) => byKey.get(key)).filter(Boolean);
    if (!matched.length) continue;
    for (const group of matched) consumed.add(group.key);
    const primary = byKey.get(entry.key);
    const title = primary && primary.label && primary.label !== entry.defaultLabel
      ? primary.label
      : entry.title;
    const subgroups = organizeCategoryServices(entry.key, matched);
    categories.push({
      key: entry.key,
      title,
      subtitle: entry.subtitle,
      sourceKeys: matched.map((group) => group.key),
      subgroups,
      services: subgroups.flatMap((sub) => sub.services)
    });
  }

  for (const group of groups) {
    if (consumed.has(group.key)) continue;
    categories.push({
      key: group.key,
      title: group.label,
      subtitle: '',
      sourceKeys: [group.key],
      subgroups: [{ key: group.key, label: '', services: group.services }],
      services: group.services
    });
  }

  return categories;
}

function card(service, selected, index) {
  const blurb = service.blurb ? `<span class="bk-card-blurb">${escapeHtml(service.blurb)}</span>` : '';
  const stagger = Math.min(index, MAX_STAGGER);
  return `<button type="button" class="bk-card" data-service-id="${escapeHtml(service.service_id)}" aria-pressed="${selected ? 'true' : 'false'}" style="--bk-i: ${stagger}">`
    + `<span class="bk-card-body"><span class="bk-card-name">${escapeHtml(service.name)}</span>${blurb}</span>`
    + `<span class="bk-card-aside"><span class="bk-card-meta">${formatDuration(service.duration_minutes)} · ${formatPrice(service.price_cents)}</span>`
    + '<span class="bk-card-indicator" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" focusable="false"><path d="M3 8.5 6.4 11.8 13 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter"/></svg></span></span>'
    + '</button>';
}

function defaultSubgroupKey(category, selectedId, focusGroup) {
  if (selectedId) {
    const match = category.subgroups.find((sub) => sub.services.some((s) => s.service_id === selectedId));
    if (match) return match.key;
  }
  if (focusGroup === 'wispy-lashes') {
    const wispy = category.subgroups.find((sub) => sub.key === 'wispy-sets');
    if (wispy) return wispy.key;
  }
  if (focusGroup === 'lash-refills') {
    const refills = category.subgroups.find((sub) => sub.key === 'refills');
    if (refills) return refills.key;
  }
  return category.subgroups[0]?.key ?? null;
}

export function renderServices({ groups, selectedId = null, focusGroup = null, openGroup = undefined }) {
  const categories = buildMenuCategories(groups);
  const focusCategoryKey = focusGroup
    ? categories.find((cat) => cat.key === focusGroup || cat.sourceKeys.includes(focusGroup))?.key ?? null
    : null;
  const ordered = focusCategoryKey
    ? [...categories.filter((cat) => cat.key === focusCategoryKey), ...categories.filter((cat) => cat.key !== focusCategoryKey)]
    : categories;
  const selectedCategoryKey = selectedId
    ? ordered.find((cat) => cat.services.some((service) => service.service_id === selectedId))?.key ?? null
    : null;
  const initialOpenKey = openGroup !== undefined ? openGroup : (selectedCategoryKey ?? focusCategoryKey ?? null);

  const sections = ordered.map((category, groupIndex) => {
    const key = escapeHtml(category.key);
    const headingId = `bk-group-${key}`;
    const panelId = `bk-panel-${key}`;
    const isOpen = category.key === initialOpenKey;
    const selectedService = selectedId
      ? category.services.find((service) => service.service_id === selectedId) ?? null
      : null;
    const count = category.services.length;
    const countText = `${count} ${count === 1 ? 'service' : 'services'}`;
    const minPrice = minPriceCents(category.services);
    const metaText = minPrice !== null ? `${countText} · From ${formatPrice(minPrice)}` : countText;
    const numeral = String(groupIndex + 1).padStart(2, '0');
    const subtitle = category.subtitle
      ? `<span class="bk-cat-desc">${escapeHtml(category.subtitle)}</span>`
      : '';
    const mobileMeta = `<span class="bk-cat-meta-mobile">${metaText}</span>`;
    const chosenNote = selectedService
      ? `<span class="bk-cat-chosen">Selected · ${escapeHtml(selectedService.name)}</span>`
      : '';

    const hasSubtabs = category.subgroups.length > 1;
    const activeSubKey = defaultSubgroupKey(category, selectedId, focusGroup);
    const subtabs = hasSubtabs
      ? `<div class="bk-subtabs" role="group" aria-label="${escapeHtml(category.title)} sections">`
        + category.subgroups.map((sub) => {
          const active = sub.key === activeSubKey;
          return `<button type="button" class="bk-subtab" data-subtab="${escapeHtml(sub.key)}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(sub.label)}<span class="bk-subtab-count">${sub.services.length}</span></button>`;
        }).join('')
        + '</div>'
      : '';

    const listMarkup = category.subgroups.map((sub) => {
      const hidden = hasSubtabs && sub.key !== activeSubKey ? ' hidden' : '';
      const rows = sub.services.map((service, idx) => card(service, service.service_id === selectedId, idx)).join('');
      return `<div class="bk-subpanel" data-subpanel="${escapeHtml(sub.key)}"${hidden}><div class="bk-card-grid">${rows}</div></div>`;
    }).join('');

    return `<section class="bk-group${isOpen ? ' is-open' : ''}${selectedService ? ' has-selected' : ''}" data-group="${key}" style="--bk-g: ${Math.min(groupIndex, 8)}">`
      + `<h3 class="bk-group-label" id="${headingId}">`
      + `<button type="button" class="bk-cat-trigger" data-group-toggle="${key}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="${panelId}">`
      + `<span class="bk-cat-num" aria-hidden="true">${numeral}</span>`
      + `<span class="bk-cat-copy"><span class="bk-cat-title">${escapeHtml(category.title)}</span>${subtitle}${mobileMeta}${chosenNote}</span>`
      + `<span class="bk-cat-right"><span class="bk-cat-meta">${metaText}</span>`
      + '<span class="bk-cat-icon" aria-hidden="true"><span></span><span></span></span></span>'
      + '</button></h3>'
      + `<div class="bk-cat-panel" id="${panelId}" role="region" aria-labelledby="${headingId}"${isOpen ? '' : ' inert'}>`
      + `<div class="bk-cat-panel-inner">${subtabs}${listMarkup}</div>`
      + '</div></section>';
  }).join('');

  return `<p class="bk-step-lead">Select a service category to explore available treatments.</p>`
    + `<div class="bk-accordion">${sections}</div>`;
}

export function renderCatalogUnavailable() {
  return '<p>Online booking is taking a short break. Please call (425) 845 0045 and we&rsquo;ll book you in.</p>'
    + '<a class="button button-gold" href="tel:+14258450045">Call (425) 845 0045</a>';
}
