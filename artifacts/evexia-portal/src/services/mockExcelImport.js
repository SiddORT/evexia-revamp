import { loadZones } from './zones.js';
import { loadCourierPartners } from './courierPartners.js';
import { loadMRs, MR_STORAGE_KEY } from './mrs.js';
import { loadDoctors } from './doctors.js';

export const EXCEL_TEMPLATES = {
  zone: {
    title: 'Zone',
    columns: ['Zone Name', 'Status'],
    sample: [['Example Central Zone', 'active'], ['Example Coastal Zone', 'inactive']],
  },
  'courier-partner': {
    title: 'Courier Partner',
    columns: ['Courier Partner Name', 'Status'],
    sample: [['Example Express Delivery', 'active'], ['Example City Courier', 'inactive']],
  },
  mr: {
    title: 'MR',
    columns: ['MR Name', 'Employee Code', 'Phone', 'Email', 'Assigned Zone', 'Status'],
    sample: [['Example Priya Rao', 'EX-MR-101', '9876543210', 'priya@example.com', '', 'active']],
  },
  doctor: {
    title: 'Doctor',
    columns: ['Doctor Name', 'Registration Number', 'Phone', 'Email', 'Assigned MR', 'Status'],
    sample: [['Example Dr. Ananya Shah', 'EX-DOC-101', '9876543210', 'ananya@example.com', '', 'active']],
  },
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const escapeXML = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const norm = (value) => String(value ?? '').trim().toLocaleLowerCase();
function existingMRs() {
  let raw;
  try { raw = window.localStorage.getItem(MR_STORAGE_KEY); }
  catch { throw new Error('MR records could not be loaded because browser storage is unavailable.'); }
  // Do not create sample MR records just to review an Excel file.
  return raw === null ? [] : loadMRs();
}

// Small, dependency-free XLSX writer for the sample template. Files are regular
// ZIP/OOXML workbooks, so Excel, LibreOffice and other spreadsheet apps open them.
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);
    local.push(header, data);

    const directory = new Uint8Array(46 + nameBytes.length);
    const index = new DataView(directory.buffer);
    index.setUint32(0, 0x02014b50, true);
    index.setUint16(4, 20, true);
    index.setUint16(6, 20, true);
    index.setUint16(8, 0x0800, true);
    index.setUint32(16, checksum, true);
    index.setUint32(20, data.length, true);
    index.setUint32(24, data.length, true);
    index.setUint16(28, nameBytes.length, true);
    index.setUint32(42, offset, true);
    directory.set(nameBytes, 46);
    central.push(directory);
    offset += header.length + data.length;
  }
  const directorySize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const final = new DataView(end.buffer);
  final.setUint32(0, 0x06054b50, true);
  final.setUint16(8, central.length, true);
  final.setUint16(10, central.length, true);
  final.setUint32(12, directorySize, true);
  final.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function sampleExcel(kind) {
  const template = EXCEL_TEMPLATES[kind];
  if (!template) throw new Error('Unknown master.');
  const sample = template.sample.map((row) => [...row]);
  if (kind === 'mr') sample[0][4] = loadZones().find((zone) => zone.status === 'active')?.name || 'Enter an active zone name';
  if (kind === 'doctor') sample[0][4] = existingMRs().find((mr) => mr.status === 'active')?.name || 'Enter a saved MR name';
  const rows = [template.columns, ...sample];
  const sheet = rows.map((row, index) => `<row r="${index + 1}">${row.map((value, column) =>
    `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${escapeXML(value)}</t></is></c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
  });
}

async function zipEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This is not a readable .xlsx workbook.');
  const count = view.getUint16(end + 10, true);
  if (count > 256) throw new Error('The workbook contains too many files.');
  let position = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (position + 46 > bytes.length || view.getUint32(position, true) !== 0x02014b50) throw new Error('The Excel workbook is damaged.');
    const method = view.getUint16(position + 10, true);
    const size = view.getUint32(position + 20, true);
    const expanded = view.getUint32(position + 24, true);
    const nameSize = view.getUint16(position + 28, true);
    const extra = view.getUint16(position + 30, true);
    const comment = view.getUint16(position + 32, true);
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameSize));
    const localOffset = view.getUint32(position + 42, true);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('The Excel workbook is damaged.');
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + size > bytes.length) throw new Error('The Excel workbook is damaged.');
    entries.set(name, { method, size, expanded, start });
    position += 46 + nameSize + extra + comment;
  }
  async function read(name) {
    const entry = entries.get(name);
    if (!entry) throw new Error('The Excel workbook is missing a required worksheet.');
    if (entry.expanded > 4_000_000) throw new Error('The worksheet is too large (4 MB maximum).');
    const data = bytes.subarray(entry.start, entry.start + entry.size);
    if (entry.method === 0) return decoder.decode(data);
    if (entry.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('This workbook uses an unsupported compression format.');
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 4_000_000) { await reader.cancel(); throw new Error('The worksheet is too large (4 MB maximum).'); }
        chunks.push(value);
      }
      return decoder.decode(await new Blob(chunks).arrayBuffer());
    } catch (error) {
      if (error.message?.includes('too large')) throw error;
      throw new Error('The Excel workbook could not be decompressed.');
    }
  }
  return { read, has: (name) => entries.has(name) };
}

function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The Excel workbook contains invalid worksheet data.');
  return doc;
}

