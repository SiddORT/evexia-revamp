import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

// Vendor-only catalogue. Other masters retain their existing four-country contract.
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const VENDOR_COUNTRIES = getCountries().map((value) => {
  const name = names.of(value);
  const code = `+${getCountryCallingCode(value)}`;
  return { value, name, code, label: `${name} (${value}) ${code}` };
}).sort((a, b) => a.name.localeCompare(b.name));
export const vendorCountry = (value) => VENDOR_COUNTRIES.find((item) => item.value === value);
const legacyDigits = { IN: 10, US: 10, GB: 10, AE: 9 };

export function normalizeVendorPhone(value, country) {
  if (!vendorCountry(country)) return null;
  // Preserve the established acceptance rules for existing supported records.
  const local = country === 'IN' ? value.trim().replace(/^\+91[\s-]?/, '') : value.trim();
  const digits = local.replace(/[\s()-]/g, '');
  if (legacyDigits[country]) return /^[0-9\s()-]+$/.test(local)
    && digits.length === legacyDigits[country]
    && (country !== 'IN' || /^[6-9][0-9]{9}$/.test(digits)) ? digits : null;
  if (!/^\+?[0-9\s()-]+$/.test(value.trim())) return null;
  const phone = parsePhoneNumberFromString(value.trim(), country);
  return phone?.isValid() && phone.country === country ? phone.nationalNumber : null;
}
