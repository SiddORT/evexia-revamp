import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { developmentCompatibilityPlugin } from './development-identity.mjs';

test('development runtime suppresses all Vite automatic reload paths without editing dependencies', () => {
  const require = createRequire(new URL('../artifacts/evexia-portal/package.json', import.meta.url));
  const viteRoot = path.dirname(require.resolve('vite/package.json'));
  const file = path.join(viteRoot, 'dist/client/client.mjs');
  const original = fs.readFileSync(file, 'utf8');
  const plugin = developmentCompatibilityPlugin(true, '/');
  const transformed = plugin.transform(original, file);
  assert.ok(transformed.code.includes('evexia:automatic-reload-blocked'));
  assert.equal(/\blocation\.reload\(\);/.test(transformed.code), false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.throws(() => plugin.transform('unrecognized runtime', file));
  assert.equal(plugin.transform('location.reload();', '/some-app-file.js'), undefined);
  assert.equal(developmentCompatibilityPlugin(false, '/'), null);
});
