import { DIAL_COUNTRIES } from '../../services/phoneCountries.js';
import '../../phone-input.css';

// The consumer owns labels/errors and validation; both controls have independent
// accessible names, error associations and stable field names.
export default function PhoneInput({ prefix, country, onCountryChange, countryError, inputProps, className = '', controlClassName = '' }) {
  return <div className={`admin-phone-input ${className}`.trim()}>
    <select id={`${prefix}-dialCountry`} name="dialCountry" disabled={inputProps.disabled}
      className={`admin-phone-input__country ${controlClassName}`.trim()}
      aria-label="Phone country code" aria-required="true" aria-invalid={Boolean(countryError)}
      aria-describedby={countryError ? `${prefix}-dialCountry-error` : undefined}
      value={country} onChange={(event) => onCountryChange(event.target.value)}
      data-testid={`select-${prefix}-dialCountry`}>
       {DIAL_COUNTRIES.map((item) => <option value={item.value} key={item.value} aria-label={`${item.name} ${item.code}`}>{item.label}</option>)}
     </select>
    <input {...inputProps} type="tel" inputMode="tel" autoComplete="tel" />
  </div>;
}
