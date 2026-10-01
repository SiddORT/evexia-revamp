import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPOSnapshot } from './purchaseOrders.js';
import {
  PO_TEMPLATE_KEY, PO_TEMPLATES, loadPOTemplatePreference, setDefaultPOTemplate,
  makePOInvoiceDocument, makeSampleInvoiceDocument, resetPOTemplatePreference,
} from './poInvoiceTemplates.js';

test.beforeEach(() => {
  const records = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => records.has(key) ? records.get(key) : null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  } };
});
test('defaults to Classic and saves a selected template without changing PO records', () => {
  assert.equal(loadPOTemplatePreference(), 'classic');
  const snapshot = loadPOSnapshot();
  assert.equal(setDefaultPOTemplate('modern'), 'modern');
  assert.equal(loadPOTemplatePreference(), 'modern');
  assert.deepEqual(loadPOSnapshot().record, snapshot.record);
  assert.throws(() => setDefaultPOTemplate('unknown'), /supported/);
  assert.equal(loadPOTemplatePreference(), 'modern');
});
test('rejects unreadable preferences and reports write failures', () => {
  window.localStorage.setItem(PO_TEMPLATE_KEY, '{broken');
  assert.throws(() => loadPOTemplatePreference(), /unreadable/);
  assert.throws(() => setDefaultPOTemplate('modern'), /unreadable/);
  assert.equal(window.localStorage.getItem(PO_TEMPLATE_KEY), '{broken');
  window.localStorage.setItem(PO_TEMPLATE_KEY, JSON.stringify({ version: 1, defaultPOInvoiceTemplate: 'unknown' }));
  assert.throws(() => loadPOTemplatePreference(), /invalid/);
  window.localStorage.setItem(PO_TEMPLATE_KEY, JSON.stringify({ version: 1, defaultPOInvoiceTemplate: 'classic' }));
  window.localStorage.setItem = () => { throw Error('denied'); };
  assert.throws(() => setDefaultPOTemplate('compact'), /could not be saved/);
  assert.equal(loadPOTemplatePreference(), 'classic');
});
test('all template previews render the same sample totals', () => {
  for (const template of PO_TEMPLATES) {
    const document = makeSampleInvoiceDocument(template.id);
    assert.equal(document.templateId, template.id);
    assert.ok(document.pages.length > 0);
    const markup = document.pages.join('');
    assert.match(markup, /PO-SAMPLE-001/);
    assert.match(markup, /Sample Diagnostic Reagent/);
    assert.match(markup, /13,059\.48/);
  }
});
test('explicit preference reset recovers invalid storage without changing purchase orders', () => {
  const snapshot = loadPOSnapshot();
  window.localStorage.setItem(PO_TEMPLATE_KEY, '{broken');
  assert.equal(resetPOTemplatePreference(), 'classic');
  assert.equal(loadPOTemplatePreference(), 'classic');
  assert.deepEqual(loadPOSnapshot().record, snapshot.record);
  setDefaultPOTemplate('compact');
  assert.equal(loadPOTemplatePreference(), 'compact');
});
test('saved default determines invoice rendering and saved amounts are checked', () => {
  const { record, refs } = loadPOSnapshot();
  const order = record.orders.find((item) => item.status === 'open');
  setDefaultPOTemplate('compact');
  const document = makePOInvoiceDocument(order, refs);
  assert.equal(document.templateId, 'compact');
  assert.match(document.pages.join(''), new RegExp(order.number));
  assert.throws(() => makePOInvoiceDocument({ ...order, total: order.total + 1 }, refs), /invalid invoice figures/);
  // Historical names still print even when current masters have been removed.
  assert.match(makePOInvoiceDocument(order, { vendors: [], products: [] }).pages.join(''), new RegExp(order.vendorName));
});