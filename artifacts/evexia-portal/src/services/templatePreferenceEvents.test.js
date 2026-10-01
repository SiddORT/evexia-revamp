import test from 'node:test';
import assert from 'node:assert/strict';
import { PO_TEMPLATE_KEY, subscribePOTemplatePreference } from './poInvoiceTemplates.js';
import { PR_TEMPLATE_KEY, subscribePRTemplatePreference } from './prReceiptTemplates.js';

for (const [type, key, otherKey, subscribe, field] of [
  ['PO', PO_TEMPLATE_KEY, PR_TEMPLATE_KEY, subscribePOTemplatePreference, 'defaultPOInvoiceTemplate'],
  ['PR', PR_TEMPLATE_KEY, PO_TEMPLATE_KEY, subscribePRTemplatePreference, 'defaultPRReceiptTemplate'],
]) {
  test(`${type} observes only its local preference and clear events, without writes, and unsubscribes`, () => {
    const listeners = new Set();
    let raw = null;
    const localStorage = {
      getItem: () => raw,
      setItem: () => assert.fail('subscription must not write'),
      removeItem: () => assert.fail('subscription must not reset'),
    };
    globalThis.window = {
      localStorage,
      addEventListener: (event, listener) => { assert.equal(event, 'storage'); listeners.add(listener); },
      removeEventListener: (event, listener) => { assert.equal(event, 'storage'); listeners.delete(listener); },
    };
    const states = [];
    const stop = subscribe((state) => states.push(state));
    const dispatch = (event) => { for (const listener of listeners) listener(event); };
    dispatch({ key: otherKey, storageArea: localStorage });
    dispatch({ key: 'transaction-records', storageArea: localStorage });
    dispatch({ key, storageArea: {} }); // sessionStorage is not a local preference.
    assert.deepEqual(states, []);
    raw = JSON.stringify({ version: 1, [field]: 'classic' });
    dispatch({ key, storageArea: localStorage, newValue: '{stale event value' });
    assert.deepEqual(states.pop(), { id: 'classic', error: '' });
    raw = '{broken';
    dispatch({ key, storageArea: localStorage });
    assert.match(states.pop().error, /unreadable.*Reset/);
    raw = JSON.stringify({ version: 1, [field]: 'unsupported' });
    dispatch({ key, storageArea: localStorage });
    assert.match(states.pop().error, /invalid.*Reset/);
    raw = null;
    dispatch({ key: null, storageArea: localStorage });
    assert.deepEqual(states.pop(), { id: 'classic', error: '' });
    localStorage.getItem = () => { throw Error('denied'); };
    dispatch({ key, storageArea: localStorage });
    assert.match(states.pop().error, /could not be read.*browser storage/);
    stop();
    dispatch({ key, storageArea: localStorage });
    assert.equal(states.length, 0);
    assert.equal(listeners.size, 0);
  });
}