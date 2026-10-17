import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const appPath = path.join(root, 'artifacts/api-server/backend/app');
export const manifestPath = path.join(root, 'development-contract.json');
export function candidateIdentity() {
  const raw = fs.readFileSync(manifestPath);
  const contract = JSON.parse(raw);
  if (Object.keys(contract).sort().join() !== 'contract,format,schema' || contract.format !== 1 ||
      !['contract', 'schema'].every(k => typeof contract[k] === 'string' && contract[k])) throw Error('Invalid contract');
  const files = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = path.join(dir, item.name);
      if (item.isDirectory() && item.name !== '__pycache__') visit(name);
      else if (item.isFile() && name.endsWith('.py')) files.push(name);
    }
  }
  visit(appPath);
  const digest = crypto.createHash('sha256').update(raw);
  for (const name of ['pyproject.toml', 'uv.lock']) {
    digest.update(name).update('\0').update(fs.readFileSync(path.join(root, name)));
  }
  for (const file of files.sort()) digest.update(path.relative(appPath, file)).update('\0').update(fs.readFileSync(file));
  return { ...contract, source: digest.digest('hex') };
}

export function developmentCompatibilityPlugin(enabled, base) {
  if (!enabled) return null;
  return {
    name: 'evexia-development-compatibility',
    enforce: 'post',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/vite/dist/client/client.mjs')) return;
      // Vite otherwise reloads on full-reload messages and after reconnection,
      // discarding open drafts. Change only the served dev client, never
      // dependencies on disk or production assets. Fail explicitly if
      // a future Vite runtime no longer has the reviewed recovery interface.
      const reloads = code.match(/\blocation\.reload\(\);/g);
      if (!code.includes('vite:beforeFullReload') || !reloads || reloads.length < 3) {
        throw Error('Development HMR recovery interface is unverified.');
      }
      return { code: code.replace(/\blocation\.reload\(\);/g,
        'window.dispatchEvent(new CustomEvent("evexia:automatic-reload-blocked"));'), map: null };
    },
    configureServer(server) {
      // Compute identity only when an operator explicitly requests diagnostics.
      // No source watcher, invalidation event or compatibility quarantine.
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `${base.replace(/\/$/, '')}/__development-release`) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        try { res.end(JSON.stringify({ format: 1, identity: candidateIdentity() })); }
        catch { res.statusCode = 503; res.end('{"format":1,"error":"contract_unverified"}'); }
      });
    },
  };
}