export async function readExcelRows(file) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose an .xlsx Excel workbook.');
  if (file.size > 2_000_000) throw new Error('Choose an .xlsx file smaller than 2 MB.');
  if (!file.size) throw new Error('The selected file is empty.');
  const archive = await zipEntries(file);
  const workbook = xml(await archive.read('xl/workbook.xml'));
  const first = workbook.getElementsByTagNameNS('*', 'sheet')[0];
  if (!first) throw new Error('The workbook has no worksheet.');
  const relation = first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rels = xml(await archive.read('xl/_rels/workbook.xml.rels'));
  const link = [...rels.getElementsByTagNameNS('*', 'Relationship')].find((item) => item.getAttribute('Id') === relation);
  const target = link?.getAttribute('Target');
  if (!target || target.includes('..') || /^[a-z]+:/i.test(target)) throw new Error('The workbook has an unsupported worksheet.');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const strings = archive.has('xl/sharedStrings.xml') ? [...xml(await archive.read('xl/sharedStrings.xml')).getElementsByTagNameNS('*', 'si')]
    .map((item) => [...item.getElementsByTagNameNS('*', 't')].map((part) => part.textContent).join('')) : [];
  const sheet = xml(await archive.read(path));
  const nodes = [...sheet.getElementsByTagNameNS('*', 'row')];
  if (nodes.length > 1001) throw new Error('Review at most 1,000 rows at a time.');
  const rows = nodes.map((row, index) => {
    const cells = [];
    for (const cell of row.getElementsByTagNameNS('*', 'c')) {
      const address = cell.getAttribute('r') || '';
      const letters = address.match(/^[A-Z]+/)?.[0] || '';
      const column = [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      if (column < 0 || column > 100) continue;
      const type = cell.getAttribute('t');
      const value = type === 'inlineStr'
        ? [...cell.getElementsByTagNameNS('*', 't')].map((part) => part.textContent).join('')
        : cell.getElementsByTagNameNS('*', 'v')[0]?.textContent || '';
      cells[column] = type === 's' ? (strings[Number(value)] ?? '') : value;
    }
    return { line: Number(row.getAttribute('r')) || index + 1, cells };
  }).filter((row) => row.cells.some((cell) => String(cell ?? '').trim()));
  if (rows.length < 2) throw new Error('The first worksheet needs a header and at least one data row.');
  return rows;
}

export function reviewExcel(kind, rows) {
  const template = EXCEL_TEMPLATES[kind];
  if (!template) throw new Error('Unknown master.');
  const headers = rows[0].cells.map((cell) => String(cell ?? '').trim());
  if (headers.length !== template.columns.length || template.columns.some((value, index) => headers[index] !== value)) {
    throw new Error(`Column headers must match the sample Excel file: ${template.columns.join(', ')}.`);
  }
  const zones = kind === 'mr' ? loadZones() : [];
  const mrs = kind === 'mr' || kind === 'doctor' ? existingMRs() : [];
  const doctors = kind === 'doctor' ? loadDoctors() : [];
  const savedZones = kind === 'zone' ? loadZones() : zones;
  const savedCouriers = kind === 'courier-partner' ? loadCourierPartners() : [];
  const seen = new Set((kind === 'zone' ? savedZones : kind === 'courier-partner' ? savedCouriers : kind === 'mr' ? mrs : doctors)
    .map((entry) => kind === 'courier-partner' ? norm(entry.name).replace(/\s+/gu, ' ') : norm(kind === 'zone' ? entry.name : kind === 'mr' ? entry.employeeCode : entry.registrationNumber)));
  return rows.slice(1).map((row) => {
    const values = template.columns.map((_, index) => String(row.cells[index] ?? '').trim());
    const errors = [];
    if (row.cells.length > template.columns.length) errors.push(`Expected ${template.columns.length} columns; found ${row.cells.length}.`);
    if (!values[0]) errors.push(`${template.columns[0]} is required.`);
    const uniqueIndex = kind === 'zone' || kind === 'courier-partner' ? 0 : 1;
    if (!values[uniqueIndex]) errors.push(`${template.columns[uniqueIndex]} is required.`);
    else if (seen.has(kind === 'courier-partner' ? norm(values[uniqueIndex]).replace(/\s+/gu, ' ') : norm(values[uniqueIndex]))) errors.push(`${template.columns[uniqueIndex]} already exists in saved records or this file.`);
    if (values[uniqueIndex]) seen.add(kind === 'courier-partner' ? norm(values[uniqueIndex]).replace(/\s+/gu, ' ') : norm(values[uniqueIndex]));
    if (kind !== 'zone' && kind !== 'courier-partner') {
      if (!/^\+?[\d ()-]{10,20}$/.test(values[2]) || !/^\d{10,15}$/.test(values[2].replace(/\D/g, ''))) errors.push('Phone must contain 10–15 digits.');
      if (values[3] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[3])) errors.push('Email must be a valid email address.');
      if (!values[4]) errors.push(`${template.columns[4]} is required.`);
      else if (kind === 'mr' && !zones.some((zone) => norm(zone.name) === norm(values[4]) && zone.status === 'active')) errors.push('Assigned Zone must match an active saved zone.');
      else if (kind === 'doctor' && !mrs.some((mr) => norm(mr.name) === norm(values[4]) && mr.status === 'active')) errors.push('Assigned MR must match an active saved MR.');
    }
    if (!['active', 'inactive'].includes(values.at(-1))) errors.push('Status must be active or inactive.');
    return { line: row.line, values, errors };
  });
}