// Write-only semantics. Never run these helpers while parsing saved records.
// Same whitespace and Unicode general categories as schemas/master_validation.py.
const nameSpace = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu;
export const normalizeMasterName = (value) => String(value ?? '').replace(nameSpace, ' ').replace(/^ +| +$/g, '');
export const textLength = (value) => Array.from(value).length;
export function masterNameError(value, label, { personal = false, max = 200 } = {}) {
  const name = normalizeMasterName(value);
  if (!name) return `${label[0].toUpperCase()}${label.slice(1)} is required.`;
  if (textLength(name) > max) return `${label[0].toUpperCase()}${label.slice(1)} must be at most ${max} characters.`;
  if (/[\p{C}\uFFFE\uFFFF]/u.test(name.replace(/[\u200c\u200d]/gu, ''))) return `${label} contains unsupported control characters.`;
  if (!(personal ? /\p{L}/u : /[\p{L}\p{N}]/u).test(name)) return `Enter a valid ${label} containing ${personal ? 'a letter' : 'letters or numbers'}. Symbols alone are not allowed.`;
  return '';
}

// Fields already have their own financial/contact/reference rules. This only
// fills missing string-length checks without coercing or changing a draft.
export function masterLengthErrors(values, limits) {
  return Object.fromEntries(Object.entries(limits)
    .filter(([key, max]) => textLength(String(values[key] ?? '').trim()) > max)
    .map(([key, max]) => [key, `Use at most ${max} characters.`]));
}

export function presentMasterFailure(failure, { fields, tabs, setErrors, setActiveTab, pendingFocus, setMessage, fallback }) {
  const errors = Object.fromEntries(Object.entries(failure?.fields || {}).filter(([key]) => fields.includes(key)));
  if (Object.keys(errors).length) {
    setErrors((current) => ({ ...current, ...errors }));
    const first = fields.find((key) => errors[key]);
    const tab = tabs.find((item) => item.fields.includes(first));
    if (tab) { pendingFocus.current = first; setActiveTab(tab.id); }
  }
  setMessage(failure?.error || failure?.message || fallback);
}
