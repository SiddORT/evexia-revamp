import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Resolve declared Nix packages, not a particular immutable-store hash or an
// older browser executable. This module is independent of the browser cache.
export function resolveNixSystemDependencies(searchPath, exists = existsSync) {
  const paths = searchPath.split(':').filter(Boolean);
  const library = (command, relative) => {
    const executable = paths.map((path) => join(path, command)).find(exists);
    if (!executable) throw new Error(`Missing Nix browser dependency: ${command}.`);
    const file = join(dirname(dirname(executable)), relative);
    if (!exists(file)) throw new Error(`Missing Nix browser dependency library: ${file}`);
    return file;
  };
  const firefoxLibrary = library('firefox', 'lib/firefox/libxul.so');
  const webkitLibrary = library('WebKitWebDriver', 'lib/libwebkit2gtk-4.1.so.0');
  const mesaVendor = paths.map((path) => join(dirname(path), 'share/glvnd/egl_vendor.d/50_mesa.json')).find(exists);
  if (!mesaVendor) throw new Error('Missing Nix browser dependency: Mesa EGL vendor. Install mesa.');
  return { firefoxLibrary, webkitLibrary, mesaVendor };
}
