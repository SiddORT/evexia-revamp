// Shared dialing metadata for the Doctor and Staff phone controls.
export const DIAL_COUNTRIES = [
  { value: 'IN', label: '🇮🇳 +91', name: 'India', code: '+91', digits: 10 },
  { value: 'US', label: '🇺🇸 +1', name: 'United States', code: '+1', digits: 10 },
  { value: 'GB', label: '🇬🇧 +44', name: 'United Kingdom', code: '+44', digits: 10 },
  { value: 'AE', label: '🇦🇪 +971', name: 'United Arab Emirates', code: '+971', digits: 9 },
];

export const dialCountry = (value) => DIAL_COUNTRIES.find((item) => item.value === value);
export const internationalPhone = (record) => `${dialCountry(record.dialCountry || 'IN')?.code || ''}${record.phone}`;
