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
  assert.deepEqual(PR_TEMPLATES.map((template) => template.id), ['classic', 'modern', 'compact']);
  for (const template of PR_TEMPLATES) {
    assert.match(template.description, /Purchase Received receipt/i);
    assert.doesNotMatch(template.description, /invoice/i);
    assert.equal(setDefaultPRTemplate(template.id), template.id);
    assert.deepEqual(JSON.parse(window.localStorage.getItem(PR_TEMPLATE_KEY)), {
      version: 1, defaultPRReceiptTemplate: template.id,
    });
    assert.equal(loadPRTemplatePreference(), template.id, 'saved preferences survive a reload');
    assert.equal(resetPRTemplatePreference(), 'classic');
    assert.equal(window.localStorage.getItem(PR_TEMPLATE_KEY), null);
    assert.equal(loadPRTemplatePreference(), 'classic', 'reset returns to Classic');
  }
  assert.equal(window.localStorage.getItem(PO_TEMPLATE_KEY), poPreference);
  assert.equal(loadPOTemplatePreference(), 'modern');
  assert.equal(window.localStorage.getItem(PO_TEMPLATE_KEY), poPreference);
});

test('PR preference rejects unsupported or corrupt values and can be explicitly reset', () => {
  assert.throws(() => setDefaultPRTemplate('unsupported'), /supported Purchase Received/);
  window.localStorage.setItem(PR_TEMPLATE_KEY, '{broken');
  assert.throws(() => loadPRTemplatePreference(), /unreadable.*Reset the PR template preference/);
  for (const template of PR_TEMPLATES) {
    assert.throws(() => setDefaultPRTemplate(template.id), /unreadable/);
  }
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
  for (const template of PR_TEMPLATES) {
    assert.throws(() => setDefaultPRTemplate(template.id), /could not be saved.*browser storage/);
  }
  window.localStorage.removeItem = () => { throw new Error('denied'); };
  assert.throws(() => resetPRTemplatePreference(), /could not be reset.*browser storage/);
});