import { TRANSFER_MAX_BYTES, TRANSFER_MAX_ROWS, encodeTransferCell } from './orderTransferCsv.js';

// Small inert OOXML transport. All cells are text (including exact decimals).
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
// ST_Xstring escaping prevents Excel interpreting literal "_x0041_" text as A.
const escapeXml = (s) => String(s).replace(/_x[0-9a-f]{4}_/gi, (s) => `_x005F_${s.slice(1)}`).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\r', '&#13;');
const excelText = (s) => s.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function checksum(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = encoder.encode(name), data = encoder.encode(text), crc = checksum(data);
    const header = new Uint8Array(30 + filename.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, filename.length, true);
    header.set(filename, 30); local.push(header, data);
    const entry = new Uint8Array(46 + filename.length), e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x800, true);
    e.setUint32(16, crc, true); e.setUint32(20, data.length, true); e.setUint32(24, data.length, true);
    e.setUint16(28, filename.length, true); e.setUint32(42, offset, true); entry.set(filename, 46);
    central.push(entry); offset += header.length + data.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true);
  e.setUint32(12, central.reduce((n, c) => n + c.length, 0), true); e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: MIME });
}
export function writeOrderWorkbook(rows) {
  const sheet = rows.map((row, i) => `<row r="${i + 1}">${row.map((value, c) => {
    const s = encodeTransferCell(String(value));
    if (s.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw new Error(`Row ${i + 1}: a field exceeds Excel's 32,767-character limit or contains unsupported control characters. Use CSV instead.`);
    return `<c r="${String.fromCharCode(65 + c)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(s)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  });
}
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Workbook document declarations and entities are not accepted.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Workbook contains invalid XML.');
  if (doc.getElementsByTagNameNS('*', 'f').length || doc.getElementsByTagNameNS('*', 'hyperlink').length) throw new Error('Formulas and hyperlinks are not accepted. Save the workbook as plain values.');
  for (const link of doc.getElementsByTagNameNS('*', 'Relationship')) {
    if (link.getAttribute('TargetMode') === 'External' || /(?:^[a-z]+:|^\/\/)/i.test(link.getAttribute('Target') || '')) throw new Error('External workbook links are not accepted.');
  }
  return doc;
}
async function archiveEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('Choose a valid .xlsx workbook.');
  const count = view.getUint16(end + 10, true);
  if (!count || count > 128 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error('Unsupported workbook archive.');
  let position = view.getUint32(end + 16, true), expandedTotal = 0;
  const directoryEnd = position + view.getUint32(end + 12, true);
  if (directoryEnd !== end) throw new Error('Workbook directory is damaged.');
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error('Workbook archive is damaged.');
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true);
    const size = view.getUint32(position + 20, true), expanded = view.getUint32(position + 24, true);
    const length = view.getUint16(position + 28, true), extra = view.getUint16(position + 30, true), comment = view.getUint16(position + 32, true);
    const next = position + 46 + length + extra + comment;
    if (next > directoryEnd) throw new Error('Workbook directory is damaged.');
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + length));
    if (entries.has(name) || /(?:^\/|\\|(?:^|\/)\.\.(?:\/|$)|vba|macro|activeX|embeddings|externalLinks)/i.test(name)) throw new Error('Duplicate, unsafe or active workbook parts are not accepted.');
    expandedTotal += expanded;
    if (flags & 1 || ![0, 8].includes(method) || expandedTotal > 32_000_000 || expanded > 24_000_000) throw new Error('Workbook is encrypted, unsupported or too large when expanded (32 MB maximum).');
    const at = view.getUint32(position + 42, true);
    if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) throw new Error('Workbook archive is damaged.');
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    if (start + size > view.getUint32(end + 16, true)) throw new Error('Workbook archive is damaged.');
    entries.set(name, { start, size, expanded, method, crc: view.getUint32(position + 16, true) });
    position = next;
  }
  if (position !== directoryEnd) throw new Error('Workbook directory is damaged.');
  const documents = new Map();
  // Inspect all XML/relationships, not only the visible first sheet.
  for (const [name, entry] of entries) {
    if (!/\.(xml|rels)$/i.test(name)) throw new Error('Only plain XML spreadsheet parts are accepted; remove embedded media or objects.');
    let data = bytes.subarray(entry.start, entry.start + entry.size);
    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed workbooks. Use CSV instead.');
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const parts = []; let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > entry.expanded || total > 24_000_000) { await reader.cancel(); throw new Error('Workbook expands beyond its declared size.'); }
        parts.push(value);
      }
      data = new Uint8Array(await new Blob(parts).arrayBuffer());
    }
    if (data.length !== entry.expanded || checksum(data) !== entry.crc) throw new Error('Workbook checksum or size is invalid.');
    const text = decoder.decode(data);
    if (name === '[Content_Types].xml' && /macroEnabled|vbaProject|activeX|oleObject/i.test(text)) throw new Error('Active workbook content is not accepted.');
    documents.set(name, xml(text));
  }
  return documents;
}
export async function readOrderWorkbook(file) {
  if (!file.size || file.size > TRANSFER_MAX_BYTES) throw new Error('Choose a nonempty .xlsx file up to 8 MB.');
  const docs = await archiveEntries(file);
  const sheets = docs.get('xl/workbook.xml')?.getElementsByTagNameNS('*', 'sheet');
  if (sheets?.length !== 1) throw new Error('Use the single Orders worksheet from the template.');
  const rel = sheets[0].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const links = docs.get('xl/_rels/workbook.xml.rels')?.getElementsByTagNameNS('*', 'Relationship') || [];
  const target = [...links].find((l) => l.getAttribute('Id') === rel)?.getAttribute('Target');
  if (!target || target.includes('..') || target.includes('\\')) throw new Error('Workbook worksheet reference is invalid.');
  const sheet = docs.get(target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  if (!sheet) throw new Error('Workbook worksheet is missing.');
  const strings = [...(docs.get('xl/sharedStrings.xml')?.getElementsByTagNameNS('*', 'si') || [])].map((node) => excelText([...node.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join('')));
  const nodes = [...sheet.getElementsByTagNameNS('*', 'row')];
  if (nodes.length > TRANSFER_MAX_ROWS + 1) throw new Error('Import at most 10,000 orders at a time.');
  return nodes.map((node, i) => {
    const cells = [];
    for (const cell of node.getElementsByTagNameNS('*', 'c')) {
      const address = cell.getAttribute('r') || '';
      const match = /^([A-H])([1-9]\d*)$/.exec(address);
      if (!match) throw new Error(`Row ${i + 1}: unexpected column. Keep the template's eight columns.`);
      const column = match[1].charCodeAt(0) - 65, type = cell.getAttribute('t');
      if (cells[column] !== undefined) throw new Error(`Row ${i + 1}: duplicate cell.`);
      const raw = cell.getElementsByTagNameNS('*', 'v')[0]?.textContent || '';
      if (!['inlineStr', 's', 'str'].includes(type)) throw new Error(`Row ${i + 1}: keep all columns as text, including dates and JSON. Numeric/date cells can lose precision.`);
      if (type === 's' && (!/^\d+$/.test(raw) || strings[Number(raw)] === undefined)) throw new Error('Workbook shared text reference is invalid.');
      cells[column] = type === 'inlineStr' ? excelText([...cell.getElementsByTagNameNS('*', 't')].map((t) => t.textContent).join('')) : type === 's' ? strings[Number(raw)] : excelText(raw);
    }
    return { line: Number(node.getAttribute('r')) || i + 1, cells };
  }).filter((r) => r.cells.some((s) => s?.trim()));
}
