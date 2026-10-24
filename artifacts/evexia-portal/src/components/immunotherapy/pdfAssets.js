import pdfLicense from 'pdfjs-dist/LICENSE?raw';
import cmapLicense from 'pdfjs-dist/cmaps/LICENSE?raw';
import foxitLicense from 'pdfjs-dist/standard_fonts/LICENSE_FOXIT?raw';
import liberationLicense from 'pdfjs-dist/standard_fonts/LICENSE_LIBERATION?raw';

// The document cannot choose a URL. Only files enumerated from this pinned
// local dependency can be loaded, without cookies or authorization headers.
const assets = {
  cMapUrl: import.meta.glob('../../../node_modules/pdfjs-dist/cmaps/*.bcmap', { eager: true, exhaustive: true, query: '?url', import: 'default' }),
  standardFontDataUrl: import.meta.glob('../../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { eager: true, exhaustive: true, query: '?url', import: 'default' }),
};
const byName = Object.fromEntries(Object.entries(assets).map(([kind, files]) => [
  kind, new Map(Object.entries(files).map(([path, url]) => [path.split('/').at(-1), url])),
]));

export function localBinaryDataFactory(signal) {
  return class LocalBinaryDataFactory {
    async fetch({ kind, filename }) {
      const url = byName[kind]?.get(filename);
      if (!url) throw new Error('This PDF resource is not in the local renderer bundle.');
      const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('A bundled PDF resource is unavailable.');
      return new Uint8Array(await response.arrayBuffer());
    }
  };
}

// Preserve notices alongside the fonts/CMaps in the emitted application.
export const pdfNotices = [
  ['PDF.js', pdfLicense], ['Adobe CMaps', cmapLicense],
  ['Foxit fonts', foxitLicense], ['Liberation fonts', liberationLicense],
];
