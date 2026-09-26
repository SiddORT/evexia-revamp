import { useEffect, useRef, useState } from 'react';
import '../../doctor-form.css';

const FIELDS = [
  'name', 'phone', 'dialCountry', 'alternatePhone', 'email', 'dateOfJoining',
  'registrationNumber', 'qualification', 'clinicName', 'mrId', 'invoiceType',
  'gstNumber', 'drugLicenceNumber', 'orderDiscount', 'daysLimit', 'paymentLimit',
  'status', 'addressLine1', 'addressLine2', 'landmark', 'pincode', 'country', 'state', 'city',
];
const REQUIRED = new Set([
  'name', 'phone', 'registrationNumber', 'qualification', 'mrId', 'invoiceType',
  'status', 'addressLine1', 'landmark', 'pincode', 'city', 'state', 'country',
]);
const TABS = [
  { id: 'identity', label: 'Identity & contact', fields: ['name', 'phone', 'dialCountry', 'alternatePhone', 'email', 'dateOfJoining', 'registrationNumber', 'qualification'] },
  { id: 'clinic', label: 'Clinic & assignment', fields: ['clinicName', 'mrId', 'status'] },
  { id: 'commercial', label: 'Commercial details', fields: ['invoiceType', 'gstNumber', 'drugLicenceNumber', 'orderDiscount', 'daysLimit', 'paymentLimit'] },
  { id: 'address', label: 'Address', fields: ['pincode', 'addressLine1', 'addressLine2', 'landmark', 'country', 'state', 'city'] },
];
const DIAL_COUNTRIES = [
  { value: 'IN', label: '🇮🇳 +91', digits: 10 },
  { value: 'US', label: '🇺🇸 +1', digits: 10 },
  { value: 'GB', label: '🇬🇧 +44', digits: 10 },
  { value: 'AE', label: '🇦🇪 +971', digits: 9 },
];

