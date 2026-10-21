export function abbreviation(name) {
  const words = [];
  let word = [];
  for (const char of name.normalize('NFC')) {
    if (/\p{L}/u.test(char)) word.push(char);
    else if (/\p{M}/u.test(char) && word.length) continue;
    else if (word.length) { words.push(word); word = []; }
  }
  if (word.length) words.push(word);
  const letters = words.length === 1 ? words[0].slice(0, 2) : words.map((part) => part[0]);
  return Array.from(letters.join('').toUpperCase()).slice(0, 16).join('');
}

// Python str.split/strip whitespace, explicit to avoid JS's extra BOM rule.
const whitespace = '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
export const trimText = (text) => text.replace(new RegExp(`^${whitespace}+|${whitespace}+$`, 'gu'), '');
export const normalizeName = (name) => trimText(name).replace(new RegExp(`${whitespace}+`, 'gu'), ' ');
export const normalizeCode = (code) => trimText(code).toUpperCase();
export function validateHeadquarter(values) {
  const errors = {};
  const name = normalizeName(values.name);
  const code = normalizeCode(values.state_code);
  const invalid = (value) => /[\p{C}\uFFFE\uFFFF]/u.test(value);
  if (!name || Array.from(name).length > 200 || invalid(name)) errors.name = 'Use 1–200 printable characters.';
  if (!code || Array.from(code).length > 16 || invalid(code)) errors.state_code = 'Use 1–16 printable characters. Names without letters need a manual code.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Select a status.';
  return errors;
}

const printableBad = (value) => /[\p{C}\uFFFE\uFFFF]/u.test(value);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const MAX_AREAS = 200;
export const newAreaRow = () => ({ key: `n${Date.now()}${Math.random().toString(36).slice(2)}`, id: null, name: '', code: '', manual: false });
export const savedAreaRow = (area) => ({ key: area.id, id: area.id, name: area.name, code: area.code, manual: true });

/** Derive suggested codes for new automatic rows (never stored; submitted omitted). */
export function suggestCodes(rows, prefix, base) {
  const p = normalizeCode(prefix || '');
  const digits = p ? new RegExp(`^${escapeRe(p)}(\\d+)$`) : null;
  const explicit = new Set();
  let floor = Math.max(1, Number(base) || 1);
  for (const row of rows) {
    if (row.id || row.manual) {
      const code = normalizeCode(row.code || '');
      if (code) explicit.add(code);
      const hit = digits && digits.exec(code);
      if (hit && Number(hit[1]) <= 2147483646) floor = Math.max(floor, Number(hit[1]) + 1);
    }
  }
  const result = {};
  let seq = floor;
  for (const row of rows) {
    if (row.id || row.manual) continue;
    while (explicit.has(`${p}${seq}`)) seq += 1;
    result[row.key] = seq <= 2147483646 ? `${p}${seq}` : '';
    seq += 1;
  }
  return result;
}

export function validateAreas(rows, suggestions) {
  const errors = {};
  const names = new Map();
  const codes = new Map();
  if (rows.length > MAX_AREAS) errors._ = `A headquarter can have at most ${MAX_AREAS} areas.`;
  for (const row of rows) {
    const name = normalizeName(row.name);
    const auto = !row.id && !row.manual;
    const code = normalizeCode(auto ? suggestions[row.key] || '' : row.code || '');
    const list = [];
    const blank = !name && (auto || !trimText(row.code || ''));
    if (blank && auto) list.push('Enter an area name or remove this row.');
    else {
      if (!name || Array.from(name).length > 200 || printableBad(name)) list.push('Area name: use 1-200 printable characters.');
      if (!auto && (!code || Array.from(code).length > 32 || printableBad(code))) list.push('Area code: use 1-32 printable characters.');
      if (auto && (!code || Array.from(code).length > 32 || printableBad(code))) list.push('Suggested numbering is unavailable; enter a manual code.');
      if (name) { const k = name.toLowerCase(); if (names.has(k)) list.push('Duplicate area name in this headquarter.'); names.set(k, true); }
      if (code) { const k = code.toLowerCase(); if (codes.has(k)) list.push('Duplicate area code in this headquarter.'); codes.set(k, true); }
    }
    if (list.length) errors[row.key] = list.join(' ');
  }
  return errors;
}

export function areaPayload(rows, suggestions) {
  return rows.map((row) => {
    const auto = !row.id && !row.manual;
    const item = { name: normalizeName(row.name) };
    if (row.id) item.id = row.id;
    if (!auto) item.code = normalizeCode(row.code);
    return item;
  });
}
