import test from 'node:test';
import assert from 'node:assert/strict';
import { containDialogTab } from './dialogKeyboard.js';

test('Tab/Shift+Tab wrap visible enabled dialog controls and recover escaped focus', () => {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ visibility: 'visible' });
  try {
    const doc = { activeElement: null };
    const node = ({ disabled = false, hidden = false } = {}) => ({
      tabIndex: 0, matches: () => disabled, closest: () => null,
      getClientRects: () => hidden ? [] : [{}], focus() { doc.activeElement = this; },
    });
    const close = node(), body = node(), retry = node(), disabled = node({ disabled: true }), hidden = node({ hidden: true });
    const dialog = { ownerDocument: doc, querySelectorAll: () => [close, body, disabled, hidden, retry] };
    const press = (shiftKey = false, key = 'Tab') => {
      let prevented = false;
      containDialogTab({ key, shiftKey, currentTarget: dialog, preventDefault() { prevented = true; } });
      return prevented;
    };
    doc.activeElement = close;
    assert.equal(press(), true); assert.equal(doc.activeElement, body);
    press(); assert.equal(doc.activeElement, retry);
    press(); assert.equal(doc.activeElement, close);
    press(true); assert.equal(doc.activeElement, retry);
    doc.activeElement = {};
    press(); assert.equal(doc.activeElement, close);
    doc.activeElement = {};
    press(true); assert.equal(doc.activeElement, retry);
    assert.equal(press(false, 'Escape'), false);
  } finally {
    if (original === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = original;
  }
});
