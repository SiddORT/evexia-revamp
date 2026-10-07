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
