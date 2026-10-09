import { useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import PhoneInput from './PhoneInput.jsx';
import { getVendor } from '../../services/serverVendors.js';
import { EMPTY_VENDOR, VENDOR_COLUMNS, VENDOR_LENGTHS, vendorDraftErrors } from '../../services/vendorFields.js';
import '../../vendor.css';

const pick = (record) => record ? Object.fromEntries(Object.keys(EMPTY_VENDOR).map((key) => [key, record[key] ?? EMPTY_VENDOR[key]])) : { ...EMPTY_VENDOR };

export default function VendorForm({ vendor, onSave, onClose }) {
  const [values, setValues] = useState(() => pick(vendor));
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [current, setCurrent] = useState(null);
  const busy = useRef(false);
  function change(key, value) {
    const next = { ...values, [key]: value };
    setValues(next);
    setMessage('');
    if (attempted) setErrors(vendorDraftErrors(next));
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    setAttempted(true);
    const found = vendorDraftErrors(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body = { ...Object.fromEntries(VENDOR_COLUMNS.map(([key]) => [key, values[key].trim()])), gstNo: values.gstNo.trim().toUpperCase(), dialCountry: values.dialCountry, status: values.status };
    busy.current = true;
    setPending(true);
    try {
      const result = await onSave(body, current || vendor);
      if (!result.success) {
        setMessage(result.error);
        if (result.fields && typeof result.fields === 'object') setErrors((old) => ({ ...old, ...result.fields }));
        setBlocked(/_stale$/.test(result.code || '') || Boolean(result.ambiguous));
        setAmbiguous(Boolean(result.ambiguous));
      }
    } finally { busy.current = false; setPending(false); }
  }
  async function reload() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const record = await getVendor(vendor.id);
      setCurrent(record);
      setMessage(`Current server record: ${record.vendorName} (${record.status}), version ${record.version}. Your draft is unchanged; review it before saving.`);
    } catch (cause) { setMessage(cause.message || 'The current record could not be loaded.'); }
    finally { busy.current = false; setPending(false); }
  }
  function discard() { setValues(pick(current || vendor)); setErrors({}); setMessage('Current server details loaded.'); setAttempted(false); setBlocked(false); }
  return <Dialog title={vendor ? 'Edit vendor' : 'Add vendor'} eyebrow="Vendor Master" description="All six contact fields are required. Changes are saved to shared server records." onClose={pending ? () => {} : onClose} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={onClose} data-testid="button-cancel-vendor">Cancel</button><button type="submit" form="vendor-master-form" className="admin-button" disabled={pending || blocked} data-testid="button-save-vendor">{pending ? 'Saving…' : vendor ? 'Save changes' : 'Add vendor'}</button></>}>
    <form id="vendor-master-form" className="admin-vendor-form" onSubmit={submit} noValidate>
      {VENDOR_COLUMNS.map(([key, label]) => {
        const id = `vendor-${key}`;
        const common = { id, disabled: pending, value: values[key], onChange: (event) => change(key, event.target.value), 'aria-required': 'true', 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `vendor-error-${key}` : undefined, 'data-testid': `input-vendor-${key}`, maxLength: VENDOR_LENGTHS[key] };
        let input;
        if (key === 'registeredAddress') input = <textarea {...common} autoComplete="off" />;
        else if (key === 'phoneNo') input = <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><PhoneInput prefix="vendor" country={values.dialCountry} onCountryChange={(value) => change('dialCountry', value)} countryError={errors.dialCountry} inputProps={{ ...common, autoComplete: 'tel' }} /></fieldset>;
        else input = <input {...common} type={key === 'emailId' ? 'email' : 'text'} autoComplete={key === 'emailId' ? 'email' : 'off'} />;
        return <div key={key} className={`admin-vendor-field${key === 'registeredAddress' ? ' admin-vendor-field--wide' : ''}`}>
          <label htmlFor={id}>{label} <span aria-hidden="true">*</span></label>{input}
          {errors[key] && <span id={`vendor-error-${key}`} className="admin-vendor-field__error" role="alert">{errors[key]}</span>}
          {key === 'phoneNo' && errors.dialCountry && <span id="vendor-dialCountry-error" className="admin-vendor-field__error" role="alert">{errors.dialCountry}</span>}
        </div>;
      })}
      <div className="admin-vendor-field">
        <label htmlFor="vendor-status">Status</label>
        <select id="vendor-status" disabled={pending} className="admin-select" value={values.status} onChange={(event) => change('status', event.target.value)} data-testid="select-vendor-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
      </div>
      {message && <div className="admin-feedback admin-feedback--error admin-vendor-form__feedback" role="alert" data-testid="status-vendor-save-error">{message}</div>}
      {ambiguous && <p role="alert" className="admin-vendor-form__feedback">The result is uncertain. Close this draft and refresh the table to check whether the vendor was saved before trying again.</p>}
      {blocked && vendor && !ambiguous && <div className="admin-vendor-form__feedback">
        <button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={reload} data-testid="button-reload-vendor">Load current server record</button>{' '}
        {current && <>
          <dl>{VENDOR_COLUMNS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{current[key]}</dd></div>)}<div><dt>Country / Status</dt><dd>{current.dialCountry} / {current.status}</dd></div></dl>
          <button type="button" className="admin-button admin-button--secondary" onClick={discard} data-testid="button-discard-vendor-draft">Discard draft and load current details</button>{' '}
          <button type="button" className="admin-button admin-button--secondary" onClick={() => { setBlocked(false); setMessage('Draft retained against the reviewed current version. Save explicitly to apply it.'); }}>Keep draft against reviewed version</button>
        </>}
      </div>}
    </form>
  </Dialog>;
}
