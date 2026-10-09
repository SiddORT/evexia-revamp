import { vendorCountry, normalizeVendorPhone } from './vendorPhone.js';
// Pure field metadata for the shared-server Vendor Master (no browser storage).
export const VENDOR_COLUMNS = [
  ['vendorName', 'Vendor Name'], ['gstNo', 'GST No.'], ['registeredAddress', 'Registered Address'],
  ['contactPersonName', 'Contact Person Name'], ['emailId', 'Email ID'], ['phoneNo', 'Phone No.'],
];
export const VENDOR_FIELDS = [...VENDOR_COLUMNS.map(([key]) => key), 'dialCountry', 'status'];
export const EMPTY_VENDOR = { vendorName: '', gstNo: '', registeredAddress: '', contactPersonName: '', emailId: '', phoneNo: '', dialCountry: 'IN', status: 'active' };
export const VENDOR_LENGTHS = { vendorName: 200, gstNo: 15, registeredAddress: 2000, contactPersonName: 200, emailId: 320, phoneNo: 30 };

export function vendorDraftErrors(values) {
  const errors = {};
  const trimmed = Object.fromEntries(VENDOR_COLUMNS.map(([key]) => [key, String(values[key] ?? '').trim()]));
  for (const [key, label] of VENDOR_COLUMNS) if (!trimmed[key]) errors[key] = `${label} is required.`;
  for (const [key, label] of VENDOR_COLUMNS) if (trimmed[key].length > VENDOR_LENGTHS[key]) errors[key] = `${label} must be at most ${VENDOR_LENGTHS[key]} characters.`;
  if (trimmed.gstNo && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(trimmed.gstNo.toUpperCase())) errors.gstNo = 'Enter a valid 15-character GST number.';
  if (trimmed.emailId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.emailId)) errors.emailId = 'Enter a valid email address.';
  if (!vendorCountry(values.dialCountry)) errors.dialCountry = 'Choose a supported phone country.';
  else if (trimmed.phoneNo && !normalizeVendorPhone(trimmed.phoneNo, values.dialCountry)) errors.phoneNo = `Enter a valid phone number for ${vendorCountry(values.dialCountry).name}.`;
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Choose Active or Inactive.';
  return errors;
}

export const vendorPhone = (record) => {
  const code = vendorCountry(record.dialCountry)?.code;
  if (!code) throw new Error('Vendor phone country is unsupported. Refresh the record.');
  return `${code} ${record.phoneNo}`;
};
export const vendorTel = (record) => vendorPhone(record).replace(/[^\d+]/g, '');
