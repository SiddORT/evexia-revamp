import { validateInvoicePdfPages, logoAsDataUri, rasterizePage, downloadPdfBytes } from './poInvoicePdf.js';

const WIDTH = 595.28;
const HEIGHT = 841.89;
const SX = WIDTH / 794;
const SY = HEIGHT / 1123;
const encoder = new TextEncoder();
const ascii = (text) => encoder.encode(text);
const number = (value) => Number(value.toFixed(6));

// WinAnsi is deliberately bounded: never transliterate or silently drop a glyph.
const punctuation = new Map([
  ['€', 128], ['‚', 130], ['ƒ', 131], ['„', 132], ['…', 133],
  ['†', 134], ['‡', 135], ['ˆ', 136], ['‰', 137], ['Š', 138],
  ['‹', 139], ['Œ', 140], ['Ž', 142], ['‘', 145], ['’', 146],
  ['“', 147], ['”', 148], ['•', 149], ['–', 150], ['—', 151],
  ['˜', 152], ['™', 153], ['š', 154], ['›', 155], ['œ', 156],
  ['ž', 158], ['Ÿ', 159],
]);

export function encodeReceiptText(text) {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return code;
    if (punctuation.has(character)) return punctuation.get(character);
    throw new Error(`Searchable receipt PDF does not support "${character}" (U+${code.toString(16).toUpperCase().padStart(4, '0')}). Choose Image-only PDF in the receipt preview; no PDF was downloaded.`);
  });
}

/**
 * Read the actual preview SVG, not the source model. Browser SVG geometry includes
 * wrapping, anchors, letter spacing and bold text. Nothing is inferred from live data.
 */
export function measureReceiptTextPages(pages) {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    throw new Error('Searchable receipt PDF requires a browser with SVG text measurement.');
  }
  return pages.map((svg) => {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new Error('The receipt preview SVG could not be read.');
    const root = document.importNode(parsed.documentElement, true);
    if (root.localName !== 'svg' || root.getAttribute('viewBox') !== '0 0 794 1123') {
      throw new Error('Searchable receipt PDF requires the original A4 receipt preview.');
    }
    // Remove the logo before attaching: the only network request is the same-origin
    // logo loaded by the existing rasterizer, never a placeholder URL.
    root.querySelectorAll('image').forEach((image) => image.remove());
    root.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    root.setAttribute('aria-hidden', 'true');
    try {
      document.body.appendChild(root);
      return Array.from(root.querySelectorAll('text')).flatMap((node) => {
        // SVG's default whitespace processing collapses spaces and removes
        // leading/trailing whitespace before indexing addressable characters.
        const text = node.textContent.replace(/[ \t\r\n]+/g, ' ').replace(/^ +| +$/g, '');
        if (!text) return [];
        encodeReceiptText(text);
        const glyphs = Array.from(text, (_, index) => ({
          x: node.getStartPositionOfChar(index).x,
          width: node.getSubStringLength(index, 1),
        }));
        const run = {
          text, x: glyphs[0]?.x, y: Number(node.getAttribute('y')),
          size: Number(node.getAttribute('font-size')),
          width: node.getComputedTextLength(), glyphs,
        };
        if (![run.x, run.y, run.size, run.width].every(Number.isFinite) ||
          run.size <= 0 || run.width <= 0) {
          throw new Error('Receipt text could not be positioned safely; no PDF was downloaded.');
        }
        return [run];
      });
    } finally {
      root.remove();
    }
  });
}

/**
 * The text font has explicit fixed widths. It is invisible (PDF rendering mode 3);
 * each glyph's advance is supplied by the shared SVG layout. ToUnicode preserves
 * accents, punctuation and XML-escaped input in search/copy results.
 */
function textContent(runs) {
  return runs.map((run) => {
    const bytes = encodeReceiptText(run.text);
    if (![run.x, run.y, run.size, run.width].every(Number.isFinite) ||
      run.size <= 0 || run.width <= 0 || !bytes.length) {
      throw new Error('Receipt text has invalid PDF geometry.');
    }
    if (!Array.isArray(run.glyphs) || run.glyphs.length !== bytes.length) {
      throw new Error('Receipt text is missing measured glyph positions.');
    }
    const glyphs = bytes.map((byte, index) => {
      const glyph = run.glyphs[index];
      if (!Number.isFinite(glyph.x) || !Number.isFinite(glyph.width) || glyph.width <= 0) {
        throw new Error('Receipt text has invalid glyph geometry.');
      }
      const scale = glyph.width / run.size;
      return `${number(scale * SX)} 0 0 ${number(SY)} ${number(glyph.x * SX)} ${number(HEIGHT - run.y * SY)} Tm <${byte.toString(16).padStart(2, '0')}> Tj`;
    });
    return `BT /FReceipt ${number(run.size)} Tf 3 Tr\n${glyphs.join('\n')}\nET`;
  }).join('\n');
}

