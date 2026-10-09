import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

// Usage: node scripts/render-responsive-audit.mjs <Playwright JSON> <destination> [earlier JSON ...] [--after-panels=JSON]
// Copies only test evidence, never the private fixture logs or credentials.
const [resultPath, destination, ...baselinePaths] = process.argv.slice(2);
if (!resultPath || !destination) throw new Error('Supply a Playwright JSON summary and output directory.');
await mkdir(destination, { recursive: true });
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const results = [];
async function extract(file, phase) {
  const json = JSON.parse(await readFile(file, 'utf8'));
  async function walk(suite) {
    for (const child of suite.suites || []) await walk(child);
    for (const spec of suite.specs || []) for (const test of spec.tests) for (const result of test.results) {
      const coverage = result.attachments.find((item) => item.name === 'coverage');
      if (result.status === 'passed' && !coverage) throw new Error(`Missing coverage evidence for ${test.projectName}`);
      const data = coverage ? JSON.parse(coverage.path ? await readFile(coverage.path, 'utf8') : Buffer.from(coverage.body, 'base64').toString()) : { records: [], failures: [] };
      const images = [];
      for (const attachment of result.attachments.filter((item) => item.contentType === 'image/png').slice(0, 12)) {
        const filename = `${phase}-${test.projectName}-${attachment.name}.png`;
        const out = path.join(destination, filename);
        if (attachment.path) await copyFile(attachment.path, out);
        else await writeFile(out, Buffer.from(attachment.body, 'base64'));
        images.push({ filename, name: attachment.name, data: (await readFile(out)).toString('base64') });
      }
      const engineAttachment = result.attachments.find((item) => item.name === 'engine');
      const engineEvidence = engineAttachment ? (engineAttachment.path ? await readFile(engineAttachment.path, 'utf8') : Buffer.from(engineAttachment.body, 'base64').toString()) : 'Not recorded';
      results.push({ phase, engine: test.projectName, engineEvidence, status: result.status, duration: result.duration, errors: result.errors, ...data, images });
    }
  }
  for (const suite of json.suites) await walk(suite);
}
for (const [index, baselinePath] of baselinePaths.filter((item) => !item.startsWith('--after-panels=')).entries()) await extract(baselinePath, `before-${index + 1}`);
await extract(resultPath, 'after');
for (const supplemental of baselinePaths.filter((item) => item.startsWith('--after-panels='))) await extract(supplemental.slice('--after-panels='.length), 'after-panels');
await writeFile(path.join(destination, 'measurements.json'), JSON.stringify(results.map(({ images, ...result }) => result), null, 2));
const sections = results.map((result) => `<section><h2>${escape(result.phase)}: ${escape(result.engine)} — ${escape(result.status)}</h2>
<p>${escape(result.engineEvidence)}</p><p>${result.records.length} measured states; ${result.failures.length} layout failures; ${(result.duration / 1000).toFixed(1)} seconds.</p>
${result.errors.map((error) => `<pre>${escape(error.message)}</pre>`).join('')}
<details><summary>Exact route / panel, viewport and measured result</summary><table><thead><tr><th>Surface</th><th>CSS viewport</th><th>Result</th><th>Contained scroll areas</th></tr></thead><tbody>
${result.records.map((record) => `<tr><td>${escape(record.surface)}</td><td>${record.viewport.width}×${record.viewport.height}</td><td>${record.issues.length ? escape(record.issues.join('; ')) : 'PASS'}</td><td>${escape(JSON.stringify(record.scrolls))}</td></tr>`).join('')}</tbody></table></details>
${result.images.map((image) => `<figure><figcaption>${escape(image.filename)}</figcaption><img src="data:image/png;base64,${image.data}" alt="${escape(image.name)}"></figure>`).join('')}</section>`).join('');
let summary = '';
try {
  summary = await readFile(path.join(path.dirname(destination), 'audit.md'), 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await writeFile(path.join(destination, 'audit.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>EVEXIA responsiveness audit evidence</title>
<style>body{font:15px/1.5 system-ui;margin:24px auto;padding:0 20px;max-width:1200px;color:#25282b}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccc;text-align:left;padding:8px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}.overview{font:inherit}section{border-top:2px solid #c94a36;margin-top:30px}img{max-width:100%;max-height:750px;object-fit:contain}figure{margin:20px 0}details{overflow:auto}summary{cursor:pointer;font-weight:bold}</style>
<h1>EVEXIA Portal — responsive browser evidence</h1><p>CSS viewport emulation using isolated synthetic accounts and a disposable local PostgreSQL/API fixture. WebKit is not native Safari. No physical devices, operating-system keyboards, managed records or production deployment were tested.</p>
<p>A PASS row concerns its measured state only, not all possible content or interactions.</p>${summary ? `<section><h2>Audit summary and limits</h2><pre class="overview">${escape(summary)}</pre></section>` : ''}${sections}</html>`);
console.log(`Evidence written to ${destination}/audit.html`);
