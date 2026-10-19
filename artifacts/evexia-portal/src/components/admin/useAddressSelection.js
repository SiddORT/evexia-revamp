import { useEffect, useRef, useState } from 'react';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import * as geography from '../../services/addressGeography.js';

const emptyPostal = () => ({ choices: [], message: '', required: false });
const ADDRESS_FIELDS = new Set(['pincode', 'country', 'countryCode', 'state', 'city', 'address', 'addressLine1', 'addressLine2', 'landmark']);

// One revision covers the entire address, not just the PIN. Invalidation occurs
// synchronously in event handlers, before effect cleanup or a network response.
export default function useAddressSelection({ values, onChange, lookupPIN, editing, disabled = false,
  countryCodes = false, onChoiceRequired }) {
  const countryField = countryCodes ? 'countryCode' : 'country';
  const [postal, setPostal] = useState(emptyPostal);
  // Only the initial saved address and explicitly selected postal results become
  // supplemental options. Ordinary catalogue choices never manufacture records.
  const [retainedAddresses, setRetainedAddresses] = useState(() => [{
    country: values[countryField] || '', state: values.state || '', city: values.city || '',
  }]);
  const [pinRevision, setPinRevision] = useState(0);
  const revision = useRef(0);
  const edited = useRef(false);
  const request = useRef(null);
  const latest = useRef(null);
  latest.current = { values, onChange, disabled, onChoiceRequired, postal };
  const addressSnapshot = JSON.stringify([...ADDRESS_FIELDS].map((key) => values[key]));
  const invalidate = () => {
    revision.current++; request.current?.controller.abort(); request.current = null; edited.current = false;
  };
  const confirm = (required) => latest.current.onChoiceRequired?.(required);
  const resetPostal = () => { setPostal(emptyPostal()); confirm(false); };
  function change(field, value, preserveChildren = false) {
    if (latest.current.disabled) return;
    if (ADDRESS_FIELDS.has(field)) {
      invalidate();
      if (field === 'pincode' || !latest.current.postal.required) resetPostal();
      else setPostal({ choices: [], required: true, message: 'The address changed after an ambiguous PIN result. Explicitly confirm catalogue selection before saving.' });
      if (field === 'pincode') { edited.current = true; setPinRevision((n) => n + 1); }
    }
    const patch = { [field]: value };
    if (!preserveChildren && field === countryField) { patch.state = ''; patch.city = ''; }
    if (!preserveChildren && field === 'state') patch.city = '';
    latest.current.onChange(patch);
  }
  function apply(choice) {
    if (latest.current.disabled) return;
    try {
      const patch = geography.postalAddress(choice, countryCodes);
      invalidate(); confirm(false); latest.current.onChange(patch);
      setRetainedAddresses((current) => [...current, {
        country: patch[countryField], state: patch.state, city: patch.city,
      }]);
      setPostal({ choices: [], required: false, message: 'PIN location filled. Review the address before saving.' });
    } catch {
      invalidate(); confirm(false);
      setPostal({ choices: [], required: false, message: 'Postal country is not recognized as India. Your draft is retained; select from the geography catalogue.' });
    }
  }
  function manual() {
    invalidate(); confirm(false);
    setPostal({ choices: [], required: false, message: 'Catalogue selection confirmed. Review country, state and city before saving.' });
  }
  useEffect(() => {
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) { invalidate(); resetPostal(); }
    });
    return () => { unsubscribe(); invalidate(); };
  }, []);
  useEffect(() => {
    if (disabled) invalidate();
  }, [disabled]);
  useEffect(() => {
    // Storage's free-text street address is owned by the enclosing form. A
    // change there must cancel the lookup just like a change in these controls.
    if (request.current && request.current.snapshot !== addressSnapshot) {
      invalidate();
      if (latest.current.postal.required) {
        setPostal({ choices: [], required: true, message: 'The address changed after an ambiguous PIN result. Explicitly confirm catalogue selection before saving.' });
      } else resetPostal();
    }
  }, [addressSnapshot]);
  useEffect(() => {
    const country = geography.geographyKey(values[countryField]);
    if (!edited.current || disabled || !['', 'india', 'in'].includes(country) || !/^[1-9]\d{5}$/.test(values.pincode.trim())) return undefined;
    const controller = new AbortController();
    const atStart = revision.current;
    const snapshot = addressSnapshot;
    request.current = { controller, snapshot };
    const current = () => !controller.signal.aborted && revision.current === atStart && !latest.current.disabled
      && snapshot === JSON.stringify([...ADDRESS_FIELDS].map((key) => latest.current.values[key]));
    setPostal({ choices: [], required: false, message: 'Looking up PIN…' });
    const timer = setTimeout(async () => {
      try {
        const result = await lookupPIN(values.pincode.trim(), controller.signal, editing ? 'edit' : 'add');
        if (!current()) return;
        edited.current = false;
        const choices = Array.isArray(result.choices) ? result.choices : [];
        if (choices.length === 1) apply(choices[0]);
        else {
          confirm(choices.length > 1);
          setPostal({ choices, required: choices.length > 1, message: choices.length > 1
            ? 'Several places share this PIN. Choose a location or explicitly confirm catalogue selection.'
            : result.message || 'No PIN location found. Your draft is retained; select from the geography catalogue.' });
        }
      } catch {
        if (current()) {
          edited.current = false;
          setPostal({ choices: [], required: false, message: 'PIN lookup unavailable. Your draft is retained; select from the geography catalogue.' });
        }
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [values.pincode, values[countryField], disabled, editing, pinRevision, lookupPIN]);
  return { values, countryField, countryCodes, disabled, change, apply, manual, postal, retainedAddresses, pause: invalidate };
}
