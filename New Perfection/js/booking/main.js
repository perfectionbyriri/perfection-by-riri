// Booking flow entry (docs/booking/DESIGN_SPEC.md §3–§5).
//
// Loaded as an ES module from /book/. Rendering lives in the render-*.js
// modules (pure functions, unit-tested); this file owns the DOM: it inserts
// their markup, wires events, moves focus and keeps the summary current.

import { createApi } from './api.js';
import {
  CARD_STYLE, TURNSTILE_THEME, TURNSTILE_URL, buildAppointmentBody, createSubmitGuard, ensureIdempotencyKey, formatMoney,
  heroPhotoFor, mapError, payGate, renderReview, squareSdkUrl
} from './checkout.js';
import { renderActionBar } from './action-bar.js';
import { buildIcs, confirmedPath, fireConfirmation, renderConfirmation, trackFunnel } from './confirm.js';
import { renderCatalogUnavailable, renderServices } from './render-services.js';
import { defaultDay, renderSlotsError, renderSlotsLoading, renderWeek } from './render-slots.js';
import { renderDetails, renderErrorSummary } from './render-details.js';
import { continueBlocked, createState, parseDeepLink, resolveDeepLink, ribbonValues, stepFromHistory, summaryLine } from './state.js';
import { FIELD_ORDER, formatPhone, validateDetails } from './validate.js';
import { swipeDirection } from './swipe.js';

const STEP_NAMES = ['Service', 'Date & time', 'Your details', 'Deposit & confirm'];

const app = document.querySelector('[data-booking-app]');

