import { useEffect, useState } from 'react';
import SearchableControl from './SearchableControl.jsx';
import InfoDisclosure from './InfoDisclosure.jsx';
import * as geography from '../../services/addressGeography.js';
import { dialCountry } from '../../services/phoneCountries.js';
import geographyLicenseText from 'country-state-city/LICENSE?raw';
import './addressGeography.css';

function useCatalogue(loader, parent) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState({ parent: null, rows: [], loading: false, error: '' });
  useEffect(() => {
    let alive = true;
    if (parent === null) return undefined;
    setResult({ parent, rows: [], loading: true, error: '' });
    loader().then((rows) => { if (alive) setResult({ parent, rows, loading: false, error: '' }); })
      .catch(() => { if (alive) setResult({ parent, rows: [], loading: false, error: 'Geography catalogue unavailable. Your saved selection is retained.' }); });
    return () => { alive = false; };
  }, [parent, retry]);
  // Never show a previous parent's rows while its replacement effect starts.
  return { ...(result.parent === parent ? result : { rows: [], loading: parent !== null, error: '' }),
    retry: () => setRetry((n) => n + 1) };
}
export function useAddressCatalogue(address) {
  const countryList = useCatalogue(geography.countries, 'countries');
  const country = geography.findCountry(countryList.rows, address.values[address.countryField]);
  const stateList = useCatalogue(() => geography.states(country.code), country?.code || null);
  const state = geography.findState(stateList.rows, address.values.state, country?.code);
  const cityList = useCatalogue(() => geography.cities(country.code, state.code, state.cityStateCodes), country && state ? `${country.code}/${state.code}` : null);
  return { countryList, stateList, cityList };
}

