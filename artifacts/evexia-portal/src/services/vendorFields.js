import { dialCountry } from './phoneCountries.js';
// Pure field metadata for the shared-server Vendor Master (no browser storage).
export const VENDOR_COLUMNS = [
  ['vendorName', 'Vendor Name'], ['gstNo', 'GST No.'], ['registeredAddress', 'Registered Address'],
  ['contactPersonName', 'Contact Person Name'], ['emailId', 'Email ID'], ['phoneNo', 'Phone No.'],
];
export const VENDOR_FIELDS = [...VENDOR_COLUMNS.map(([key]) => key), 'dialCountry', 'status'];
export const EMPTY_VENDOR = { vendorName: '', gstNo: '', registeredAddress: '', contactPersonName: '', emailId: '', phoneNo: '', dialCountry: 'IN', status: 'active' };
const DIGITS = { IN: 10, US: 10, GB: 10, AE: 9 };
export const VENDOR_LENGTHS = { vendorName: 200, gstNo: 15, registeredAddress: 2000, contactPersonName: 200, emailId: 320, phoneNo: 30 };

export function vendorDraftErrors(values) {
  const errors = {};
  const trimmed = Object.fromEntries(VENDOR_COLUMNS.map(([key]) => [key, String(values[key] ?? '').trim()]));
  for (const [key, label] of VENDOR_COLUMNS) if (!trimmed[key]) errors[key] = `${label} is required.`;
  for (const [key, label] of VENDOR_COLUMNS) if (trimmed[key].length > VENDOR_LENGTHS[key]) errors[key] = `${label} must be at most ${VENDOR_LENGTHS[key]} characters.`;
  if (trimmed.gstNo && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(trimmed.gstNo.toUpperCase())) errors.gstNo = 'Enter a valid 15-character GST number.';
  if (trimmed.emailId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.emailId)) errors.emailId = 'Enter a valid email address.';
  const need = DIGITS[values.dialCountry];
  if (!need) errors.dialCountry = 'Choose a supported phone country.';
  else if (trimmed.phoneNo) {
    const local = values.dialCountry === 'IN' ? trimmed.phoneNo.replace(/^\+91[\s-]?/, '') : trimmed.phoneNo;
    const digits = local.replace(/[\s()-]/g, '');
    if (!/^[0-9\s()-]+$/.test(local) || digits.length !== need || (values.dialCountry === 'IN' && !/^[6-9][0-9]{9}$/.test(digits))) errors.phoneNo = `Enter a valid ${need}-digit ${values.dialCountry} phone number.`;
  }
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose Active or Inactive.';
  return errors;
}

export const vendorPhone = (record) => {
  const code = dialCountry(record.dialCountry)?.code;
  if (!code) throw new Error('Vendor phone country is unsupported. Refresh the record.');
  return `${code} ${record.phoneNo}`;
};
export const vendorTel = (record) => vendorPhone(record).replace(/[^\d+]/g, '');
