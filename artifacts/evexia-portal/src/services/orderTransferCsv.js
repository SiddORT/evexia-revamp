export const TRANSFER_MAX_BYTES = 8_000_000;
export const TRANSFER_MAX_ROWS = 10_000;
// RFC 4180, preserving whitespace and decimal lexemes. No master-service imports.
export function readOrderCsv(text) {
  if (!text || new TextEncoder().encode(text).length > TRANSFER_MAX_BYTES || text.includes('\0')) throw new Error('Choose a nonempty UTF-8 CSV up to 8 MB, without binary characters.');
  const input = text.replace(/^\uFEFF/, '');
  const rows = [];
  let cells = [], value = '', quoted = false, closed = false, line = 1, start = 1;
  const addRow = () => {
    cells.push(value);
    if (cells.some((s) => s.trim())) rows.push({ line: start, cells });
    if (rows.length > TRANSFER_MAX_ROWS + 1) throw new Error('Import at most 10,000 orders at a time.');
    cells = []; value = ''; closed = false;
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else { value += c; if (c === '\n') line++; }
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (c === ',') { cells.push(value); value = ''; closed = false; if (cells.length > 8) throw new Error(`Line ${line}: too many columns.`); }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      addRow(); line++; start = line;
    } else {
      if (closed || c === '"') throw new Error(`Line ${line}: unexpected text after a quoted field.`);
      value += c;
    }
  }
  if (quoted) throw new Error(`Line ${start}: close the quoted field.`);
  addRow();
  return rows;
}
// Reversible escaping, including literal leading apostrophes.
export const encodeTransferCell = (value) => /^'|^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
export const decodeTransferCell = (value) => /^'(?:'|[\s\u0000-\u001f]*[=+\-@])/.test(value) ? value.slice(1) : value;
export const writeOrderCsv = (rows) => '\uFEFF' + rows.map((r) => r.map((v) => `"${encodeTransferCell(String(v)).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