function unicodeMap() {
  const pairs = [];
  for (let code = 32; code <= 255; code++) {
    const character = [...punctuation].find(([, byte]) => byte === code)?.[0] ||
      ((code <= 126 || code >= 160) ? String.fromCharCode(code) : null);
    if (character) pairs.push(`<${code.toString(16).padStart(2, '0')}> <${character.codePointAt(0).toString(16).padStart(4, '0')}>`);
  }
  const chunks = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /ReceiptUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

export function buildReceiptPdf(jpegPages, textPages) {
  // Reuse the existing strict JPEG validation; PO serialization remains untouched.
  const images = validateInvoicePdfPages(jpegPages);
  if (!Array.isArray(textPages) || textPages.length !== jpegPages.length ||
    textPages.some((runs) => !Array.isArray(runs) || !runs.length)) {
    throw new Error('Searchable receipt text must be present for every PDF page.');
  }
  const contents = textPages.map(textContent); // Validate before producing any bytes.
  const count = 6 + jpegPages.length * 3;
  const parts = [ascii('%PDF-1.4\n'), new Uint8Array([37, 226, 227, 207, 211, 10])];
  let length = parts.reduce((sum, part) => sum + part.length, 0);
  const offsets = Array(count + 1).fill(0);
  function object(id, body) {
    offsets[id] = length;
    const data = [ascii(`${id} 0 obj\n`), ...body, ascii('\nendobj\n')];
    parts.push(...data);
    length += data.reduce((sum, part) => sum + part.length, 0);
  }
  function stream(id, data, dictionary = '') {
    object(id, [ascii(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data, ascii('\nendstream')]);
  }
  object(1, [ascii('<< /Type /Catalog /Pages 2 0 R >>')]);
  object(2, [ascii(`<< /Type /Pages /Count ${jpegPages.length} /Kids [${jpegPages.map((_, i) => `${7 + i * 3} 0 R`).join(' ')}] >>`)]);
  // A blank Type3 glyph ensures consistent declared widths across PDF viewers.
  // It is a real text font, not OCR or an annotation. The image owns all visuals.
  const codes = Array.from({ length: 224 }, (_, i) => i + 32);
  object(3, [ascii(`<< /Type /Font /Subtype /Type3 /Name /FReceipt /FontBBox [0 -250 1000 800] /FontMatrix [0.001 0 0 0.001 0 0] /FirstChar 32 /LastChar 255 /Widths [${codes.map(() => '1000').join(' ')}] /Encoding << /Type /Encoding /Differences [32 ${codes.map((code) => `/g${code}`).join(' ')}] >> /CharProcs << ${codes.map((code) => `/g${code} 5 0 R`).join(' ')} >> /Resources << >> /ToUnicode 4 0 R >>`)]);
  stream(4, ascii(unicodeMap()));
  stream(5, ascii('1000 0 d0'));
  object(6, [ascii('<< /Producer (EVEXIA on-device receipt PDF) >>')]);
  images.forEach((page, index) => {
    const id = 7 + index * 3;
    object(id, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> /Font << /FReceipt 3 0 R >> >> /Contents ${id + 2} 0 R >>`)]);
    stream(id + 1, page.bytes, `/Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`);
    stream(id + 2, ascii(`q\n${WIDTH} 0 0 ${HEIGHT} 0 0 cm\n/Im0 Do\nQ\n${contents[index]}`));
  });
  const start = length;
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= count; id++) {
    if (!Number.isSafeInteger(offsets[id]) || offsets[id] > 9999999999) throw new Error('Receipt PDF is too large.');
    xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  parts.push(ascii(`${xref}trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${start}\n%%EOF\n`));
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export async function downloadSearchableReceipt(document, filename, logoUrl) {
  const textPages = measureReceiptTextPages(document.pages);
  const logo = await logoAsDataUri(logoUrl);
  const images = [];
  for (let i = 0; i < document.pages.length; i++) {
    images.push(await rasterizePage(document.pages[i], logo, i + 1));
  }
  return downloadPdfBytes(buildReceiptPdf(images, textPages), filename);
}