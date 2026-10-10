import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const DIAL_COUNTRIES = getCountries().map((value) => {
  const name = names.of(value);
  const code = `+${getCountryCallingCode(value)}`;
  return { value, name, code, label: `${name} (${value}) ${code}` };
}).sort((a, b) => a.name.localeCompare(b.name));
export const dialCountry = (value) => DIAL_COUNTRIES.find((item) => item.value === value);
const legacyDigits = { IN: 10, US: 10, GB: 10, AE: 9 };

// Preserve each master's historical acceptance, not just numbering-plan validity.
export function normalizePhone(value, country, master = 'doctor') {
  if (!dialCountry(country)) return null;
  const raw = value.trim();
  const local = country === 'IN' && ['mr', 'staff', 'vendor'].includes(master)
    ? raw.replace(/^\+91[\s-]?/, '') : raw;
  const digits = local.replace(/[\s()-]/g, '');
  const legacy = master === 'mr' ? (country === 'IN' ? 10 : undefined) : legacyDigits[country];
  if (legacy) return /^[0-9\s()-]+$/.test(local) && digits.length === legacy
    && (!['staff', 'vendor'].includes(master) || country !== 'IN' || /^[6-9][0-9]{9}$/.test(digits)) ? digits : null;
  if (!/^\+?[0-9\s()-]+$/.test(raw)) return null;
  const phone = parsePhoneNumberFromString(raw, country);
  if (!phone || phone.countryCallingCode !== getCountryCallingCode(country)) return null;
  // Validate the selected region's maintained plan, not the parser's preferred
  // region for a shared code (e.g. EH/MA or MF/GP). This mirrors Python's
  // is_valid_number_for_region and retains the user's distinct ISO selection.
  phone.country = country;
  return phone.isValid() ? phone.nationalNumber : null;
}
export const internationalPhone = (record) => record.phone
  ? `${dialCountry(record.dialCountry || 'IN')?.code || ''}${record.phone}` : '';
