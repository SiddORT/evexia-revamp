import { indianLocationState } from './locationGeography.js';

// Import individual data files, never the package barrel (which eagerly imports
// every city). Vite emits separate lazy chunks; no geography is in the entry.
// Source/license: country-state-city 3.2.1, GPL-3.0; see GEOGRAPHY_DATA.md.
export const geographyKey = (value = '') => value.normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replaceAll('&', 'and').replace(/[^\p{L}\p{N}]/gu, '');
const sorted = (rows) => rows.sort((a, b) => a.label.localeCompare(b.label));
export async function countries() {
  const { default: rows } = await import('country-state-city/lib/assets/country.json');
  return sorted(rows.map(({ isoCode, name }) => ({ value: isoCode, code: isoCode, name, label: name })));
}
export async function states(country) {
  const { default: rows } = await import('country-state-city/lib/assets/state.json');
  const options = new Map();
  rows.filter((row) => row.countryCode === country).forEach((row) => {
    const indian = country === 'IN' ? indianLocationState(row.name) : null;
    const name = indian?.name || row.name, code = indian?.code || row.isoCode;
    const previous = options.get(code);
    options.set(code, { value: `${country}/${code}`, code, name, label: name,
      cityStateCodes: [...(previous?.cityStateCodes || []), row.isoCode] });
  });
  return sorted([...options.values()]);
}
export async function cities(country, state, cityStateCodes) {
  const { default: rows } = await import('country-state-city/lib/assets/city.json');
  const names = new Set(rows.filter((row) => row[1] === country && cityStateCodes.includes(row[2])).map((row) => row[0]));
  return sorted([...names].map((name) => ({ value: `${country}/${state}/${encodeURIComponent(name)}`, name, label: name })));
}
export const findCountry = (rows, value) => rows.find((row) =>
  row.code === value || geographyKey(row.name) === geographyKey(value));
export const findState = (rows, value, country) => rows.find((row) =>
  geographyKey(row.name) === geographyKey(value) || (country === 'IN'
    && indianLocationState(value) && indianLocationState(row.name)?.code === indianLocationState(value).code));
export function postalAddress(choice, codes) {
  if (!['india', 'in'].includes(geographyKey(choice.country))) throw new Error('Postal country is not India.');
  return { [codes ? 'countryCode' : 'country']: codes ? 'IN' : 'India',
    state: indianLocationState(choice.state)?.name || choice.state, city: choice.city };
}
