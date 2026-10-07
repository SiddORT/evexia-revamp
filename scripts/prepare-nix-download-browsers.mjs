// NixOS-only adapter for the CURRENT Playwright engines, never old engine
// substitutions. It changes cached process interpreters, not browser code,
// protocol schemas, application gates, or shared-library ABIs.
import { firefox, webkit } from '@playwright/test';
import { existsSync, openSync, readSync, closeSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const source = process.env.EVEXIA_NIX_BROWSER_LIBRARY_SOURCE;
const loader = process.env.EVEXIA_NIX_BROWSER_LOADER;
if (!source || !loader || !existsSync(loader)) {
  throw new Error('Nix download engines need EVEXIA_NIX_BROWSER_LIBRARY_SOURCE and an existing EVEXIA_NIX_BROWSER_LOADER.');
}
const firefoxExe = firefox.executablePath();
const webkitRoot = dirname(webkit.executablePath());
if (!existsSync(firefoxExe) || !existsSync(join(webkitRoot, 'minibrowser-wpe/bin/MiniBrowser'))) {
  console.log('Installing missing current Playwright Firefox/WebKit assets for the isolated download gate.');
  execFileSync('pnpm', ['exec', 'playwright', 'install', 'firefox', 'webkit'], { stdio: 'inherit' });
  if (!existsSync(firefoxExe) || !existsSync(join(webkitRoot, 'minibrowser-wpe/bin/MiniBrowser'))) {
    throw new Error('The current Playwright Firefox/WebKit assets are still missing after installation.');
  }
}
const rpath = (file) => execFileSync('patchelf', ['--print-rpath', file], { encoding: 'utf8' }).trim().split(':');
const engineDir = (prefix) => {
  const name = readdirSync(source).filter((name) => new RegExp(`^${prefix}-\\d+$`).test(name))
    .sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))[0];
  if (!name) throw new Error(`Nix library source has no ${prefix} bundle.`);
  return join(source, name);
};
const oldFirefox = join(engineDir('firefox'), 'firefox');
const oldWebkit = join(engineDir('webkit'), 'minibrowser-wpe');
const libraries = new Set();
const add = (paths) => paths.forEach((path) => {
  // Never load an old browser's private code or mix libc with another loader.
  if (path && !path.includes('playwright') && !path.includes('glibc') && existsSync(path)) libraries.add(path);
});
// The preinstalled Nix bundle supplies system dependency paths only. Its
// Firefox/WebKit executables are protocol-incompatible with current Playwright.
add(rpath(join(oldFirefox, 'libxul.so')));
add(rpath(join(oldWebkit, 'lib/libWPEWebKit-2.0.so.1')));
for (const name of ['icuinfo', 'avifdec']) {
  const executable = process.env.PATH.split(':').map((path) => join(path, name)).find(existsSync);
  if (!executable) throw new Error(`Missing Nix browser dependency: ${name}. Install icu74 and libavif.`);
  add(rpath(executable));
}
add(process.env.PATH.split(':').filter((path) => path.startsWith('/nix/store/') && path.endsWith('/bin')).map((path) => join(dirname(path), 'lib')));
add(readdirSync('/repl/tools').map((name) => join('/repl/tools', name, 'lib')));

function adaptProcesses(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) adaptProcesses(file);
    else if (entry.isFile()) {
      // patchelf must not rewrite shared libraries (including bundled NSS).
      const fd = openSync(file, 'r'), header = Buffer.alloc(4);
      try { readSync(fd, header, 0, 4, 0); } finally { closeSync(fd); }
      if (!header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) continue;
      const probe = spawnSync('patchelf', ['--print-interpreter', file], { encoding: 'utf8' });
      if (probe.status === 0 && probe.stdout.trim() !== loader) {
        execFileSync('patchelf', ['--set-interpreter', loader, file]);
      }
    }
  }
}
adaptProcesses(webkitRoot);
const wpe = join(webkitRoot, 'minibrowser-wpe');
const manifest = {
  firefox: {
    executablePath: firefoxExe,
    // Raw Firefox works with its stock loader and these older Nix GTK libs.
    env: { LD_LIBRARY_PATH: [dirname(firefoxExe), ...rpath(join(oldFirefox, 'libxul.so')).filter((p) => p && !p.includes('playwright'))].join(':') },
  },
  webkit: {
    executablePath: join(wpe, 'bin/MiniBrowser'),
    env: {
      LD_LIBRARY_PATH: [join(wpe, 'lib'), join(wpe, 'sys/lib'), ...libraries, dirname(loader)].join(':'),
      WEBKIT_EXEC_PATH: join(wpe, 'bin'),
      WEBKIT_INJECTED_BUNDLE_PATH: join(wpe, 'lib'),
      WEBKIT_INSPECTOR_RESOURCES_PATH: join(wpe, 'share'),
    },
  },
};
mkdirSync('.cache', { recursive: true });
writeFileSync(resolve('.cache/evexia-download-engines.json'), JSON.stringify(manifest, null, 2));
console.log('Prepared current Firefox and WebKit engines using isolated Nix launch environments.');
