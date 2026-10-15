import { DIAL_COUNTRIES } from '../../services/phoneCountries.js';
import SearchableControl from './SearchableControl.jsx';
import '../../phone-input.css';

// The consumer owns labels/errors and validation; both controls have independent
// accessible names, error associations and stable field names.
export default function PhoneInput({ prefix, country, onCountryChange, countryError, inputProps, className = '' }) {
  const selected = DIAL_COUNTRIES.find((item) => item.value === country);
  return <div className={`admin-phone-input ${className}`.trim()}>
    <SearchableControl id={`${prefix}-dialCountry`} name="dialCountry" disabled={inputProps.disabled}
      className="admin-phone-input__country" label="Phone country code" required invalid={Boolean(countryError)}
      describedBy={countryError ? `${prefix}-dialCountry-error` : undefined}
      value={country} onChange={onCountryChange} choices={DIAL_COUNTRIES} minimumMenuWidth={280}
      selectedLabel={selected?.label || country || ''} displayLabel={selected ? `${selected.value} ${selected.code}` : country || ''}
      placeholder="Country code" testId={`select-${prefix}-dialCountry`} />
    <input {...inputProps} type="tel" inputMode="tel" autoComplete="tel" />
  </div>;
}
