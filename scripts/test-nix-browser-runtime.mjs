import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNixSystemDependencies } from './nix-browser-runtime.mjs';

const path = '/nix/store/current-firefox/bin:/nix/store/current-webkit/bin:/nix/store/current-mesa/bin';
const files = [
  '/nix/store/current-firefox/bin/firefox',
  '/nix/store/current-firefox/lib/firefox/libxul.so',
  '/nix/store/current-webkit/bin/WebKitWebDriver',
  '/nix/store/current-webkit/lib/libwebkit2gtk-4.1.so.0',
  '/nix/store/current-mesa/share/glvnd/egl_vendor.d/50_mesa.json',
];
const expected = {
  firefoxLibrary: files[1], webkitLibrary: files[3], mesaVendor: files[4],
};

test('resolves declared package libraries and explicit EGL vendor without an old browser bundle', () => {
  assert.deepEqual(resolveNixSystemDependencies(path, (file) => files.includes(file)), expected);
});
for (const missing of files) {
  test(`fails closed when required runtime asset is missing: ${missing}`, () => {
    assert.throws(() => resolveNixSystemDependencies(path,
      (file) => file !== missing && files.includes(file)), /Missing Nix browser dependency/);
  });
}
test('does not search undeclared packages or fall back on empty PATH', () => {
  assert.throws(() => resolveNixSystemDependencies('', (file) => files.includes(file)), /firefox/);
});
test('resolves rebuilt store paths instead of retaining previous hashes', () => {
  const replaced = files.map((file) => file.replaceAll('current-', 'rebuilt-'));
  const actual = resolveNixSystemDependencies(path.replaceAll('current-', 'rebuilt-'),
    (file) => replaced.includes(file));
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value.replaceAll('current-', 'rebuilt-'));
  }
});
