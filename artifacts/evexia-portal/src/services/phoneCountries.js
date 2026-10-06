// Shared dialing metadata for the Doctor and Staff phone controls.
export const DIAL_COUNTRIES = [
  { value: 'IN', label: '🇮🇳 +91', code: '+91', digits: 10 },
  { value: 'US', label: '🇺🇸 +1', code: '+1', digits: 10 },
  { value: 'GB', label: '🇬🇧 +44', code: '+44', digits: 10 },
  { value: 'AE', label: '🇦🇪 +971', code: '+971', digits: 9 },
];

export const dialCountry = (value) => DIAL_COUNTRIES.find((item) => item.value === value);
export const internationalPhone = (record) => `${dialCountry(record.dialCountry || 'IN')?.code || ''}${record.phone}`;
