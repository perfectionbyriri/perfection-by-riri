// Booking flow entry (docs/booking/DESIGN_SPEC.md §3–§5).
//
// Loaded as an ES module from /book/. Rendering lives in the render-*.js
// modules (pure functions, unit-tested); this file owns the DOM: it inserts
// their markup, wires events, moves focus and keeps the summary current.

import { createApi } from './api.js';
import { formatDuration, formatPrice, renderCatalogUnavailable, renderServices } from './render-services.js';
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
  const state = createState({ step: 1, catalog: null, serviceId: null, focusGroup: null });

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
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'continue' && state.get().serviceId) {
      document.dispatchEvent(new CustomEvent('booking:step', { detail: { step: 2 } }));
    }
  });

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
    if (link.step === 2) document.dispatchEvent(new CustomEvent('booking:step', { detail: { step: 2 } }));
    announce('Services loaded.');
  }

  start();
}
