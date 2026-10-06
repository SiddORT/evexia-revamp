import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

test('production startup stays small and heavy routes remain deferred with base-safe assets', () => {
  const portal = fileURLToPath(new URL('..', import.meta.url));
  const output = mkdtempSync(path.join(tmpdir(), 'evexia-startup-build-'));
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'vite.config.js', '--outDir', output, '--manifest'], {
      cwd: portal, env: { ...process.env, BASE_PATH: '/portal/' }, stdio: 'pipe',
    });
    const manifest = JSON.parse(readFileSync(path.join(output, '.vite/manifest.json'), 'utf8'));
    const entry = Object.entries(manifest).find(([, chunk]) => chunk.isEntry);
    assert.ok(entry, 'missing startup entry');
    const initial = new Set();
    function visit(key) {
      if (initial.has(key)) return;
      initial.add(key);
      for (const dependency of manifest[key].imports || []) visit(dependency);
    }
    visit(entry[0]);
    let bytes = 0;
    let compressed = 0;
    for (const key of initial) {
      const source = readFileSync(path.join(output, manifest[key].file));
      bytes += source.length;
      compressed += gzipSync(source).length;
    }
    assert.ok(bytes < 450_000, `Initial JS exceeded 450 KB: ${bytes}`);
    assert.ok(compressed < 140_000, `Initial gzip exceeded 140 KB: ${compressed}`);
    for (const name of ['AdminSettings', 'PurchaseOrderFormPage', 'PurchaseReceivedFormPage', 'PatientFormPage', 'DoctorFormPage', 'MasterExcelImportPage', 'ActivityLogs']) {
      const key = `src/pages/admin/${name}.jsx`;
      assert.ok(manifest[key]?.isDynamicEntry, `${name} is not a deferred route`);
      assert.ok(!initial.has(key), `${name} leaked into startup imports`);
    }
    const html = readFileSync(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /src="\/portal\/assets\/[^"]+\.js"/);
    assert.match(html, /href="\/portal\/loading\.css"/);
    assert.match(html, /src="\/portal\/images\/evexia-logo\.png"/);
    assert.ok(!html.includes('rel="modulepreload"'), 'unexpected initial shared-chunk preload; include it in the budget if added');
    console.log(`Initial JS: ${(bytes / 1000).toFixed(2)} KB; gzip: ${(compressed / 1000).toFixed(2)} KB (baseline 1135.81 / 301.67 KB).`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
