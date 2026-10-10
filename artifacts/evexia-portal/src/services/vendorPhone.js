import { normalizePhone } from './phoneCountries.js';
export { DIAL_COUNTRIES as VENDOR_COUNTRIES, dialCountry as vendorCountry } from './phoneCountries.js';
export const normalizeVendorPhone = (value, country) => normalizePhone(value, country, 'vendor');
