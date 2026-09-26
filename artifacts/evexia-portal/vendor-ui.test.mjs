import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('Vendor toolbar excludes template while import dialog retains it', async () => {
  const server = await createServer({ configFile: new URL('./vite.config.js', import.meta.url).pathname, server: { middlewareMode: true }, appType: 'custom' });
  try {
    globalThis.window = {
      matchMedia: () => ({ matches: false }),
      localStorage: { getItem: () => null },
      location: { pathname: '/admin/masters/vendors', search: '' },
    };
    globalThis.location = globalThis.window.location;
    const { default: VendorMaster, VendorImport } = await server.ssrLoadModule('/src/pages/admin/VendorMaster.jsx');
    const page = renderToStaticMarkup(createElement(VendorMaster));
    assert.match(page, /data-testid="button-import-vendors"/);
    assert.match(page, /data-testid="button-export-vendors"/);
    assert.match(page, /data-testid="button-add-vendor"/);
    assert.doesNotMatch(page, /data-testid="button-download-vendor-template"/);

    const dialog = renderToStaticMarkup(createElement(VendorImport, {
      records: [], stale: false, onImport: () => {}, onClose: () => {},
    }));
    assert.match(dialog, /data-testid="button-vendor-import-template"/);
    assert.match(dialog, /Download template/);
    assert.match(dialog, /data-testid="input-vendor-import"/);
    assert.match(dialog, /data-testid="button-confirm-vendor-import"/);
  } finally {
    delete globalThis.window;
    delete globalThis.location;
    await server.close();
  }
});