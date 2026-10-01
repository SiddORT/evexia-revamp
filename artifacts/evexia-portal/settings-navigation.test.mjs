import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSettingsSection, searchSettingsSections, settingsSectionUrl } from './src/components/admin/settingsNavigation.js';

const sections = [
  { id: 'basic', label: 'General', description: 'Dates and times in Admin', keywords: ['date format', 'clock', 'time zone'] },
  { id: 'ui', label: 'Appearance', description: 'Workspace colors and display', keywords: ['theme', 'light', 'dark', 'classic', 'modern'] },
  { id: 'templates', label: 'Templates', description: 'Document layouts in this browser', keywords: ['invoice', 'PDF', 'default'] },
];

test('existing direct URLs resolve, while absent and invalid sections fall back safely', () => {
  for (const id of ['basic', 'ui', 'templates']) {
    assert.equal(resolveSettingsSection(`?source=profile&tab=${id}`, sections), id);
  }
  for (const search of ['', '?source=profile', '?tab=unknown', '?tab=communication', '?tab=__proto__', '?tab=UI', '?tab=']) {
    assert.equal(resolveSettingsSection(search, sections), 'basic');
  }
});

test('search matches names, descriptions and setting keywords without changing the registry', () => {
  for (const [query, expected] of [
    ['date', 'basic'], ['clock', 'basic'], ['time zone', 'basic'],
    ['THEME', 'ui'], ['  light  ', 'ui'], ['workspace display', 'ui'],
    ['templates', 'templates'], ['pdf', 'templates'], ['document browser', 'templates'],
  ]) {
    assert.deepEqual(searchSettingsSections(sections, query).map((section) => section.id), [expected]);
  }
  assert.deepEqual(searchSettingsSections(sections, '   '), sections);
  assert.deepEqual(searchSettingsSections(sections, 'not implemented'), []);
  assert.deepEqual(searchSettingsSections(sections, 'email'), []);
  assert.deepEqual(searchSettingsSections(sections, 'theme clock'), []);
  assert.equal(sections.length, 3);
});

test('new implemented categories participate additively in search and URL lookup', () => {
  const extended = [...sections, { id: 'additional', label: 'A very long future category name', description: 'Available section', keywords: ['example'] }];
  assert.equal(resolveSettingsSection('?tab=additional', extended), 'additional');
  assert.deepEqual(searchSettingsSections(extended, 'long example').map((section) => section.id), ['additional']);
  assert.equal(resolveSettingsSection('?tab=additional', sections), 'basic');
});

test('implemented Communication can be registered without changing navigation helpers', () => {
  const available = [...sections, { id: 'communication', label: 'Communication', description: 'Unconnected browser-local metadata previews', keywords: ['email', 'sms', 'waba', 'smtp'] }];
  assert.equal(resolveSettingsSection('?tab=communication', available), 'communication');
  for (const query of ['email', 'sms', 'waba', 'smtp', 'metadata']) {
    assert.deepEqual(searchSettingsSections(available, query).map((section) => section.id), ['communication']);
  }
  const url = settingsSectionUrl('https://example.test/admin/settings?source=profile#details', 'communication', available);
  assert.equal(url.searchParams.get('tab'), 'communication');
  assert.equal(url.searchParams.get('source'), 'profile');
  assert.equal(url.hash, '#details');
});

test('category navigation preserves unrelated query values, hash, path and origin', () => {
  const href = 'https://example.test/portal/admin/settings?source=profile&filter=a&filter=b&tab=ui#details';
  for (const id of ['basic', 'ui', 'templates']) {
    const url = settingsSectionUrl(href, id, sections);
    assert.equal(url.origin, 'https://example.test');
    assert.equal(url.pathname, '/portal/admin/settings');
    assert.equal(url.searchParams.get('source'), 'profile');
    assert.deepEqual(url.searchParams.getAll('filter'), ['a', 'b']);
    assert.equal(url.hash, '#details');
    assert.equal(url.searchParams.get('tab'), id);
    assert.equal(resolveSettingsSection(url.search, sections), id);
  }
  assert.equal(settingsSectionUrl(href, 'missing', sections).searchParams.get('tab'), 'basic');
});

test('navigation replaces duplicate section parameters and direct reload resolves the destination', () => {
  const url = settingsSectionUrl('https://example.test/admin/settings?tab=ui&tab=templates&keep=1', 'templates', sections);
  assert.deepEqual(url.searchParams.getAll('tab'), ['templates']);
  assert.equal(url.searchParams.get('keep'), '1');
  assert.equal(resolveSettingsSection(new URL(url.href).search, sections), 'templates');
});