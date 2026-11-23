import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksMultiClickSelection } from '../../New Perfection/js/booking/selection.js';

test('a double or triple click on page text does not select it; a single press (drag) still can', () => {
  assert.equal(blocksMultiClickSelection({ detail: 1, editable: false }), false);
  assert.equal(blocksMultiClickSelection({ detail: 2, editable: false }), true);
  assert.equal(blocksMultiClickSelection({ detail: 3, editable: false }), true);
});

test('inside a text field a double click keeps selecting a word', () => {
  assert.equal(blocksMultiClickSelection({ detail: 2, editable: true }), false);
});
