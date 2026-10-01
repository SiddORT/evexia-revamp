import test from 'node:test';
import assert from 'node:assert/strict';
import { PO_TEMPLATE_KEY, loadPOTemplatePreference, setDefaultPOTemplate } from './poInvoiceTemplates.js';
import {
  PR_TEMPLATE_KEY, PR_TEMPLATES, loadPRTemplatePreference, setDefaultPRTemplate,
  resetPRTemplatePreference,
} from './prReceiptTemplates.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test.beforeEach(() => {
  globalThis.window = { localStorage: createStorage() };
});

test('PR has its own default and preference key, independent from PO templates and records', () => {
  window.localStorage.setItem(PO_TEMPLATE_KEY, JSON.stringify({
    version: 1, defaultPOInvoiceTemplate: 'modern',
  }));
  const poPreference = window.localStorage.getItem(PO_TEMPLATE_KEY);
  assert.equal(loadPRTemplatePreference(), 'classic');
  assert.equal(PR_TEMPLATES.length, 1);
  assert.equal(PR_TEMPLATES[0].id, 'classic');
  assert.equal(setDefaultPRTemplate('classic'), 'classic');
  assert.equal(loadPRTemplatePreference(), 'classic');
  assert.equal(window.localStorage.getItem(PO_TEMPLATE_KEY), poPreference);
  assert.equal(loadPOTemplatePreference(), 'modern');
  assert.equal(window.localStorage.getItem(PR_TEMPLATE_KEY),
    JSON.stringify({ version: 1, defaultPRReceiptTemplate: 'classic' }));

  assert.equal(resetPRTemplatePreference(), 'classic');
  assert.equal(window.localStorage.getItem(PR_TEMPLATE_KEY), null);
  assert.equal(loadPOTemplatePreference(), 'modern');
  assert.equal(window.localStorage.getItem(PO_TEMPLATE_KEY), poPreference);
});

test('PR preference rejects unsupported or corrupt values and can be explicitly reset', () => {
  assert.throws(() => setDefaultPRTemplate('modern'), /supported Purchase Received/);
  window.localStorage.setItem(PR_TEMPLATE_KEY, '{broken');
  assert.throws(() => loadPRTemplatePreference(), /unreadable.*Reset the PR template preference/);
  assert.throws(() => setDefaultPRTemplate('classic'), /unreadable/);
  assert.equal(window.localStorage.getItem(PR_TEMPLATE_KEY), '{broken');
  assert.equal(resetPRTemplatePreference(), 'classic');
  assert.equal(loadPRTemplatePreference(), 'classic');

  window.localStorage.setItem(PR_TEMPLATE_KEY, JSON.stringify({
    version: 1, defaultPRReceiptTemplate: 'unknown',
  }));
  assert.throws(() => loadPRTemplatePreference(), /invalid.*Reset the PR template preference/);
});

test('PR preference reports browser storage read, write, and reset failures', () => {
  window.localStorage.getItem = () => { throw new Error('denied'); };
  assert.throws(() => loadPRTemplatePreference(), /could not be read.*browser storage/);
  window.localStorage.getItem = () => null;
  window.localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => setDefaultPRTemplate('classic'), /could not be saved.*browser storage/);
  window.localStorage.removeItem = () => { throw new Error('denied'); };
  assert.throws(() => resetPRTemplatePreference(), /could not be reset.*browser storage/);
});