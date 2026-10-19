import { useEffect, useRef, useState } from 'react';
import { lookupLocationPIN } from '../../services/serverLocations.js';
import { DIAL_COUNTRIES } from '../../services/phoneCountries.js';
import { GST_STATES } from '../../services/serverPurchaseOrders.js';
import { indianLocationState } from '../../services/locationGeography.js';

export default function StorageLocationAddress({ values, errors, onChange, onChoiceRequired, disabled, editing }) {
  const [lookup, setLookup] = useState({ choices: [], message: '' });
  const [editedPIN, setEditedPIN] = useState(false);
  const sequence = useRef(0);
  const [lookupRevision, setLookupRevision] = useState(0);
  const apply = (choice) => {
    sequence.current++;
    setEditedPIN(false);
    onChoiceRequired(false);
    const state = indianLocationState(choice.state);
    if (!['india', 'in'].includes(choice.country.toLowerCase())) {
      setLookup({ choices: [], message: 'Postal country is not recognized as India. Enter the structured address manually.' });
      return;
    }
    onChange({ countryCode: 'IN', state: state?.name || '', city: choice.city });
    setLookup({ choices: [], message: state ? 'PIN location filled. Review the address before saving.' : 'State/UT not recognized. Select it manually.' });
  };
  useEffect(() => {
    const request = ++sequence.current;
    if (!editedPIN || disabled || (values.countryCode && values.countryCode !== 'IN') || !/^[1-9][0-9]{5}$/.test(values.pincode)) return;
    const controller = new AbortController();
    setLookup({ choices: [], message: 'Looking up PIN…' });
    const timer = setTimeout(async () => {
      try {
        const result = await lookupLocationPIN(values.pincode, controller.signal, editing ? 'edit' : 'add');
        if (controller.signal.aborted || request !== sequence.current) return;
        if (result.choices.length === 1) apply(result.choices[0]);
        else {
          onChoiceRequired(result.choices.length > 1);
          setLookup({ choices: result.choices, message: result.choices.length > 1 ? 'Choose a PIN location or confirm manual entry before saving.' : result.message });
        }
      } catch {
        if (!controller.signal.aborted && request === sequence.current) setLookup({ choices: [], message: 'PIN lookup unavailable. Enter the address manually; your draft is retained.' });
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [values.pincode, values.countryCode, editedPIN, disabled, editing, lookupRevision]);

  const change = (field, value) => {
    sequence.current++;
    onChoiceRequired(false);
    setLookup({ choices: [], message: '' });
    if (field === 'pincode') { setEditedPIN(true); setLookupRevision((n) => n + 1); }
    else setEditedPIN(false);
    onChange(field === 'countryCode' ? { countryCode: value, state: '', city: '' } : { [field]: value });
  };
  const field = (name, label, control) => <div className={`mr-form__field${name === 'pincode' ? ' mr-form__field--wide' : ''}`} key={name}>
    {name === 'pincode' && <p id="storage-geography-guidance" className="admin-storage-form__geography-guidance">Geography is optional for legacy records. Incomplete addresses require explicit PO destination selection.</p>}
    <label className="mr-form__label" htmlFor={`storage-${name}`}>{label}</label>{control}
    {name === 'pincode' && <p id="storage-pin-feedback" className="mr-form__hint admin-storage-form__pin-feedback" role="status">{lookup.message}</p>}
    {errors[name] && <p id={`storage-${name}-error`} className="mr-form__error" role="alert">{errors[name]}</p>}
  </div>;
  const props = (name) => ({ id: `storage-${name}`, className: 'mr-form__control', value: values[name] || '', disabled,
    'aria-invalid': Boolean(errors[name]), 'aria-describedby': [name === 'pincode' && 'storage-geography-guidance storage-pin-feedback', errors[name] && `storage-${name}-error`].filter(Boolean).join(' ') || undefined,
    onChange: (event) => change(name, event.target.value) });
  return <>
    {field('pincode', 'PIN / Postal code', <input {...props('pincode')} maxLength={20} autoComplete="postal-code" placeholder="Six-digit PIN for India" />)}
    {lookup.choices.length > 1 && <>{field('pin-choice', 'PIN locations', <select id="storage-pin-choice" className="mr-form__control" disabled={disabled} defaultValue="" onChange={(event) => { const choice = lookup.choices[Number(event.target.value)]; if (event.target.value !== '' && choice) apply(choice); }}>
      <option value="">Choose a location</option>{lookup.choices.map((choice, index) => <option value={index} key={index}>{choice.city}, {choice.state}, {choice.country}</option>)}
    </select>)}<button type="button" className="admin-button admin-button--secondary" disabled={disabled} onClick={() => { sequence.current++; setEditedPIN(false); onChoiceRequired(false); setLookup({ choices: [], message: 'Manual entry selected. Review country, State/UT and city before saving.' }); }}>Use manual address entry</button></>}
    {field('countryCode', 'Country', <select {...props('countryCode')}><option value="">Not captured</option>{DIAL_COUNTRIES.map((country) => <option value={country.value} key={country.value}>{country.name}</option>)}</select>)}
    {field('state', 'State/UT', values.countryCode === 'IN'
      ? <select {...props('state')}><option value="">Not captured</option>{GST_STATES.map((state) => <option key={state.code} value={state.name}>{state.name} ({state.code})</option>)}</select>
      : <input {...props('state')} maxLength={100} autoComplete="address-level1" />)}
    {field('city', 'City', <input {...props('city')} maxLength={100} autoComplete="address-level2" />)}
  </>;
}
