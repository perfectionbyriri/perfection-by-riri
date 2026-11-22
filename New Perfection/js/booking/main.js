// Booking flow entry (docs/booking/DESIGN_SPEC.md §3–§5).
//
// Loaded as an ES module from /book/. Rendering lives in the render-*.js
// modules (pure functions, unit-tested); this file owns the DOM: it inserts
// their markup, wires events, moves focus and keeps the summary current.

import { createApi } from './api.js';
import {
  TURNSTILE_URL, buildAppointmentBody, createSubmitGuard, ensureIdempotencyKey, formatMoney,
  mapError, renderReview, squareSdkUrl
} from './checkout.js';
import { buildIcs, confirmedPath, fireConfirmation, renderConfirmation, trackFunnel } from './confirm.js';
import { formatDuration, formatPrice, renderCatalogUnavailable, renderServices } from './render-services.js';
import { defaultDay, renderSlotsError, renderSlotsLoading, renderWeek } from './render-slots.js';
import { renderDetails, renderErrorSummary } from './render-details.js';
import { createState, parseDeepLink, resolveDeepLink, stepFromHistory, summaryLine } from './state.js';
import { FIELD_ORDER, formatPhone, validateDetails } from './validate.js';

const STEP_NAMES = ['Service', 'Date & time', 'Your details', 'Deposit & confirm'];

const app = document.querySelector('[data-booking-app]');