export function GeographyLabel({ field, id, label, required, className }) {
  const [licenseUrl, setLicenseUrl] = useState('');
  useEffect(() => {
    if (!['state', 'city'].includes(field)) return undefined;
    // The package's extensionless LICENSE is transformed as JavaScript by the
    // development server when opened directly. A typed local Blob works offline
    // in preview and builds, and contains the actual bundled package license.
    const url = URL.createObjectURL(new Blob([geographyLicenseText], { type: 'text/plain;charset=utf-8' }));
    setLicenseUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [field]);
  const content = <label className={className} htmlFor={id}>{label}
    {required && <span className={className?.replace('__label', '__required')} aria-hidden="true"> *</span>}</label>;
  if (!['state', 'city'].includes(field)) return content;
  return <InfoDisclosure id={`${id}-help`} title={label} testId={`button-${id}-info`} interactive
    text={<>{field === 'state' ? 'Select a country first.' : 'Select a country and state first.'}
      {' '}Geography: <a href="https://github.com/harpreetkhalsagtbit/country-state-city"
        target="_blank" rel="noreferrer">country-state-city</a> · <a href={licenseUrl || undefined}
        target="_blank" rel="noreferrer">GPL-3.0 license</a></>}>{content}</InfoDisclosure>;
}

// Names are the save contract; dataset IDs are only selection identities.
// A selected legacy/postal-only spelling is scoped to the current parents and
// remains retainable even if it has no entry in this version of the catalogue.
export function GeographyControl({ address, catalogue, field, id, label, required, invalid, describedBy }) {
  const country = field === address.countryField;
  const result = country ? catalogue.countryList : field === 'state' ? catalogue.stateList : catalogue.cityList;
  const parentMissing = !country && (!address.values[address.countryField] || (field === 'city' && !address.values.state));
  const selected = address.values[field] || '';
  // Storage's existing server country allowlist is narrower than the dataset.
  // Use it only for admissibility, never as the source of names or geography.
  const baseRows = country && address.countryCodes ? result.rows.filter((row) => dialCountry(row.code)) : result.rows;
  const countryIdentity = (value) => geography.findCountry(catalogue.countryList.rows, value)?.code || geography.geographyKey(value);
  const stateIdentity = (value) => geography.findState(catalogue.stateList.rows, value,
    geography.findCountry(catalogue.countryList.rows, address.values[address.countryField])?.code)?.value || geography.geographyKey(value);
  const rows = [...baseRows];
  address.retainedAddresses.forEach((item) => {
    if (!country && countryIdentity(item.country) !== countryIdentity(address.values[address.countryField])) return;
    if (field === 'city' && stateIdentity(item.state) !== stateIdentity(address.values.state)) return;
    const name = country ? item.country : item[field];
    if (name && !rows.some((row) => country ? (row.code === name || geography.geographyKey(row.name) === geography.geographyKey(name))
      : geography.geographyKey(row.name) === geography.geographyKey(name))) {
      rows.push({ value: `retained:${item.country}:${item.state}:${field}:${name}`, name, label: name,
        ...(country && address.countryCodes ? { code: name } : {}) });
    }
  });
  const match = country ? geography.findCountry(rows, selected) : field === 'state'
    ? geography.findState(rows, selected, geography.findCountry(catalogue.countryList.rows, address.values[address.countryField])?.code)
    : rows.find((row) => geography.geographyKey(row.name) === geography.geographyKey(selected));
  const retained = { value: `retained:${field}:${selected}`, label: selected, name: selected };
  const choices = [{ value: '', label: `Clear ${label.toLowerCase()}` }, ...rows];
  if (selected && !match) choices.push(retained);
  const guidance = parentMissing ? '' : result.error || (result.loading ? `Loading ${label.toLowerCase()} choices…`
      : !rows.length ? `No catalogue ${label.toLowerCase()} choices for this parent. Saved and PIN-derived values can be retained.` : '');
  return <>
    <SearchableControl id={id} name={field} label={label} required={required}
      value={selected ? match?.value || retained.value : ''} selectedLabel={selected} choices={choices}
       placeholder={`Select ${label.toLowerCase()}`} disabled={address.disabled || parentMissing}
      invalid={invalid} describedBy={[describedBy, guidance && `${id}-guidance`].filter(Boolean).join(' ') || undefined}
      loading={result.loading} feedback={guidance}
      action={result.error ? { label: 'Retry geography catalogue', run: result.retry } : undefined}
      onChange={(value) => {
        if (selected && value === (match?.value || retained.value)) {
          address.change(field, selected, true);
          return;
        }
        const row = choices.find((item) => item.value === value);
        if (!row) return;
        address.change(field, value ? (country && address.countryCodes ? row.code || selected : row.name) : '');
      }} />
    {guidance && <p className="address-geography__hint" id={`${id}-guidance`} role="status">{guidance}</p>}
  </>;
}

export function PostalSelection({ address, prefix, fieldClass = 'mr-form__field mr-form__field--wide', labelClass = 'mr-form__label', hintClass = 'mr-form__hint' }) {
  const { postal } = address;
  if (!postal.message && !postal.choices.length) return null;
  return <div className={fieldClass}>
    <p className={hintClass} id={`${prefix}-pin-feedback`} role="status">{postal.message}</p>
    {postal.retryable && <button type="button" className="admin-button admin-button--secondary"
      disabled={address.disabled} aria-describedby={`${prefix}-pin-feedback`}
      onClick={address.retryPostal}>Retry PIN lookup</button>}
    {postal.choices.length > 1 && <>
      <label className={labelClass} htmlFor={`${prefix}-pin-choice`}>PIN locations</label>
      <SearchableControl id={`${prefix}-pin-choice`} label="PIN locations" value="" selectedLabel=""
        placeholder="Choose a PIN location" disabled={address.disabled}
        describedBy={`${prefix}-pin-feedback`}
        choices={postal.choices.map((item, index) => ({ value: String(index), label: [item.city, item.state, item.country].join(', ') }))}
        onChange={(value) => address.apply(postal.choices[Number(value)])} />
    </>}
    {postal.required && <button type="button" className="admin-button admin-button--secondary" disabled={address.disabled}
      onClick={address.manual}>Use catalogue selection instead</button>}
  </div>;
}
