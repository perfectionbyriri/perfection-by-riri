// Booking flow entry (docs/booking/DESIGN_SPEC.md §3–§5).
//
// Loaded as an ES module from /book/. Rendering lives in the render-*.js
// modules (pure functions, unit-tested); this file owns the DOM: it inserts
// their markup, wires events, moves focus and keeps the summary current.

import { createApi } from './api.js';
import { formatDuration, formatPrice, renderCatalogUnavailable, renderServices } from './render-services.js';
import { defaultDay, renderSlotsError, renderSlotsLoading, renderWeek } from './render-slots.js';
import { createState, parseDeepLink, resolveDeepLink } from './state.js';

const STEP_NAMES = ['Service', 'Date & time', 'Your details', 'Deposit & confirm'];

const app = document.querySelector('[data-booking-app]');

if (app) {
  document.documentElement.classList.add('bk-enhanced');

  const api = createApi();
  const elements = {
    step: document.getElementById('bk-step'),
    banner: document.getElementById('bk-banner'),
    status: document.getElementById('bk-status'),
    count: document.getElementById('bk-step-count'),
    progress: [...document.querySelectorAll('.bk-progress-item')],
    summary: {
      service: document.querySelector('[data-summary="service"]'),
      time: document.querySelector('[data-summary="time"]'),
      deposit: document.querySelector('[data-summary="deposit"]')
    }
  };
  const state = createState({
    step: 1, catalog: null, serviceId: null, focusGroup: null,
    week: null, weekStart: null, selectedDate: null, startAt: null, startLabel: null
  });
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const findService = (id) => {
    for (const group of state.get().catalog?.groups ?? []) {
      const service = group.services.find((item) => item.service_id === id);
      if (service) return service;
    }
    return null;
  };

  const announce = (text) => { elements.status.textContent = text; };

  function showBanner(html) {
    elements.banner.innerHTML = html;
    elements.banner.hidden = false;
    elements.banner.focus({ preventScroll: false });
  }

  function hideBanner() {
    elements.banner.hidden = true;
    elements.banner.innerHTML = '';
  }

  function updateProgress(step) {
    elements.count.textContent = `Step ${step} of 4 — ${STEP_NAMES[step - 1]}`;
    elements.progress.forEach((item, index) => {
      if (index + 1 === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-done', index + 1 < step);
    });
  }

  function updateSummary() {
    const service = findService(state.get().serviceId);
    elements.summary.service.textContent = service
      ? `${service.name} · ${formatDuration(service.duration_minutes)} · ${formatPrice(service.price_cents)}`
      : 'Not chosen yet';
    const { startAt, startLabel, week } = state.get();
    const day = week?.days.find((item) => startAt && startAt.startsWith(item.date));
    elements.summary.time.textContent = startAt && day
      ? `${day.weekday}, ${new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })} · ${startLabel}`
      : 'Not chosen yet';
    elements.summary.deposit.textContent = service
      ? (service.deposit.required ? `${formatPrice(service.deposit.total_cents)} due today` : 'No deposit needed')
      : '—';
  }

  function focusTitle() {
    const title = elements.step.querySelector('.bk-step-title');
    if (title) title.focus({ preventScroll: false });
  }

  function renderStep1({ focus = false } = {}) {
    const { catalog, serviceId, focusGroup } = state.get();
    updateProgress(1);
    const hint = serviceId ? '' : '<p class="bk-hint" id="bk-continue-hint">Choose a service to continue.</p>';
    elements.step.innerHTML = '<h2 class="bk-step-title" tabindex="-1">Choose a service</h2>'
      + renderServices({ groups: catalog.groups, selectedId: serviceId, focusGroup })
      + `<div class="bk-actions">${hint}<button type="button" class="button button-gold" data-action="continue"`
      + `${serviceId ? '' : ' disabled aria-disabled="true" aria-describedby="bk-continue-hint"'}>Continue</button></div>`;
    elements.step.setAttribute('aria-busy', 'false');
    if (focus) focusTitle();
  }

  function selectService(id) {
    const service = findService(id);
    if (!service) return;
    if (state.get().serviceId !== id) state.set({ week: null, weekStart: null, selectedDate: null, startAt: null, startLabel: null });
    state.set({ serviceId: id });
    for (const card of elements.step.querySelectorAll('.bk-card')) {
      card.setAttribute('aria-pressed', card.dataset.serviceId === id ? 'true' : 'false');
    }
    const continueButton = elements.step.querySelector('[data-action="continue"]');
    if (continueButton) {
      continueButton.disabled = false;
      continueButton.removeAttribute('aria-disabled');
      continueButton.removeAttribute('aria-describedby');
    }
    elements.step.querySelector('#bk-continue-hint')?.remove();
    updateSummary();
    announce(`${service.name} selected.`);
  }

  elements.step.addEventListener('click', (event) => {
    const card = event.target.closest('.bk-card');
    if (card) {
      selectService(card.dataset.serviceId);
      return;
    }
    const day = event.target.closest('.bk-day');
    if (day) {
      if (day.getAttribute('aria-disabled') !== 'true') selectDay(day.dataset.date);
      return;
    }
    const slot = event.target.closest('.bk-slot');
    if (slot) {
      selectSlot(slot.dataset.startAt, slot.textContent);
      return;
    }
    const target = event.target.closest('[data-action]');
    const action = target?.dataset.action;
    if (action === 'continue' && state.get().step === 1 && state.get().serviceId) goTo(2);
    else if (action === 'back' && state.get().step === 2) goTo(1);
    else if (action === 'prev-week' || action === 'next-week') loadWeek(target.dataset.week, { focusSelector: `[data-action="${action}"]` });
    else if (action === 'retry-week') loadWeek(state.get().weekStart);
  });

  // Step 2 · date and time.
  function step2Actions() {
    const { startAt } = state.get();
    const hint = startAt ? '' : '<p class="bk-hint" id="bk-continue-hint">Choose a time to continue.</p>';
    return `<div class="bk-actions"><button type="button" class="button button-outline" data-action="back">Back</button>${hint}`
      + `<button type="button" class="button button-gold" data-action="continue"${startAt ? '' : ' disabled aria-disabled="true" aria-describedby="bk-continue-hint"'}>Continue</button></div>`;
  }

  function renderStep2({ focus = false, focusSelector = null } = {}) {
    const { week, selectedDate, startAt } = state.get();
    const body = week ? renderWeek({ week, selectedDate, selectedStartAt: startAt, deviceTimeZone }) : renderSlotsLoading();
    elements.step.innerHTML = `<h2 class="bk-step-title" tabindex="-1">Choose a date &amp; time</h2><div class="bk-week">${body}</div>${step2Actions()}`;
    elements.step.setAttribute('aria-busy', week ? 'false' : 'true');
    if (focus) focusTitle();
    else if (focusSelector) elements.step.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  // Re-render the week and the actions only, so focus on the step title or a
  // control outside them survives.
  function refreshWeek({ focusSelector = null } = {}) {
    const { week, selectedDate, startAt } = state.get();
    const weekBox = elements.step.querySelector('.bk-week');
    const actions = elements.step.querySelector('.bk-actions');
    if (!weekBox || !actions) {
      renderStep2({ focusSelector });
      return;
    }
    weekBox.innerHTML = week ? renderWeek({ week, selectedDate, selectedStartAt: startAt, deviceTimeZone }) : renderSlotsLoading();
    actions.outerHTML = step2Actions();
    elements.step.setAttribute('aria-busy', week ? 'false' : 'true');
    if (focusSelector) elements.step.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  async function loadWeek(weekStart, { focusSelector = null } = {}) {
    const { serviceId } = state.get();
    state.set({ week: null, weekStart: weekStart ?? null });
    refreshWeek();
    announce('Loading available times…');
    const result = await api.fetchWeek(serviceId, weekStart ?? undefined);
    if (state.get().serviceId !== serviceId || state.get().step !== 2) return;
    if (!result.ok) {
      elements.step.setAttribute('aria-busy', 'false');
      elements.step.querySelector('.bk-week').innerHTML = '';
      showBanner(renderSlotsError(result.error));
      return;
    }
    hideBanner();
    const week = result.data;
    const keepDate = week.days.some((day) => day.date === state.get().selectedDate && day.slots.length);
    state.set({ week, weekStart: week.week_start, selectedDate: keepDate ? state.get().selectedDate : defaultDay(week) });
    refreshWeek({ focusSelector });
    const total = week.days.reduce((sum, day) => sum + day.slots.length, 0);
    announce(total ? `${total} times available this week.` : 'No openings this week.');
  }

  function selectDay(date) {
    state.set({ selectedDate: date });
    refreshWeek({ focusSelector: `.bk-day[data-date="${date}"]` });
  }

  function selectSlot(startAt, label) {
    state.set({ startAt, startLabel: label.trim() });
    refreshWeek({ focusSelector: `.bk-slot[data-start-at="${startAt}"]` });
    updateSummary();
    announce(`${label.trim()} selected.`);
  }

  function goTo(step) {
    if (step !== 1 && step !== 2) return; // Steps 3 and 4 arrive with Tasks 17 and 18.
    hideBanner();
    state.set({ step });
    updateProgress(step);
    if (step === 1) {
      renderStep1({ focus: true });
      return;
    }
    renderStep2({ focus: true });
    if (!state.get().week) loadWeek(state.get().weekStart);
  }

  async function start() {
    const result = await api.fetchCatalog();
    if (!result.ok) {
      elements.step.setAttribute('aria-busy', 'false');
      elements.step.innerHTML = '<h2 class="bk-step-title" tabindex="-1">Choose a service</h2>';
      showBanner(renderCatalogUnavailable());
      return;
    }
    hideBanner();
    state.set({ catalog: result.data });
    const link = resolveDeepLink(parseDeepLink(window.location.search), result.data);
    state.set({ serviceId: link.serviceId, focusGroup: link.group });
    updateSummary();
    renderStep1();
    if (link.step === 2) goTo(2);
    announce('Services loaded.');
  }

  start();
}