if (app) {
  document.documentElement.classList.add('bk-enhanced');

  const api = createApi();
  const elements = {
    step: document.getElementById('bk-step'),
    banner: document.getElementById('bk-banner'),
    status: document.getElementById('bk-status'),
    alert: document.getElementById('bk-alert'),
    count: document.getElementById('bk-step-count'),
    progress: [...document.querySelectorAll('.bk-progress-item')],
    bar: document.getElementById('bk-bar'),
    barSummary: document.getElementById('bk-bar-summary'),
    barAction: document.getElementById('bk-bar-action'),
    sheet: document.getElementById('bk-sheet'),
    sheetList: document.getElementById('bk-sheet-list'),
    summaryList: document.getElementById('bk-summary-list'),
    summary: {
      service: document.querySelector('[data-summary="service"]'),
      time: document.querySelector('[data-summary="time"]'),
      deposit: document.querySelector('[data-summary="deposit"]')
    }
  };
  const state = createState({
    step: 1, catalog: null, serviceId: null, focusGroup: null,
    week: null, weekStart: null, selectedDate: null, startAt: null, startLabel: null,
    details: {}, idempotencyKey: null, booking: null
  });
  const guard = createSubmitGuard();
  const widgets = { card: null, turnstileId: null };
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
    updateBar();
  }

  // Mobile sticky bar (docs/booking/DESIGN_SPEC.md §5). It shows the choice so
  // far and stands in for the step's own primary button, which CSS hides at
  // 800px and below while the bar is up. Clicking it clicks that button.
  const primaryButton = () => elements.step.querySelector('.bk-pay')
    ?? elements.step.querySelector('.bk-actions .button-gold');

  function updateBar() {
    const { serviceId, step, booking, catalog, week, startAt, startLabel } = state.get();
    const show = Boolean(serviceId) && step < 5 && !booking && Boolean(catalog);
    elements.bar.hidden = !show;
    document.documentElement.classList.toggle('bk-has-bar', show);
    if (!show) return;
    elements.barSummary.textContent = summaryLine({ service: findService(serviceId), week, startAt, startLabel });
    const button = primaryButton();
    elements.barAction.textContent = (button?.dataset.label ?? button?.textContent ?? 'Continue').trim().toUpperCase();
    elements.barAction.disabled = !button || button.disabled;
  }

  elements.barAction.addEventListener('click', () => primaryButton()?.click());

  // Step content is re-rendered in many places; one observer keeps the bar's
  // label and disabled state in step with whichever button is on screen.
  new MutationObserver(() => updateBar()).observe(elements.step, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled']
  });

  elements.barSummary.addEventListener('click', () => {
    elements.sheetList.innerHTML = elements.summaryList.innerHTML;
    if (!elements.sheet.open) elements.sheet.showModal();
  });
  document.getElementById('bk-sheet-close').addEventListener('click', () => elements.sheet.close());
  elements.sheet.addEventListener('click', (event) => { if (event.target === elements.sheet) elements.sheet.close(); });

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
    trackFunnel('booking_view_service', { service_id: id }, window.gtag);
    announce(`${service.name} selected.`);
    scheduleAutoAdvance(id);
  }

  // On small screens a tap on a service card moves on by itself after 250ms
  // (at once with reduced motion). Desktop keeps the explicit Continue.
  let advanceTimer = null;
  function scheduleAutoAdvance(id) {
    clearTimeout(advanceTimer);
    if (!window.matchMedia('(max-width: 800px)').matches) return;
    const go = () => { if (state.get().step === 1 && state.get().serviceId === id) goTo(2); };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) go();
    else advanceTimer = setTimeout(go, 250);
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
    const { step } = state.get();
    if (action === 'continue' && step === 1 && state.get().serviceId) goTo(2);
    else if (action === 'continue' && step === 2 && state.get().startAt) goTo(3);
    else if (action === 'back' && step > 1) goTo(step - 1);
    else if (action === 'prev-week' || action === 'next-week') loadWeek(target.dataset.week, { focusSelector: `[data-action="${action}"]` });
    else if (action === 'retry-week') loadWeek(state.get().weekStart);
    else if (action === 'add-to-calendar') downloadCalendar();
  });

  elements.banner.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="retry-submit"]')) {
      elements.step.querySelector('#bk-checkout')?.requestSubmit();
    }
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
    trackFunnel('booking_select_slot', { service_id: state.get().serviceId }, window.gtag);
    announce(`${label.trim()} selected.`);
  }

  // Step 3 · your details. Values live in state.details, so going back to
  // step 2 (or a slot conflict at submit) never clears what was typed.
  function readDetails() {
    const form = elements.step.querySelector('#bk-details');
    if (!form) return state.get().details;
    const details = {};
    for (const name of FIELD_ORDER) {
      const input = form.elements[name];
      details[name] = input.type === 'checkbox' ? input.checked : input.value;
    }
    return details;
  }

  function setFieldError(name, message) {
    const input = elements.step.querySelector(`#bk-${name}`);
    const error = elements.step.querySelector(`#bk-${name}-error`);
    if (!input || !error) return;
    error.textContent = message || '';
    error.hidden = !message;
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', `bk-${name}-error`);
    } else {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function renderStep3({ focus = false } = {}) {
    const policyText = state.get().catalog?.checkout?.policy_text;
    elements.step.innerHTML = '<h2 class="bk-step-title" tabindex="-1">Your details</h2>'
      + renderDetails({ values: state.get().details, errors: {}, policyText })
      + '<div class="bk-actions"><button type="button" class="button button-outline" data-action="back">Back</button>'
      + '<button type="submit" class="button button-gold" form="bk-details">Continue</button></div>';
    elements.step.setAttribute('aria-busy', 'false');
    if (focus) focusTitle();
  }

  // Errors appear after a field is left, or on submit (D§4 step 3).
  elements.step.addEventListener('focusout', (event) => {
    const name = event.target.name;
    if (state.get().step !== 3 || !FIELD_ORDER.includes(name)) return;
    if (name === 'phone') event.target.value = formatPhone(event.target.value);
    const details = readDetails();
    state.set({ details });
    setFieldError(name, validateDetails(details).errors[name]);
  });

  elements.step.addEventListener('input', (event) => {
    if (state.get().step !== 3 || !FIELD_ORDER.includes(event.target.name)) return;
    const details = readDetails();
    state.set({ details });
    // Clear a shown error as soon as the value becomes valid.
    if (event.target.hasAttribute('aria-invalid')) {
      setFieldError(event.target.name, validateDetails(details).errors[event.target.name]);
    }
  });

  elements.step.addEventListener('submit', (event) => {
    if (event.target.id !== 'bk-details') return;
    event.preventDefault();
    if (state.get().step !== 3) return;
    const details = readDetails();
    state.set({ details });
    const { valid, errors } = validateDetails(details);
    for (const name of FIELD_ORDER) setFieldError(name, errors[name]);
    const slot = elements.step.querySelector('.bk-error-slot');
    slot.innerHTML = renderErrorSummary(errors);
    if (!valid) {
      const count = Object.keys(errors).length;
      elements.alert.textContent = `Please check ${count === 1 ? 'one detail' : `${count} details`} before you continue.`;
      elements.step.querySelector(`#bk-${FIELD_ORDER.find((name) => errors[name])}`)?.focus();
      return;
    }
    elements.alert.textContent = '';
    goTo(4);
  });

  // Step 4 · deposit and confirm. Card data stays in Square's iframe; the
  // page only receives a one-time token (PCI SAQ A).
  const loadedScripts = new Map();
  function loadScript(src) {
    if (!loadedScripts.has(src)) {
      loadedScripts.set(src, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => { loadedScripts.delete(src); reject(new Error(`load failed: ${src}`)); };
        document.head.append(script);
      }));
    }
    return loadedScripts.get(src);
  }

  // D§4 step 4: Jost is not available inside Square's iframe, so the card
  // field falls back to a system sans with the site's colours.
  const CARD_STYLE = {
    input: { backgroundColor: '#f5f2ef', color: '#262620', fontSize: '16px', fontFamily: 'sans-serif' },
    'input::placeholder': { color: '#6d6a62' },
    'input.is-error': { color: '#8c2f23' },
    '.input-container': { borderColor: '#6d6a62', borderRadius: '0px' },
    '.input-container.is-focus': { borderColor: '#262620' },
    '.input-container.is-error': { borderColor: '#8c2f23' },
    '.message-text': { color: '#6d6a62' },
    '.message-text.is-error': { color: '#8c2f23' },
    '.message-icon': { color: '#6d6a62' },
    '.message-icon.is-error': { color: '#8c2f23' }
  };

  const UNAVAILABLE_HTML = '<p>Online booking is taking a short break. Please call <a href="tel:+14258450045">(425) 845 0045</a> and we&rsquo;ll book you in.</p>';

  function stepTimeLabel() {
    const { startAt, startLabel, week } = state.get();
    const day = week?.days.find((item) => startAt && startAt.startsWith(item.date));
    if (!day) return startLabel ?? '';
    const date = new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
    return `${day.weekday}, ${date} · ${startLabel}`;
  }

  async function mountCard(service) {
    if (!service.deposit.required) return;
    const square = state.get().catalog?.checkout?.square;
    try {
      if (!square?.application_id || !square?.location_id) throw new Error('square config missing');
      await loadScript(squareSdkUrl(square.environment));
      if (state.get().step !== 4 || !elements.step.querySelector('#bk-card')) return;
      const payments = window.Square.payments(square.application_id, square.location_id);
      let card;
      try {
        card = await payments.card({ style: CARD_STYLE });
      } catch {
        card = await payments.card(); // An unsupported style key must not block payment.
      }
      if (state.get().step !== 4 || !elements.step.querySelector('#bk-card')) {
        card.destroy?.();
        return;
      }
      await card.attach('#bk-card');
      widgets.card = card;
    } catch {
      showBanner(UNAVAILABLE_HTML);
      setControlsLocked(true, { keepBack: true });
    }
  }

  async function mountTurnstile() {
    const siteKey = state.get().catalog?.checkout?.turnstile_site_key;
    if (!siteKey) return; // Mock mode without Turnstile; the server decides.
    try {
      await loadScript(TURNSTILE_URL);
      const box = elements.step.querySelector('#bk-turnstile');
      if (state.get().step !== 4 || !box) return;
      widgets.turnstileId = window.turnstile.render(box, { sitekey: siteKey, theme: 'light', size: 'flexible', action: 'booking' });
    } catch {
      showBanner(UNAVAILABLE_HTML);
      setControlsLocked(true, { keepBack: true });
    }
  }

  function unmountWidgets() {
    try { widgets.card?.destroy?.(); } catch { /* already gone */ }
    try { if (widgets.turnstileId !== null) window.turnstile?.remove(widgets.turnstileId); } catch { /* already gone */ }
    widgets.card = null;
    widgets.turnstileId = null;
  }

  function resetTurnstile() {
    try { if (widgets.turnstileId !== null) window.turnstile?.reset(widgets.turnstileId); } catch { /* reloads on next mount */ }
  }

  function setControlsLocked(lockedNow, { keepBack = false } = {}) {
    for (const control of elements.step.querySelectorAll('button, input, textarea')) {
      if (keepBack && control.dataset.action === 'back') continue;
      control.disabled = lockedNow;
    }
  }

  function setPayBusy(busyNow) {
    const button = elements.step.querySelector('.bk-pay');
    if (!button) return;
    button.textContent = busyNow ? 'Booking…' : button.dataset.label;
    button.setAttribute('aria-busy', busyNow ? 'true' : 'false');
    elements.step.setAttribute('aria-busy', busyNow ? 'true' : 'false');
  }

  function showCardError(message) {
    const error = elements.step.querySelector('#bk-card-error');
    if (!error) return;
    error.textContent = message || '';
    error.hidden = !message;
  }

  function renderStep4({ focus = false } = {}) {
    const service = findService(state.get().serviceId);
    state.set({ idempotencyKey: ensureIdempotencyKey(state.get().idempotencyKey) });
    elements.step.innerHTML = '<h2 class="bk-step-title" tabindex="-1">Deposit &amp; confirm</h2>'
      + renderReview({ service, details: state.get().details, timeLabel: stepTimeLabel() })
      + '<div class="bk-actions"><button type="button" class="button button-outline" data-action="back">Back</button></div>';
    elements.step.setAttribute('aria-busy', 'false');
    if (focus) focusTitle();
    trackFunnel('booking_begin_checkout', { service_id: service.service_id }, window.gtag);
    mountTurnstile();
    mountCard(service);
  }

  async function tokenizeCard(service) {
    if (!service.deposit.required) return { ok: true, payment: null };
    if (!widgets.card) return { ok: false, message: 'The card form is still loading. Please try again in a moment.' };
    const { details } = state.get();
    const result = await widgets.card.tokenize({
      amount: formatMoney(service.deposit.total_cents).slice(1),
      currencyCode: 'USD',
      intent: 'CHARGE',
      customerInitiated: true,
      sellerKeyedIn: false,
      billingContact: {
        givenName: details.first_name?.trim(),
        familyName: details.last_name?.trim(),
        email: details.email?.trim(),
        phone: details.phone?.replace(/\D/g, '')
      }
    });
    if (result?.status !== 'OK' || !result.token) return { ok: false, message: 'Please check your card details.' };
    return { ok: true, payment: { source_id: result.token, verification_token: result.verificationToken } };
  }

  function showSubmitError(mapped) {
    if (mapped.newKey) state.set({ idempotencyKey: null });
    if (mapped.step === 2) {
      trackFunnel('booking_slot_conflict', { service_id: state.get().serviceId }, window.gtag);
      const week = mapped.refreshedWeek;
      state.set({ startAt: null, startLabel: null, ...(week ? { week, weekStart: week.week_start, selectedDate: defaultDay(week) } : { week: null }) });
      unmountWidgets();
      goTo(2);
      updateSummary();
      showBanner(`<p>${mapped.message}</p>`);
      return;
    }
    if (mapped.step === 3) {
      unmountWidgets();
      goTo(3);
      for (const [name, message] of Object.entries(mapped.fieldErrors ?? {})) setFieldError(name, message);
      elements.step.querySelector('.bk-error-slot').innerHTML = renderErrorSummary(mapped.fieldErrors ?? {});
      elements.alert.textContent = mapped.message;
      elements.step.querySelector(`#bk-${FIELD_ORDER.find((name) => mapped.fieldErrors?.[name])}`)?.focus();
      return;
    }
    if (mapped.inline) {
      showCardError(mapped.message);
      elements.alert.textContent = mapped.message;
      try { widgets.card?.focus?.('cardNumber'); } catch { /* the iframe keeps its own focus */ }
      return;
    }
    const retry = mapped.retry ? '<button type="button" class="button button-outline" data-action="retry-submit">Try again</button>' : '';
    showBanner(`<p>${mapped.message.replace('(425) 845 0045', '<a href="tel:+14258450045">(425) 845 0045</a>')}</p>${retry}`);
  }

  function sessionStore() {
    try { return window.sessionStorage; } catch { return undefined; }
  }

  // Step 5 · confirmed (D§4). The URL changes without a new server page and
  // the conversion hook fires once per booking (ARCHITECTURE §10).
  function showBooked(data) {
    const service = findService(state.get().serviceId);
    const result = { ...data, service_id: service.service_id };
    const timeLabel = stepTimeLabel();
    state.set({ booking: result, step: 5 });
    unmountWidgets();
    hideBanner();
    elements.count.textContent = 'Booking confirmed';
    if (result.deposit?.status === 'captured') elements.summary.deposit.textContent = `${formatMoney(result.deposit.total_cents)} paid`;
    elements.progress.forEach((item) => { item.removeAttribute('aria-current'); item.classList.add('is-done'); });
    elements.step.innerHTML = renderConfirmation({
      result, firstName: state.get().details.first_name, email: state.get().details.email,
      timeLabel, policyText: state.get().catalog?.checkout?.policy_text
    });
    elements.step.setAttribute('aria-busy', 'false');
    focusTitle();
    try { window.history.replaceState({ step: 5 }, '', confirmedPath(result.booking.id)); } catch { /* the view is already shown */ }
    window.dataLayer = window.dataLayer || [];
    fireConfirmation(result, {
      gtag: typeof window.gtag === 'function' ? window.gtag : undefined,
      dataLayer: window.dataLayer,
      dispatch: (event) => window.dispatchEvent(event),
      storage: sessionStore()
    });
    announce(`You're booked. ${result.booking.service_name}, ${timeLabel} Pacific Time.`);
  }

  function downloadCalendar() {
    const booking = state.get().booking?.booking;
    if (!booking) return;
    const url = URL.createObjectURL(new Blob([buildIcs(booking)], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'perfection-by-riri-appointment.ics';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  elements.step.addEventListener('submit', async (event) => {
    if (event.target.id !== 'bk-checkout') return;
    event.preventDefault();
    if (state.get().step !== 4 || !guard.tryStart()) return; // A second click while booking is ignored.
    hideBanner();
    showCardError('');
    setControlsLocked(true);
    setPayBusy(true);
    let mapped = null;
    try {
      const service = findService(state.get().serviceId);
      const card = await tokenizeCard(service);
      if (!card.ok) {
        mapped = { step: 4, inline: true, message: card.message, newKey: false };
        return;
      }
      const turnstile = widgets.turnstileId !== null ? window.turnstile?.getResponse(widgets.turnstileId) ?? '' : '';
      state.set({ idempotencyKey: ensureIdempotencyKey(state.get().idempotencyKey) });
      const body = buildAppointmentBody({ ...state.get(), service }, { turnstile, payment: card.payment });
      const result = await api.createAppointment(body);
      if (result.ok) {
        guard.lock();
        showBooked(result.data);
        return;
      }
      resetTurnstile(); // A Turnstile token is single use.
      mapped = mapError({ ...(result.data ?? {}), error: result.error });
      if (mapped.locked) guard.lock();
    } catch {
      resetTurnstile();
      mapped = mapError({ error: { code: 'NETWORK' } });
    } finally {
      guard.finish();
      if (state.get().step === 4 && !state.get().booking) {
        setPayBusy(false);
        setControlsLocked(guard.locked);
      }
      if (mapped) showSubmitError(mapped);
    }
  });

  // Each step pushes `{ step }` onto history so the browser's back button
  // walks the steps. `push: false` is used when history already moved.
  function goTo(step, { push = true } = {}) {
    if (step < 1 || step > 4 || guard.busy) return;
    clearTimeout(advanceTimer);
    if (push && step !== state.get().step) {
      try { window.history.pushState({ step }, '', window.location.href); } catch { /* history is optional */ }
    }
    if (state.get().step === 4 && step !== 4) {
      unmountWidgets();
      state.set({ idempotencyKey: null }); // A changed choice is a new attempt.
    }
    hideBanner();
    state.set({ step });
    updateProgress(step);
    if (step === 1) {
      renderStep1({ focus: true });
      return;
    }
    if (step === 3) {
      renderStep3({ focus: true });
      return;
    }
    if (step === 4) {
      renderStep4({ focus: true });
      return;
    }
    renderStep2({ focus: true });
    if (!state.get().week) loadWeek(state.get().weekStart);
  }

  window.addEventListener('popstate', (event) => {
    const { booking } = state.get();
    if (booking) {
      // The confirmation stays: going back must not reopen the paid form.
      try { window.history.pushState({ step: 5 }, '', confirmedPath(booking.booking.id)); } catch { /* ignore */ }
      return;
    }
    if (guard.busy || !state.get().catalog) return;
    const { step } = stepFromHistory(event.state, state.get());
    if (step !== (event.state?.step ?? 1)) {
      try { window.history.replaceState({ step }, '', window.location.href); } catch { /* ignore */ }
    }
    goTo(step, { push: false });
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
    if (link.serviceId) trackFunnel('booking_view_service', { service_id: link.serviceId }, window.gtag);
    updateSummary();
    try { window.history.replaceState({ step: 1 }, '', window.location.href); } catch { /* ignore */ }
    renderStep1();
    if (link.step === 2) goTo(2);
    announce('Services loaded.');
  }

  start();
}