function initialValues(doctor) {
  return Object.fromEntries(FIELDS.map((key) => [
    key,
    key === 'country' ? (doctor?.country ?? 'India')
      : key === 'status' ? (doctor?.status || 'active')
      : key === 'invoiceType' ? (doctor?.invoiceType || 'normal')
        : key === 'dialCountry' ? (doctor?.dialCountry || 'IN')
          : key === 'dateOfJoining' ? String(doctor?.[key] ?? '').slice(0, 10)
            : String(doctor?.[key] ?? ''),
  ]));
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function validate(values) {
  const errors = {};
  for (const key of REQUIRED) if (!values[key]?.trim()) errors[key] = 'This field is required.';
  const dial = DIAL_COUNTRIES.find((country) => country.value === values.dialCountry);
  const digits = values.phone.replace(/\D/g, '');
  if (!dial) errors.dialCountry = 'Choose a supported country code.';
  if (values.phone && dial && (!/^[0-9\s()-]+$/.test(values.phone) || digits.length !== dial.digits)) {
    errors.phone = `Enter a valid ${dial.digits}-digit ${dial.value} phone number.`;
  }
  if (values.alternatePhone && dial && (!/^[0-9\s()-]+$/.test(values.alternatePhone) || values.alternatePhone.replace(/\D/g, '').length !== dial.digits)) {
    errors.alternatePhone = `Enter a valid ${dial.digits}-digit phone number.`;
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Enter a valid email address.';
  if (values.dateOfJoining && (!validDate(values.dateOfJoining) || new Date(`${values.dateOfJoining}T00:00:00`).getTime() > Date.now())) {
    errors.dateOfJoining = 'Enter a valid joining date that is not in the future.';
  }
  if (values.pincode && values.country.toLocaleLowerCase() === 'india' && !/^\d{6}$/.test(values.pincode)) {
    errors.pincode = 'Enter a 6-digit Indian pincode.';
  } else if (values.pincode && !/^[a-zA-Z0-9][a-zA-Z0-9 -]{1,11}$/.test(values.pincode)) {
    errors.pincode = 'Enter a valid postal code.';
  }
  if (values.invoiceType && !['normal', 'gst'].includes(values.invoiceType)) errors.invoiceType = 'Choose a valid invoice type.';
  if (values.invoiceType === 'gst' && !values.gstNumber.trim()) errors.gstNumber = 'GST number is required for GST invoices.';
  if (values.gstNumber && values.country.toLocaleLowerCase() === 'india' && !/^[0-9A-Z]{15}$/i.test(values.gstNumber.trim())) {
    errors.gstNumber = 'Enter a 15-character GSTIN.';
  }
  if (values.orderDiscount && (!/^\d+(\.\d{1,2})?$/.test(values.orderDiscount) || Number(values.orderDiscount) > 100)) {
    errors.orderDiscount = 'Enter a discount from 0 to 100 with up to 2 decimal places.';
  }
  if (values.daysLimit && (!/^\d+$/.test(values.daysLimit) || !Number.isSafeInteger(Number(values.daysLimit)))) {
    errors.daysLimit = 'Enter a non-negative whole number.';
  }
  if (values.paymentLimit && (!/^\d+(\.\d{1,2})?$/.test(values.paymentLimit) || !Number.isFinite(Number(values.paymentLimit)))) {
    errors.paymentLimit = 'Enter a non-negative amount with up to 2 decimal places.';
  }
  if (values.status && !['active', 'inactive'].includes(values.status)) errors.status = 'Choose a valid status.';
  return errors;
}

export default function DoctorForm({ doctor, records = [], mrs = [], blocked = false, onSave, onClose, onRefresh }) {
  const [values, setValues] = useState(() => initialValues(doctor));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('identity');
  const [pinState, setPinState] = useState({ status: 'idle', localities: [], error: '' });
  const [selectedLocality, setSelectedLocality] = useState('');
  const formRef = useRef(null);
  const tabRefs = useRef([]);
  const pendingFocus = useRef(null);
  const pinRequest = useRef(0);
  const selectedMR = mrs.find((mr) => String(mr.id) === values.mrId);
  const activeMRs = mrs.filter((mr) => mr.status === 'active');
  const mrOptions = selectedMR && selectedMR.status !== 'active' ? [...activeMRs, selectedMR] : activeMRs;
  const missingMR = Boolean(values.mrId) && !mrs.some((mr) => String(mr.id) === values.mrId);

  useEffect(() => {
    if (pendingFocus.current) {
      formRef.current?.elements.namedItem(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [activeTab, errors]);

  useEffect(() => {
    const request = ++pinRequest.current;
    if (values.country.trim().toLocaleLowerCase() !== 'india' || !/^\d{6}$/.test(values.pincode)) {
      setPinState({ status: 'idle', localities: [], error: '' });
      setSelectedLocality('');
      return undefined;
    }
    const controller = new AbortController();
    setPinState({ status: 'loading', localities: [], error: '' });
    setSelectedLocality('');
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`https://api.postalpincode.in/pincode/${encodeURIComponent(values.pincode)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Pincode lookup is temporarily unavailable.');
        const result = await response.json();
        if (request !== pinRequest.current) return;
        const postOffices = result?.[0]?.Status === 'Success' ? result[0].PostOffice || [] : [];
        const unique = [...new Map(postOffices.map((office) => [`${office.Name}|${office.District}|${office.State}`, {
          name: office.Name, city: office.District || office.Name, state: office.State, country: office.Country || 'India',
        }])).values()];
        setPinState(unique.length
          ? { status: 'ready', localities: unique, error: '' }
          : { status: 'empty', localities: [], error: 'No localities were found for this pincode. Enter the address manually.' });
      } catch (error) {
        if (error.name === 'AbortError' || request !== pinRequest.current) return;
        setPinState({ status: 'error', localities: [], error: 'Pincode lookup is offline or unavailable. You can enter the address manually.' });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [values.pincode, values.country]);

  function handleTabKey(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActiveTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  function change(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSaveError('');
  }

  function applyLocality() {
    const locality = pinState.localities[Number(selectedLocality)];
    if (!locality) return;
    setValues((current) => ({ ...current, city: locality.city, state: locality.state, country: locality.country }));
    setErrors((current) => {
      const next = { ...current };
      delete next.city; delete next.state; delete next.country;
      return next;
    });
  }

  function renderField(key, label, options = {}) {
    const { type = 'text', placeholder, autoComplete, span, hint, inputMode, min, step, selectOptions } = options;
    const errorId = `doctor-${key}-error`;
    const hintId = `doctor-${key}-hint`;
    const id = `doctor-${key}`;
    const describedBy = [errors[key] && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;
    const common = {
      id, name: key, className: 'doctor-form__control', value: values[key],
      onChange: (event) => change(key, event.target.value), autoComplete: autoComplete || 'off',
      'aria-required': REQUIRED.has(key), 'aria-invalid': Boolean(errors[key]),
      'aria-describedby': describedBy, 'data-testid': `input-doctor-${key}`,
    };
    let input = <input {...common} type={type} placeholder={placeholder} inputMode={inputMode} min={min} step={step} />;
    if (selectOptions) {
      input = <select {...common} data-testid={`select-doctor-${key}`}>
        <option value="">{placeholder || 'Select an option'}</option>
        {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>;
    } else if (key === 'phone' || key === 'alternatePhone') {
      input = <div className="doctor-form__input-row">
        {key === 'phone' && <select id="doctor-dialCountry" name="dialCountry" className="doctor-form__control doctor-form__dial-code" aria-label="Phone country code" aria-invalid={Boolean(errors.dialCountry)}
          value={values.dialCountry} onChange={(event) => change('dialCountry', event.target.value)} data-testid="select-doctor-dialCountry">
          {DIAL_COUNTRIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
        </select>}
        <input {...common} type="tel" placeholder={placeholder} inputMode="tel" autoComplete="tel" />
      </div>;
    }
    return <div className={`doctor-form__field${span ? ' doctor-form__field--wide' : ''}`} key={key}>
      <label className="doctor-form__label" htmlFor={id}>{label} {REQUIRED.has(key) && <span className="doctor-form__required" aria-hidden="true">*</span>}</label>
      {input}
      {hint && <p id={hintId} className="doctor-form__hint">{hint}</p>}
      {key === 'phone' && errors.dialCountry && <p className="doctor-form__error" role="alert">{errors.dialCountry}</p>}
      {errors[key] && <p id={errorId} className="doctor-form__error" role="alert" data-testid={`error-doctor-${key}`}>{errors[key]}</p>}
    </div>;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || blocked) return;
    const cleaned = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim()]));
    const nextErrors = validate(cleaned);
    if (cleaned.mrId && !mrOptions.some((mr) => String(mr.id) === cleaned.mrId)) nextErrors.mrId = 'Select an available medical representative.';
    const normalizedReg = cleaned.registrationNumber.toLocaleLowerCase();
    if (normalizedReg && records.some((record) => String(record.id) !== String(doctor?.id) && String(record.registrationNumber).toLocaleLowerCase() === normalizedReg)) {
      nextErrors.registrationNumber = 'This registration number already belongs to another doctor.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = FIELDS.find((key) => nextErrors[key]);
      pendingFocus.current = first;
      setActiveTab(TABS.find((tab) => tab.fields.includes(first)).id);
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      const result = await onSave({
        ...cleaned,
        phone: cleaned.phone.replace(/[\s()-]/g, ''),
        alternatePhone: cleaned.alternatePhone.replace(/[\s()-]/g, ''),
        orderDiscount: cleaned.orderDiscount === '' ? 0 : Number(cleaned.orderDiscount),
        daysLimit: cleaned.daysLimit === '' ? 0 : Number(cleaned.daysLimit),
        paymentLimit: cleaned.paymentLimit === '' ? 0 : Number(cleaned.paymentLimit),
      });
      if (!result?.success) setSaveError(result?.error || 'This doctor could not be saved. Please try again.');
    } catch (error) {
      setSaveError(error?.message || 'This doctor could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return <form className="doctor-form" ref={formRef} onSubmit={handleSubmit} noValidate data-testid="form-doctor">
    <div className="doctor-form__tabs" role="tablist" aria-label="Doctor profile sections">
      {TABS.map((tab, index) => <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} type="button"
        id={`doctor-tab-${tab.id}`} role="tab" aria-controls={`doctor-panel-${tab.id}`} aria-selected={activeTab === tab.id}
        tabIndex={activeTab === tab.id ? 0 : -1}
        className={`doctor-form__tab${activeTab === tab.id ? ' doctor-form__tab--active' : ''}${tab.fields.some((key) => errors[key]) ? ' doctor-form__tab--error' : ''}`}
        onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKey(event, index)} data-testid={`tab-doctor-${tab.id}`}>
        {tab.label}{tab.fields.some((key) => errors[key]) && <span className="doctor-form__tab-error" aria-label="Contains errors">!</span>}
      </button>)}
    </div>
    <div className="doctor-form__body">
      {missingMR && <p className="doctor-form__notice" role="status">The previously assigned MR is no longer available. Select an available MR before saving.</p>}
      {saveError && <div className="doctor-form__notice doctor-form__notice--error" role="alert" data-testid="error-doctor-save">
        <p>{saveError}</p><p>Refresh to review the latest records before trying again. Refreshing discards changes on this page.</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-doctor-save">Refresh records</button>
      </div>}
      <section className="doctor-form__section" id="doctor-panel-identity" role="tabpanel" aria-labelledby="doctor-tab-identity" tabIndex={0} hidden={activeTab !== 'identity'}>
        <div className="doctor-form__section-head"><h3 className="doctor-form__section-title">Identity & contact</h3><p className="doctor-form__section-note">Fields marked * are required</p></div>
        <div className="doctor-form__grid">
          {renderField('name', 'Doctor Name', { placeholder: 'Doctor name', autoComplete: 'name' })}
          {renderField('phone', 'Phone No.', { placeholder: 'Phone number', hint: 'Country selection determines the expected number of digits and is saved with this record.' })}
          {renderField('alternatePhone', 'Alternate Phone No.', { placeholder: 'Alternate phone number' })}
          {renderField('email', 'Email ID', { type: 'email', placeholder: 'name@example.com', autoComplete: 'email' })}
          {renderField('dateOfJoining', 'Date of joining', { type: 'date' })}
          {renderField('registrationNumber', 'Registration Number', { placeholder: 'Registration number' })}
          {renderField('qualification', 'Qualification', { placeholder: 'Qualification' })}
          <div className="doctor-form__field">
            <label className="doctor-form__label" htmlFor="doctor-password">Password</label>
            <div className="doctor-form__input-row">
              <input id="doctor-password" className="doctor-form__control" type="password" placeholder="Unavailable" disabled autoComplete="off" aria-describedby="doctor-password-hint" data-testid="input-doctor-password" />
              <button type="button" className="doctor-form__preview-action" disabled aria-describedby="doctor-password-hint" data-testid="button-generate-doctor-password">Generate password</button>
            </div>
            <p id="doctor-password-hint" className="doctor-form__hint">Passwords cannot be entered, generated, saved or exported. No doctor login is created.</p>
          </div>
          <div className="doctor-form__field">
            <label className="doctor-form__label" htmlFor="doctor-confirm-password">Confirm password</label>
            <input id="doctor-confirm-password" className="doctor-form__control" type="password" placeholder="Unavailable" disabled autoComplete="off" aria-describedby="doctor-password-hint" data-testid="input-doctor-confirm-password" />
          </div>
        </div>
      </section>
      <section className="doctor-form__section" id="doctor-panel-clinic" role="tabpanel" aria-labelledby="doctor-tab-clinic" tabIndex={0} hidden={activeTab !== 'clinic'}>
        <div className="doctor-form__section-head"><h3 className="doctor-form__section-title">Clinic & assignment</h3></div>
        <div className="doctor-form__grid">
          {renderField('clinicName', 'Clinic Name', { placeholder: 'Clinic name' })}
          {renderField('mrId', 'MR Name', { placeholder: 'Select MR', selectOptions: mrOptions.map((mr) => ({ value: String(mr.id), label: `${mr.name}${mr.status === 'inactive' ? ' (inactive)' : ''}` }))})}
          {renderField('status', 'Status', { selectOptions: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] })}
        </div>
      </section>
      <section className="doctor-form__section" id="doctor-panel-commercial" role="tabpanel" aria-labelledby="doctor-tab-commercial" tabIndex={0} hidden={activeTab !== 'commercial'}>
        <div className="doctor-form__section-head"><h3 className="doctor-form__section-title">Commercial details</h3></div>
        <div className="doctor-form__grid">
          {renderField('invoiceType', 'Invoice Type', { selectOptions: [{ value: 'normal', label: 'Normal' }, { value: 'gst', label: 'GST' }] })}
          {renderField('gstNumber', 'GST Number', { placeholder: values.invoiceType === 'gst' ? 'GSTIN' : 'Optional', hint: values.invoiceType === 'gst' ? 'Required for GST invoices.' : undefined })}
          {renderField('drugLicenceNumber', 'Drug Licence No.', { placeholder: 'Drug licence number' })}
          {renderField('orderDiscount', 'Order Discount (in %)', { type: 'number', min: '0', max: '100', step: '0.01', placeholder: '0', inputMode: 'decimal' })}
          {renderField('daysLimit', 'Days Limit', { type: 'number', min: '0', step: '1', placeholder: '0', inputMode: 'numeric' })}
          {renderField('paymentLimit', 'Payment Limit', { type: 'number', min: '0', step: '0.01', placeholder: '0', inputMode: 'decimal' })}
        </div>
      </section>
      <section className="doctor-form__section" id="doctor-panel-address" role="tabpanel" aria-labelledby="doctor-tab-address" tabIndex={0} hidden={activeTab !== 'address'}>
        <div className="doctor-form__section-head"><h3 className="doctor-form__section-title">Address</h3></div>
        <div className="doctor-form__grid">
          {renderField('pincode', 'Pincode', { placeholder: 'Pincode', inputMode: 'numeric', autoComplete: 'postal-code', hint: 'Six-digit Indian PINs offer optional address suggestions; other postal codes use manual entry.' })}
          {pinState.status !== 'idle' && <div className="doctor-form__lookup" role="status" aria-live="polite">
            {pinState.status === 'loading' && <p className="doctor-form__hint">Looking up pincode…</p>}
            {pinState.error && <p className="doctor-form__hint">{pinState.error}</p>}
            {pinState.localities.length > 0 && <>
              <label className="doctor-form__label" htmlFor="doctor-locality">Pincode localities (suggestions only)</label>
              <div className="doctor-form__input-row">
                <select id="doctor-locality" className="doctor-form__control" value={selectedLocality} onChange={(event) => setSelectedLocality(event.target.value)} data-testid="select-doctor-locality">
                  <option value="">Choose a locality suggestion</option>
                  {pinState.localities.map((item, index) => <option key={`${item.name}-${item.city}-${item.state}`} value={String(index)}>{item.name} — {item.city}, {item.state}</option>)}
                </select>
                <button type="button" className="admin-button admin-button--secondary" disabled={!selectedLocality} onClick={applyLocality} data-testid="button-apply-doctor-locality">Apply suggestion</button>
              </div>
              <p className="doctor-form__hint">Nothing is changed until you apply a suggestion; you can edit every address field afterwards.</p>
            </>}
          </div>}
          {renderField('addressLine1', 'Address Line 1', { placeholder: 'Address line 1', span: true, autoComplete: 'address-line1' })}
          {renderField('addressLine2', 'Address Line 2', { placeholder: 'Address line 2', span: true, autoComplete: 'address-line2' })}
          {renderField('landmark', 'Landmark', { placeholder: 'Nearby landmark' })}
          {renderField('country', 'Country', { placeholder: 'Country', autoComplete: 'country-name' })}
          {renderField('state', 'State', { placeholder: 'State', autoComplete: 'address-level1' })}
          {renderField('city', 'City', { placeholder: 'City', autoComplete: 'address-level2' })}
        </div>
      </section>
    </div>
    <div className="doctor-form__footer">
      <span className="doctor-form__footer-note">Stored in this browser’s local preview.</span>
      <div className="doctor-form__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-doctor">Cancel</button>
        <button type="submit" className="admin-button" disabled={saving || blocked} data-testid="button-save-doctor">{saving ? 'Saving…' : doctor ? 'Save changes' : 'Add Doctor'}</button>
      </div>
    </div>
  </form>;
}