// /book/confirmed/ (audit 2026-11-24). /book/ moves the URL here after a
// booking without loading a page. On a reload this script shows the booking
// that /book/ kept in this tab's sessionStorage, when its id matches `?ref=`.
// Without a match the page keeps its general text. Plain text only.

export const STORAGE_KEY = 'pbr:last-booking';

export function readStoredBooking(storage, ref) {
  if (!ref) return null;
  let raw = null;
  try { raw = storage?.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const booking = JSON.parse(raw);
    if (!booking || typeof booking !== 'object' || String(booking.id) !== ref) return null;
    return {
      id: String(booking.id),
      service: String(booking.service ?? ''),
      when: String(booking.when ?? '')
    };
  } catch {
    return null;
  }
}

export function confirmedRows(booking) {
  const rows = [];
  if (booking.service) rows.push(['Treatment', booking.service]);
  if (booking.when) rows.push(['Date & time', `${booking.when} Pacific Time`]);
  rows.push(['Booking reference', booking.id]);
  return rows;
}

function render() {
  const root = document.querySelector('[data-confirmed]');
  if (!root) return;
  let storage;
  try { storage = window.sessionStorage; } catch { storage = undefined; }
  const ref = new URLSearchParams(window.location.search).get('ref');
  const booking = readStoredBooking(storage, ref);
  if (!booking) return;
  root.querySelector('[data-confirmed-lead]').textContent = 'You’re booked. Here are the details of your appointment.';
  const list = root.querySelector('[data-confirmed-list]');
  for (const [label, value] of confirmedRows(booking)) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    row.append(dt, dd);
    list.append(row);
  }
  list.hidden = false;
}

if (typeof document !== 'undefined') render();
