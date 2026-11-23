// Text selection on the booking page: a double or triple click (or tap) must
// not highlight labels and headings. A single press and drag still selects,
// and text fields keep their usual double-click word selection.

export const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function blocksMultiClickSelection({ detail, editable }) {
  return detail > 1 && !editable;
}

export function preventMultiClickSelection(root = document) {
  root.addEventListener('mousedown', (event) => {
    const editable = Boolean(event.target?.closest?.(EDITABLE_SELECTOR));
    if (blocksMultiClickSelection({ detail: event.detail, editable })) event.preventDefault();
  });
}
