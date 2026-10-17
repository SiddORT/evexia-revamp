import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { candidateIdentity, root } from './development-identity.mjs';

const app = path.join(root, 'artifacts/evexia-portal');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export function frontendIdentity() {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  visit(path.join(app, 'src'));
  visit(path.join(app, 'public'));
  files.push(path.join(app, 'index.html'), path.join(app, 'vite.config.js'),
    path.join(app, 'package.json'), path.join(root, 'pnpm-lock.yaml'),
    fileURLToPath(import.meta.url), path.join(root, 'scripts/development-identity.mjs'));
  const hash = crypto.createHash('sha256');
  for (const file of files.sort()) {
    hash.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file)).update('\0');
  }
  return { format: 1, frontend: hash.digest('hex'), backend: candidateIdentity() };
}

export function frontendRuntimePlugin(base) {
  let loaded;
  return {
    name: 'evexia-served-runtime-identity',
    configResolved() { loaded = frontendIdentity(); },
    configureServer(server) {
      // Freeze at startup. A stale Vite process must not claim a new build.
      const body = JSON.stringify({ ...loaded, mode: 'development', assets: {} });
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== `${base.replace(/\/$/, '')}/release-runtime.json`) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
    generateBundle: { order: 'post', handler(_options, bundle) {
      const assets = {};
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'chunk') assets[name] = sha(item.code);
        else assets[name] = sha(item.source);
      }
      this.emitFile({ type: 'asset', fileName: 'release-runtime.json',
        source: JSON.stringify({ ...loaded, mode: 'build', assets }) });
    } },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(frontendIdentity()));
}
