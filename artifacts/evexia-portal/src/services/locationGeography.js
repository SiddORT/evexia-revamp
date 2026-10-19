import { GST_STATES } from './serverPurchaseOrders.js';
import { dialCountry } from './phoneCountries.js';

const key = (value) => value.toLowerCase().replaceAll('&', 'and').replace(/[^a-z0-9]/g, '');
const aliases = { orissa: '21', uttaranchal: '05', pondicherry: '34', nctofdelhi: '07',
  andamanandnicobarislands: '35', dadraandnagarhavelianddamananddiu: '26',
  dadraandnagarhaveli: '26', damananddiu: '26' };
export const indianLocationState = (value = '') => GST_STATES.find((item) => item.code === value || key(item.name) === key(value) || item.code === aliases[key(value)]);
export const locationSuggestion = (location) => location?.countryCode === 'IN'
  ? GST_STATES.find((item) => item.code === location.stateCode)?.code || '' : '';
export function validateLocationGeography(values) {
  const errors = {};
  const clean = Object.fromEntries(['pincode', 'countryCode', 'state', 'city'].map((field) => [field, (values[field] || '').trim().replace(/\s+/g, ' ')]));
  for (const [field, limit] of [['pincode', 20], ['countryCode', 2], ['state', 100], ['city', 100]]) {
    if (clean[field].length > limit || /[\x00-\x1f\ud800-\udfff\ufffe\uffff]/u.test(clean[field])) errors[field] = `Use supported text, up to ${limit} characters.`;
  }
  if (clean.countryCode && !dialCountry(clean.countryCode)) errors.countryCode = 'Select a country.';
  if (!clean.countryCode && (clean.pincode || clean.state || clean.city)) errors.countryCode = 'Select a country for this address.';
  if (clean.countryCode === 'IN') {
    if (clean.pincode && !/^[1-9][0-9]{5}$/.test(clean.pincode)) errors.pincode = 'Enter a six-digit Indian PIN.';
    if (clean.state && !indianLocationState(clean.state)) errors.state = 'Select a supported Indian State/UT.';
  }
  return errors;
}
export const locationGeographyLabel = (row) => [
  row.pincode, dialCountry(row.countryCode)?.name, row.state, row.city,
].filter(Boolean).join(' · ') + (!(row.countryCode && row.state && row.city && row.pincode) ? ' · Incomplete structured address' : '');