if (app) {
  document.documentElement.classList.add('bk-enhanced');

  const api = createApi();
  const elements = {
    shell: document.querySelector('.bk-shell'),
    layout: document.querySelector('.bk-layout'),
    step: document.getElementById('bk-step'),
    banner: document.getElementById('bk-banner'),
    status: document.getElementById('bk-status'),
    alert: document.getElementById('bk-alert'),
    count: document.getElementById('bk-step-count'),
    progressList: document.querySelector('.bk-progress'),
    progress: [...document.querySelectorAll('.bk-progress-item')],
    bar: document.getElementById('bk-bar'),
    barSummary: document.getElementById('bk-bar-summary'),
    barAction: document.getElementById('bk-bar-action'),
    hero: {
      photo: document.querySelector('.bk-monolith-photo'),
      kicker: document.querySelector('.bk-monolith-kicker'),
      display: document.querySelector('.bk-monolith-display')
    },
    ribbon: document.querySelector('.bk-ribbon'),
    ribbonEdits: [...document.querySelectorAll('.bk-ribbon .bk-cinema-edit')],
    sheet: document.getElementById('bk-sheet'),
    sheetList: document.getElementById('bk-sheet-list'),
    summaryList: document.getElementById('bk-summary-list'),
    summary: {
      service: document.querySelector('[data-summary="service"]'),
      time: document.querySelector('[data-summary="time"]'),
      deposit: document.querySelector('[data-summary="deposit"]')
    }
  };
  // Steps 1-3 show the studio photo from the markup; Step 4 swaps in the service group's photo (Variant C §5.1).
  const studioPhoto = elements.hero.photo
    ? { src: elements.hero.photo.getAttribute('src'), alt: elements.hero.photo.getAttribute('alt') }
    : null;
  const state = createState({
    step: 1, catalog: null, serviceId: null, focusGroup: null, faqAcknowledged: false,
    week: null, weekStart: null, selectedDate: null, startAt: null, startLabel: null,
    details: {}, idempotencyKey: null, booking: null
  });
  const guard = createSubmitGuard();
  const widgets = { card: null, turnstileId: null, turnstileToken: '', turnstileError: false, unavailable: false };
  const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const findService = (id) => {
    for (const group of state.get().catalog?.groups ?? []) {
      const service = group.services.find((item) => item.service_id === id);
      // The group key picks the Step 4/5 hero photo (heroPhotoFor).
      if (service) return { ...service, group: group.key };
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

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateStep(direction) {
    elements.step.classList.remove('is-entering-forward', 'is-entering-backward', 'is-entering-confirm');
    if (prefersReducedMotion()) return;
    void elements.step.offsetWidth;
    if (direction === 'backward') elements.step.classList.add('is-entering-backward');
    else if (direction === 'confirm') elements.step.classList.add('is-entering-confirm');
    else elements.step.classList.add('is-entering-forward');
  }

  // Animate a container from its old height to its new one so swapping its
  // content does not make the page jump. Skipped with reduced motion.
  function morphHeight(box, update) {
    if (prefersReducedMotion() || !box.isConnected) { update(); return; }
    const from = box.offsetHeight;
    update();
    const to = box.offsetHeight;
    if (!from || from === to) return;
    box.style.overflow = 'hidden';
    box.style.height = `${from}px`;
    void box.offsetHeight;
    box.style.transition = 'height 320ms var(--bk-ease)';
    box.style.height = `${to}px`;
    const done = () => { box.style.overflow = box.style.height = box.style.transition = ''; };
    box.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400);
  }

  function setSummaryValue(el, { title, sub }) {
    const titleEl = el?.querySelector('.bk-ribbon-title');
    const subEl = el?.querySelector('.bk-ribbon-sub');
    if (!titleEl || !subEl || (titleEl.textContent === title && subEl.textContent === sub)) return;
    titleEl.textContent = title;
    titleEl.classList.toggle('is-numeric', /^[$\d.,\s]+$/.test(title));
    subEl.textContent = sub;
    if (prefersReducedMotion()) return;
    el.classList.remove('is-updated');
    void el.offsetWidth;
    el.classList.add('is-updated');
  }

  function setStageStep(step) {
    elements.shell?.setAttribute('data-step', String(step));
    elements.layout?.setAttribute('data-step', String(step));
  }

  function setHero(step) {
    const { photo, kicker, display } = elements.hero;
    if (!photo || !kicker || !display || !studioPhoto) return;
    const service = step === 4 ? findService(state.get().serviceId) : null;
    if (service) {
      const groupPhoto = heroPhotoFor(service);
      photo.src = groupPhoto.src;
      photo.alt = groupPhoto.alt;
      photo.style.objectPosition = groupPhoto.focal;
      kicker.textContent = 'Step 04 of 04 \u00b7 Final review';
      display.innerHTML = 'Your appointment,<br><em>considered.</em>';
    } else {
      photo.src = studioPhoto.src;
      photo.alt = studioPhoto.alt;
      photo.style.objectPosition = '';
      kicker.textContent = '';
      display.textContent = '';
    }
    kicker.hidden = !service;
    display.hidden = !service;
  }

  function updateProgress(step) {
    setStageStep(step);
    setHero(step);
    elements.count.textContent = `Step ${step} of 4 — ${STEP_NAMES[step - 1]}`;
    elements.progress.forEach((item, index) => {
      const target = index + 1;
      const done = target < step;
      if (target === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-done', done);
      // The button role sits on the inner label so the <li> keeps its list-item role.
      const label = item.querySelector('.bk-progress-label');
      if (done) {
        label?.setAttribute('role', 'button');
        label?.setAttribute('tabindex', '0');
        item.dataset.gotoStep = String(target);
      } else {
        label?.removeAttribute('role');
        label?.removeAttribute('tabindex');
        delete item.dataset.gotoStep;
      }
    });
    updateSummary();
  }

  function navigateFromProgress(target) {
    const stepNum = Number(target?.dataset.gotoStep);
    if (stepNum >= 1 && stepNum < state.get().step && !state.get().booking) goTo(stepNum);
  }

  elements.progressList?.addEventListener('click', (event) => {
    navigateFromProgress(event.target.closest('.bk-progress-item[data-goto-step]'));
  });
  elements.progressList?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('.bk-progress-item[data-goto-step]');
    if (!item) return;
    event.preventDefault();
    navigateFromProgress(item);
  });

  function updateSummary() {
    const { serviceId, startAt, startLabel, week, step } = state.get();
    const values = ribbonValues({ service: findService(serviceId), week, startAt, startLabel });
    setSummaryValue(elements.summary.service, values.service);
    setSummaryValue(elements.summary.time, values.time);
    setSummaryValue(elements.summary.deposit, values.deposit);
    // Edit appears once the client is past the step it returns to (Variant C §5.2).
    elements.ribbonEdits.forEach((button) => { button.hidden = !(Number(button.dataset.gotoStep) < step && step <= 3); });
    updateBar();
  }

  // Mobile sticky bar and desktop sticky summary CTA stand in for the step's
  // own primary button so Continue stays visible even on long lists.
  const primaryButton = () => elements.step.querySelector('.bk-pay')
    ?? elements.step.querySelector('.bk-actions .button-gold');

  function updateBar() {
    const { serviceId, step, booking, catalog, week, startAt, startLabel } = state.get();
    const show = Boolean(serviceId) && step < 5 && !booking && Boolean(catalog);
    elements.bar.hidden = !show;
    document.documentElement.classList.toggle('bk-has-bar', show);
    const button = primaryButton();
    // While Turnstile is pending the bar says why Pay is disabled; the page hint is off screen on phones.
    const waitingForCheck = step === 4 && Boolean(elements.step.querySelector('#bk-pay-hint'));
    const checkLabel = widgets.turnstileError ? 'Security check failed' : 'Security check…';
    const label = (waitingForCheck ? checkLabel : (button?.dataset.label ?? button?.textContent ?? 'Continue')).trim().toUpperCase();
    const disabled = !button || button.disabled;
    if (!show) return;
    elements.barSummary.textContent = summaryLine({ service: findService(serviceId), week, startAt, startLabel });
    elements.barAction.textContent = label;
    elements.barAction.disabled = disabled;
  }

  elements.barAction.addEventListener('click', () => primaryButton()?.click());
  elements.ribbon?.addEventListener('click', (event) => {
    navigateFromProgress(event.target.closest('.bk-cinema-edit[data-goto-step]'));
  });

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
    if (title) title.focus({ preventScroll: true });
  }

  function renderStep1({ focus = false } = {}) {
    const { catalog, serviceId, focusGroup, faqAcknowledged } = state.get();
    updateProgress(1);
    const blocked = continueBlocked({ service: findService(serviceId), faqAcknowledged });
    const hint = !serviceId
      ? '<p class="bk-hint" id="bk-continue-hint">Choose a service to continue.</p>'
      : (blocked ? '<p class="bk-hint" id="bk-continue-hint">Please confirm the notice above to continue.</p>' : '');
    elements.step.innerHTML = '<h2 class="bk-step-title" tabindex="-1">Choose a service</h2>'
      + renderServices({ groups: catalog.groups, selectedId: serviceId, focusGroup, faqAcknowledged })
      + renderActionBar({
        step: 1,
        hint,
        primary: '<button type="button" class="button button-gold" data-action="continue"'
          + `${!serviceId || blocked ? ' disabled aria-disabled="true" aria-describedby="bk-continue-hint"' : ''}>Continue to date &amp; time</button>`
      });
    elements.step.setAttribute('aria-busy', 'false');
    if (focus) focusTitle();
  }

  function toggleGroup(key) {
    for (const section of elements.step.querySelectorAll('.bk-group')) {
      const trigger = section.querySelector('[data-group-toggle]');
      const panel = section.querySelector('.bk-cat-panel');
      const isTarget = section.dataset.group === key;
      const nextOpen = isTarget ? !section.classList.contains('is-open') : false;
      section.classList.toggle('is-open', nextOpen);
      trigger?.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      if (panel) panel.inert = !nextOpen;
    }
  }

  // Continue waits for a service, and for the FAQ confirmation when the service has a notice.
  function syncContinue() {
    const { serviceId, faqAcknowledged } = state.get();
    const blocked = !serviceId || continueBlocked({ service: findService(serviceId), faqAcknowledged });
    const continueButton = elements.step.querySelector('[data-action="continue"]');
    if (continueButton) {
      continueButton.disabled = blocked;
      if (blocked) {
        continueButton.setAttribute('aria-disabled', 'true');
        continueButton.setAttribute('aria-describedby', 'bk-continue-hint');
      } else {
        continueButton.removeAttribute('aria-disabled');
        continueButton.removeAttribute('aria-describedby');
      }
    }
    let hint = elements.step.querySelector('#bk-continue-hint');
    const text = !serviceId ? 'Choose a service to continue.' : (blocked ? 'Please confirm the notice above to continue.' : '');
    if (!text) { hint?.remove(); return; }
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'bk-hint';
      hint.id = 'bk-continue-hint';
      elements.step.querySelector('.bk-actions')?.insertBefore(hint, continueButton);
    }
    hint.textContent = text;
  }

  function selectService(id) {
    const service = findService(id);
    if (!service) return;
    if (state.get().serviceId !== id) state.set({ week: null, weekStart: null, selectedDate: null, startAt: null, startLabel: null, faqAcknowledged: false });
    state.set({ serviceId: id });
    for (const notice of elements.step.querySelectorAll('.bk-notice')) {
      const mine = notice.dataset.noticeFor === id;
      notice.hidden = !mine;
      const check = notice.querySelector('.bk-notice-check');
      if (check && !mine) check.checked = false;
      if (mine) notice.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    for (const card of elements.step.querySelectorAll('.bk-card')) {
      card.setAttribute('aria-pressed', card.dataset.serviceId === id ? 'true' : 'false');
    }
    for (const section of elements.step.querySelectorAll('.bk-group')) {
      const hasMatch = Boolean(section.querySelector(`.bk-card[data-service-id="${CSS.escape(id)}"]`));
      section.classList.toggle('has-selected', hasMatch);
      const copy = section.querySelector('.bk-cat-copy');
      let badge = copy?.querySelector('.bk-cat-chosen');
      if (hasMatch && copy) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'bk-cat-chosen';
          copy.append(badge);
        }
        badge.textContent = `Selected · ${service.name}`;
      } else {
        badge?.remove();
      }
    }
    syncContinue();
    updateSummary();
    trackFunnel('booking_view_service', { service_id: id }, window.gtag);
    announce(`${service.name} selected.`);
  }

  elements.step.addEventListener('click', (event) => {
    const groupToggle = event.target.closest('[data-group-toggle]');
    if (groupToggle) {
      toggleGroup(groupToggle.dataset.groupToggle);
      return;
    }
    const subtab = event.target.closest('[data-subtab]');
    if (subtab) {
      const section = subtab.closest('.bk-group');
      const targetKey = subtab.dataset.subtab;
      if (section && targetKey) {
        for (const tab of section.querySelectorAll('[data-subtab]')) {
          tab.setAttribute('aria-pressed', tab === subtab ? 'true' : 'false');
        }
        for (const panel of section.querySelectorAll('[data-subpanel]')) {
          panel.hidden = panel.dataset.subpanel !== targetKey;
        }
      }
      return;
    }
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
    const gotoStep = event.target.closest('[data-goto-step]');
    if (gotoStep) {
      navigateFromProgress(gotoStep);
      return;
    }
    const target = event.target.closest('[data-action]');
    const action = target?.dataset.action;
    const { step } = state.get();
    if (action === 'continue' && step === 1 && state.get().serviceId && !continueBlocked({ service: findService(state.get().serviceId), faqAcknowledged: state.get().faqAcknowledged })) goTo(2);
    else if (action === 'continue' && step === 2 && state.get().startAt) goTo(3);
    else if (action === 'back' && step > 1) goTo(step - 1);
    else if (action === 'prev-week' || action === 'next-week') loadWeek(target.dataset.week, { focusSelector: `[data-action="${action}"]` });
    else if (action === 'retry-week') loadWeek(state.get().weekStart);
    else if (action === 'add-to-calendar') downloadCalendar();
  });

  // The FAQ confirmation under a flagged service.
  elements.step.addEventListener('change', (event) => {
    const check = event.target.closest?.('.bk-notice-check');
    if (!check) return;
    state.set({ faqAcknowledged: check.checked });
    syncContinue();
    announce(check.checked ? 'FAQ confirmed.' : 'FAQ confirmation removed.');
  });

  // Step 2: swipe the week left or right, the same as the arrows. A touch that
  // starts inside a horizontally scrolling day strip is left to that strip.
  let swipeStart = null;
  elements.step.addEventListener('touchstart', (event) => {
    swipeStart = null;
    if (state.get().step !== 2 || event.touches.length !== 1 || !event.target.closest('.bk-week')) return;
    const strip = event.target.closest('.bk-days');
    if (strip && strip.scrollWidth > strip.clientWidth) return;
    const touch = event.touches[0];
    swipeStart = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  }, { passive: true });
  elements.step.addEventListener('touchend', (event) => {
    const start = swipeStart;
    swipeStart = null;
    const touch = event.changedTouches[0];
    const direction = swipeDirection(start, touch && { x: touch.clientX, y: touch.clientY, t: Date.now() });
    if (!direction) return;
    elements.step.querySelector(`[data-action="${direction}-week"]:not(:disabled)`)?.click();
  }, { passive: true });

  elements.banner.addEventListener('click', (event) => {
    if (event.target.closest('[data-action="retry-submit"]')) {
      elements.step.querySelector('#bk-checkout')?.requestSubmit();
    }
  });

  // Step 2 · date and time.
  function step2Actions() {
    const { startAt } = state.get();
    const hint = startAt ? '' : '<p class="bk-hint" id="bk-continue-hint">Choose a time to continue.</p>';
    return renderActionBar({
      step: 2,
      hint,
      primary: `<button type="button" class="button button-gold" data-action="continue"${startAt ? '' : ' disabled aria-disabled="true" aria-describedby="bk-continue-hint"'}>Continue to details</button>`
    });
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
  function refreshWeek({ focusSelector = null, slideIn = null } = {}) {
    const { week, selectedDate, startAt } = state.get();
    const weekBox = elements.step.querySelector('.bk-week');
    const actions = elements.step.querySelector('.bk-actions');
    if (!weekBox || !actions) {
      renderStep2({ focusSelector });
      return;
    }
    weekBox.classList.remove('is-week-out-next', 'is-week-out-prev', 'is-week-in-next', 'is-week-in-prev');
    if (slideIn && !prefersReducedMotion()) {
      weekBox.classList.add(`is-week-in-${slideIn}`);
      setTimeout(() => weekBox.classList.remove(`is-week-in-${slideIn}`), 400);
    }
    morphHeight(weekBox, () => {
      weekBox.innerHTML = week ? renderWeek({ week, selectedDate, selectedStartAt: startAt, deviceTimeZone }) : renderSlotsLoading();
    });
    actions.outerHTML = step2Actions();
    elements.step.setAttribute('aria-busy', week ? 'false' : 'true');
    if (focusSelector) elements.step.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  // The week slides out toward the swipe, the new one slides in from the
  // other side. Skipped with reduced motion or on the first load.
  function slideOutWeek(direction) {
    const weekBox = elements.step.querySelector('.bk-week');
    if (!direction || !weekBox || prefersReducedMotion()) return Promise.resolve();
    weekBox.classList.add(`is-week-out-${direction}`);
    return new Promise((resolve) => { setTimeout(resolve, 140); });
  }

  async function loadWeek(weekStart, { focusSelector = null } = {}) {
    const { serviceId, weekStart: from } = state.get();
    const direction = weekStart && from && weekStart !== from ? (weekStart > from ? 'next' : 'prev') : null;
    const request = api.fetchWeek(serviceId, weekStart ?? undefined);
    await slideOutWeek(direction);
    state.set({ week: null, weekStart: weekStart ?? null });
    refreshWeek();
    announce('Loading available times…');
    const result = await request;
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
    refreshWeek({ focusSelector, slideIn: direction });
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
      + renderActionBar({ step: 3, primary: '<button type="submit" class="button button-gold" form="bk-details">Review &amp; confirm</button>' });
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
      if (square?.mock && (!square.application_id || !square.location_id)) {
        const box = elements.step.querySelector('#bk-card');
        if (state.get().step !== 4 || !box) return;
        box.innerHTML = '<div class="bk-mock-card"><span class="bk-mock-card-badge">Test mode</span>'
          + '<span class="bk-mock-card-num">Simulated Visa &bull;&bull;&bull;&bull; 4242 &middot; 12/29</span>'
          + '<span class="bk-mock-card-note">Mock payments are active locally — no real card will be charged.</span></div>';
        widgets.card = {
          tokenize: async () => ({ status: 'OK', token: 'cnon:card-nonce-ok' }),
          destroy: () => { box.innerHTML = ''; }
        };
        return;
      }
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
      showUnavailable();
    }
  }

  function showUnavailable() {
    widgets.unavailable = true;
    showBanner(UNAVAILABLE_HTML);
    setControlsLocked(true, { keepBack: true });
  }

  const needsTurnstile = () => Boolean(state.get().catalog?.checkout?.turnstile_site_key);

  // Pay waits for a Turnstile token; the sticky bar mirrors it through the MutationObserver.
  function syncPay() {
    const button = elements.step.querySelector('.bk-pay');
    if (!button) return;
    const { disabled, hint } = payGate({
      busy: guard.busy,
      locked: guard.locked || widgets.unavailable,
      needsTurnstile: needsTurnstile(),
      turnstileToken: widgets.turnstileToken,
      turnstileError: widgets.turnstileError
    });
    button.disabled = disabled;
    let hintEl = elements.step.querySelector('#bk-pay-hint');
    if (disabled && hint) {
      if (!hintEl) {
        hintEl = document.createElement('p');
        hintEl.className = 'bk-hint';
        hintEl.id = 'bk-pay-hint';
        button.before(hintEl);
      }
      hintEl.textContent = hint;
      button.setAttribute('aria-describedby', 'bk-pay-hint');
    } else {
      hintEl?.remove();
      button.removeAttribute('aria-describedby');
    }
    if (disabled) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
  }

  async function mountTurnstile() {
    const siteKey = state.get().catalog?.checkout?.turnstile_site_key;
    if (!siteKey) return; // Mock mode without Turnstile; the server decides.
    try {
      await loadScript(TURNSTILE_URL);
      const box = elements.step.querySelector('#bk-turnstile');
      if (state.get().step !== 4 || !box) return;
      widgets.turnstileId = window.turnstile.render(box, {
        sitekey: siteKey,
        theme: TURNSTILE_THEME,
        size: 'flexible',
        action: 'booking',
        callback: (token) => { widgets.turnstileToken = token; widgets.turnstileError = false; syncPay(); },
        'expired-callback': () => { widgets.turnstileToken = ''; syncPay(); },
        'error-callback': () => { widgets.turnstileToken = ''; widgets.turnstileError = true; syncPay(); }
      });
    } catch {
      showUnavailable();
    }
  }

  function unmountWidgets() {
    try { widgets.card?.destroy?.(); } catch { /* already gone */ }
    try { if (widgets.turnstileId !== null) window.turnstile?.remove(widgets.turnstileId); } catch { /* already gone */ }
    widgets.card = null;
    widgets.turnstileId = null;
    widgets.turnstileToken = '';
    widgets.turnstileError = false;
    widgets.unavailable = false;
  }

  // A token is single use: Pay waits for the fresh one the reset issues.
  function resetTurnstile() {
    widgets.turnstileToken = '';
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
      + renderReview({ service, details: state.get().details, timeLabel: stepTimeLabel(), turnstile: needsTurnstile() });
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
    if (mapped.step === 1) {
      unmountWidgets();
      state.set({ faqAcknowledged: false });
      goTo(1);
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
    setStageStep(5);
    unmountWidgets();
    hideBanner();
    elements.count.textContent = 'Booking confirmed';
    if (result.deposit?.status === 'captured') {
      setSummaryValue(elements.summary.deposit, { title: formatMoney(result.deposit.total_cents), sub: 'Paid' });
    }
    elements.progress.forEach((item) => {
      item.removeAttribute('aria-current');
      item.querySelector('.bk-progress-label')?.removeAttribute('role');
      item.querySelector('.bk-progress-label')?.removeAttribute('tabindex');
      delete item.dataset.gotoStep;
      item.classList.add('is-done');
    });
    elements.step.innerHTML = renderConfirmation({
      result, service, firstName: state.get().details.first_name, email: state.get().details.email,
      timeLabel, policyText: state.get().catalog?.checkout?.policy_text
    });
    elements.step.setAttribute('aria-busy', 'false');
    animateStep('confirm');
    const head = elements.shell ?? document.querySelector('.bk-head');
    if (head && head.getBoundingClientRect().top < 0) {
      head.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
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
    if (state.get().step !== 4) return;
    if (needsTurnstile() && !widgets.turnstileToken) { syncPay(); return; } // No token yet: the server would answer TURNSTILE_FAILED.
    if (!guard.tryStart()) return; // A second click while booking is ignored.
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
      const turnstile = widgets.turnstileId !== null ? window.turnstile?.getResponse(widgets.turnstileId) || widgets.turnstileToken : '';
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
        setControlsLocked(guard.locked || widgets.unavailable, { keepBack: widgets.unavailable && !guard.locked });
        syncPay();
      }
      if (mapped) showSubmitError(mapped);
    }
  });

  // Each step pushes `{ step }` onto history so the browser's back button
  // walks the steps. `push: false` is used when history already moved.
  function goTo(step, { push = true } = {}) {
    if (step < 1 || step > 4 || guard.busy) return;
    const prevStep = state.get().step;
    const direction = step < prevStep ? 'backward' : 'forward';
    if (push && step !== prevStep) {
      try { window.history.pushState({ step }, '', window.location.href); } catch { /* history is optional */ }
    }
    if (prevStep === 4 && step !== 4) {
      unmountWidgets();
      state.set({ idempotencyKey: null }); // A changed choice is a new attempt.
    }
    hideBanner();
    state.set({ step });
    updateProgress(step);
    // The step swaps through a view transition when the browser has one: the
    // old step fades out before the new one slides in, instead of vanishing.
    const viaTransition = !prefersReducedMotion() && typeof document.startViewTransition === 'function';
    const finish = () => {
      if (!viaTransition) animateStep(direction);
      const head = document.querySelector('.bk-head');
      if (head && head.getBoundingClientRect().top < 0) {
        head.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    };
    const render = () => {
      if (step === 1) {
        renderStep1({ focus: true });
        finish();
        return;
      }
      if (step === 3) {
        renderStep3({ focus: true });
        finish();
        return;
      }
      if (step === 4) {
        renderStep4({ focus: true });
        finish();
        return;
      }
      renderStep2({ focus: true });
      finish();
      if (!state.get().week) loadWeek(state.get().weekStart);
    };
    if (!viaTransition) {
      render();
      return;
    }
    const root = document.documentElement;
    root.dataset.bkDir = direction;
    const transition = document.startViewTransition(render);
    transition.finished.catch(() => {}).finally(() => { delete root.dataset.bkDir; });
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
