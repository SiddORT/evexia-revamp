import { useEffect, useRef, useState } from 'react';
import PhoneInput from './PhoneInput.jsx';
import PatientLanguageSelect from './PatientLanguageSelect.jsx';
import PatientDoctorSelect from './PatientDoctorSelect.jsx';
import useAddressSelection from './useAddressSelection.js';
import { GeographyControl, GeographyLabel, PostalSelection, useAddressCatalogue } from './AddressGeography.jsx';
import { dialCountry, normalizePhone } from '../../services/phoneCountries.js';
import { businessToday, patientAge } from '../../services/serverPatients.js';
import { lookupPatientPIN } from '../../services/serverPatients.js';
import { masterNameError, masterLengthErrors, normalizeMasterName, presentMasterFailure } from '../../services/masterValidation.js';
import '../../mr.css';
import '../../patient.css';

const FIELDS = [
  'name', 'gender', 'phone', 'dialCountry', 'email', 'dateOfBirth', 'doctorId',
  'instructionsLanguage', 'status', 'addressLine1', 'addressLine2',
  'landmark', 'pincode', 'city', 'state', 'country',
];
const OPTIONAL = new Set(['email', 'addressLine2']);
const TABS = [
  { id: 'identity', label: 'Identity & contact', fields: ['name', 'gender', 'phone', 'dialCountry', 'email', 'dateOfBirth'] },
  { id: 'care', label: 'Care & assignment', fields: ['doctorId', 'instructionsLanguage', 'status'] },
  { id: 'address', label: 'Address', fields: ['addressLine1', 'addressLine2', 'landmark', 'pincode', 'city', 'state', 'country'] },
];

function initialValues(patient) {
  return Object.fromEntries(FIELDS.map((key) => [
    key,
    key === 'dialCountry' ? String(patient?.dialCountry ?? 'IN') : key === 'status' ? String(patient?.status ?? 'active')
      : key === 'country' ? String(patient?.country ?? 'India')
        : key === 'dateOfBirth' ? String(patient?.[key] ?? '').slice(0, 10)
          : String(patient?.[key] ?? ''),
  ]));
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7))
    && date.getDate() === Number(value.slice(8, 10));
}

function todayLocal() {
  return businessToday();
}

function ageFromDate(value) {
  return validDate(value) && value <= businessToday() ? String(patientAge(value)) : '';
}

function validate(values) {
  const errors = masterLengthErrors(values, {
    phone: 20, email: 320, instructionsLanguage: 200, addressLine1: 300,
    addressLine2: 300, landmark: 200, pincode: 12, city: 100, state: 100, country: 100,
  });
  const nameError = masterNameError(values.name, 'patient name', { personal: true });
  if (nameError) errors.name = nameError;
  FIELDS.forEach((key) => {
    if (!OPTIONAL.has(key) && !values[key].trim()) errors[key] = 'This field is required.';
  });
  const dial = dialCountry(values.dialCountry);
  if (!dial) errors.dialCountry = 'Choose a supported dialing country.';
  if (values.phone && normalizePhone(values.phone, values.dialCountry, 'patient') === null) {
    errors.phone = `Enter a valid national phone number for ${dial?.name || 'the selected country'}.`;
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (values.dateOfBirth) {
    if (!validDate(values.dateOfBirth)) errors.dateOfBirth = 'Enter a valid date of birth.';
    else if (values.dateOfBirth > businessToday()) errors.dateOfBirth = 'Date of birth cannot be in the future.';
  }
  if (values.pincode && values.country.toLowerCase() === 'india' && !/^[0-9]{6}$/.test(values.pincode)) {
    errors.pincode = 'Enter a 6-digit pincode for India.';
  }
  if (values.gender && !['male', 'female', 'other', 'prefer not to say'].includes(values.gender)) errors.gender = 'Choose a valid gender.';
  if (values.status && !['active', 'inactive'].includes(values.status)) errors.status = 'Choose a valid status.';
  return errors;
}

export default function PatientForm({ patient, blocked = false, onSave, onClose, onRefresh }) {
  const [values, setValues] = useState(() => initialValues(patient));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('identity');
  const formRef = useRef(null);
  const tabRefs = useRef([]);
  const pendingFocus = useRef(null);

  const address = useAddressSelection({ values, onChange: patchAddress, lookupPIN: lookupPatientPIN, editing: Boolean(patient), disabled: blocked || saving });
  const catalogue = useAddressCatalogue(address);
  function patchAddress(patch) {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => ({ ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, undefined])) }));
    setSaveError('');
  }

  useEffect(() => {
    if (pendingFocus.current) {
      formRef.current?.elements.namedItem(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [activeTab, errors]);

  function change(key, value) {
    address.change(key, value);
  }

  function handleTabKey(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActiveTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  function renderField(key, label, options = {}) {
    const { type = 'text', placeholder, autoComplete, span, hint, inputMode, selectOptions } = options;
    const id = `patient-${key}`;
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;
    const describedBy = [errors[key] && errorId, hint && hintId, key === 'pincode' && address.postal.message && 'patient-pin-feedback'].filter(Boolean).join(' ') || undefined;
    const shared = {
      id, name: key, className: 'mr-form__control', value: values[key],
      onChange: (event) => change(key, event.target.value),
      'aria-required': !OPTIONAL.has(key),
      'aria-invalid': Boolean(errors[key]),
      'aria-describedby': describedBy,
      required: !OPTIONAL.has(key),
    };
    return (
      <div className={`mr-form__field${span ? ' mr-form__field--wide' : ''}`} key={key}>
        {['country', 'state', 'city'].includes(key) ? <GeographyLabel field={key} id={id} label={label}
          required={!OPTIONAL.has(key)} className="mr-form__label" /> : <label className="mr-form__label" htmlFor={id}>
          {label} {!OPTIONAL.has(key) && <span className="mr-form__required" aria-hidden="true">*</span>}
        </label>}
        {['country', 'state', 'city'].includes(key) ? <GeographyControl address={address} catalogue={catalogue}
          field={key} id={id} label={label} required={!OPTIONAL.has(key)} invalid={Boolean(errors[key])}
          describedBy={describedBy} /> : selectOptions ? (
          <select {...shared} data-testid={`select-patient-${key}`}>
            <option value="">{placeholder || 'Select an option'}</option>
            {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : key === 'phone' ? (
          <PhoneInput prefix="patient" country={values.dialCountry} onCountryChange={(value) => change('dialCountry', value)}
             countryError={errors.dialCountry} controlClassName="mr-form__control" inputProps={{ ...shared, disabled: saving || blocked, placeholder: 'National phone number', 'data-testid': 'input-patient-phone' }} />
        ) : (
          <input {...shared} type={type} placeholder={placeholder} autoComplete={autoComplete || 'off'}
            inputMode={inputMode} max={type === 'date' ? todayLocal() : undefined}
            data-testid={`input-patient-${key}`} />
        )}
        {hint && <p id={hintId} className="mr-form__hint">{hint}</p>}
        {errors[key] && <p id={errorId} className="mr-form__error" role="alert" data-testid={`error-patient-${key}`}>{errors[key]}</p>}
        {key === 'phone' && errors.dialCountry && <p id="patient-dialCountry-error" className="mr-form__error" role="alert">{errors.dialCountry}</p>}
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || blocked) return;
    const cleaned = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim()]));
    cleaned.name = normalizeMasterName(values.name);
    const nextErrors = validate(cleaned);
    if (address.postal.required) nextErrors.pincode = 'Choose a PIN location or confirm catalogue selection.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = FIELDS.find((key) => nextErrors[key]);
      pendingFocus.current = first;
      setActiveTab(TABS.find((tab) => tab.fields.includes(first)).id);
      return;
    }
    setSaveError('');
    address.pause();
    setSaving(true);
    try {
      const result = await onSave({ ...cleaned, phone: normalizePhone(cleaned.phone, cleaned.dialCountry, 'patient') });
      if (!result?.success) presentMasterFailure(result, { fields: FIELDS, tabs: TABS, setErrors, setActiveTab, pendingFocus, setMessage: setSaveError, fallback: 'This patient could not be saved. Your draft is preserved.' });
    } catch (error) {
      presentMasterFailure(error, { fields: FIELDS, tabs: TABS, setErrors, setActiveTab, pendingFocus, setMessage: setSaveError, fallback: 'This patient could not be saved. Your draft is preserved.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mr-form patient-form" ref={formRef} onSubmit={handleSubmit}
      onFocusCapture={(event) => {
        // Native focus scrolling can leave enlarged selects partly below the
        // viewport in Firefox. Keep the entire focused control (and its scroll
        // margin) visible without changing its value or moving keyboard focus.
        if (event.target.matches('input, select, button')) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }}
      noValidate data-testid="form-patient">
      <div className="mr-form__tabs" role="tablist" aria-label="Patient profile sections">
        {TABS.map((tab, index) => (
          <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} type="button"
            id={`patient-tab-${tab.id}`} role="tab" aria-controls={`patient-panel-${tab.id}`}
            aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1}
            className={`mr-form__tab${activeTab === tab.id ? ' mr-form__tab--active' : ''}${tab.fields.some((key) => errors[key]) ? ' mr-form__tab--error' : ''}`}
            onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKey(event, index)}
            data-testid={`tab-patient-${tab.id}`}>
            {tab.label}{tab.fields.some((key) => errors[key]) && <span className="mr-form__tab-error" aria-label="Contains errors">!</span>}
          </button>
        ))}
      </div>
      <div className="mr-form__body">
        {blocked && <div className="patient-form__block" role="alert" data-testid="warning-patient-blocked">
          <p>Saving is unavailable while patient records need attention. Refreshing discards changes on this page.</p>
          <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-patient-blocked">Refresh records</button>
        </div>}
        {patient?.assignmentWarnings?.map((warning) => <p className="mr-form__notice" role="alert" key={warning}>{warning}</p>)}
        {saveError && (
          <div className="mr-form__notice mr-form__notice--error" role="alert" data-testid="error-patient-save">
            <p>{saveError}</p>
            <p>Refresh records to review the latest data before trying again. Refreshing discards changes on this page.</p>
            <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-patient-save">Refresh records</button>
          </div>
        )}
        <section className="mr-form__section" id="patient-panel-identity" role="tabpanel" aria-labelledby="patient-tab-identity" tabIndex={0} hidden={activeTab !== 'identity'}>
          {patient && <p className="mr-form__hint">Patient ID: {patient.code}</p>}
          <div className="mr-form__section-head"><h3 className="mr-form__section-title">Identity & contact</h3><p className="mr-form__section-note">Fields marked * are required</p></div>
          <div className="mr-form__grid">
            {renderField('name', 'Patient name', { placeholder: 'Patient name', autoComplete: 'name' })}
            {renderField('gender', 'Gender', { selectOptions: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }, { value: 'prefer not to say', label: 'Prefer not to say' }] })}
            {renderField('phone', 'Phone No.', { placeholder: '10-digit number', autoComplete: 'tel', inputMode: 'tel' })}
            {renderField('email', 'Email ID', { type: 'email', placeholder: 'name@example.com', autoComplete: 'email' })}
            {renderField('dateOfBirth', 'Date of birth', { type: 'date', autoComplete: 'bday' })}
            <div className="mr-form__field">
              <label className="mr-form__label" htmlFor="patient-age">Age</label>
              <input id="patient-age" className="mr-form__control patient-form__age" type="text" value={ageFromDate(values.dateOfBirth)}
                placeholder="Calculated from date of birth" readOnly aria-describedby="patient-age-hint" data-testid="input-patient-age" />
              <p id="patient-age-hint" className="mr-form__hint">Calculated automatically; not saved separately.</p>
            </div>
          </div>
        </section>
        <section className="mr-form__section" id="patient-panel-care" role="tabpanel" aria-labelledby="patient-tab-care" tabIndex={0} hidden={activeTab !== 'care'}>
          <div className="mr-form__section-head"><h3 className="mr-form__section-title">Care & assignment</h3></div>
          <div className="mr-form__grid patient-form__care-grid">
            <PatientDoctorSelect value={values.doctorId} original={patient?.doctorId} savedName={patient?.doctorName} blocked={blocked || saving} error={errors.doctorId} onChange={(value) => change('doctorId', value)} />
            <PatientLanguageSelect value={values.instructionsLanguage} original={patient?.instructionsLanguage}
              blocked={blocked || saving} error={errors.instructionsLanguage}
              onChange={(value) => change('instructionsLanguage', value)} />
            {renderField('status', 'Status', { selectOptions: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] })}
          </div>
        </section>
        <section className="mr-form__section" id="patient-panel-address" role="tabpanel" aria-labelledby="patient-tab-address" tabIndex={0} hidden={activeTab !== 'address'}>
          <div className="mr-form__section-head"><h3 className="mr-form__section-title">Address</h3></div>
          <div className="mr-form__grid patient-form__address-grid">
            <div className="patient-form__pincode-row">
              {renderField('pincode', 'Pincode', { placeholder: '6-digit pincode for India', inputMode: 'numeric', autoComplete: 'postal-code' })}
            </div>
            <PostalSelection address={address} prefix="patient" fieldClass="mr-form__field patient-form__pin-choices" />
            {renderField('addressLine1', 'Address line 1', { placeholder: 'Street address', span: true, autoComplete: 'address-line1' })}
            {renderField('addressLine2', 'Address line 2', { placeholder: 'Apartment, suite or area', span: true, autoComplete: 'address-line2' })}
            {renderField('landmark', 'Landmark', { placeholder: 'Nearby landmark' })}
            {renderField('country', 'Country', { placeholder: 'Country', autoComplete: 'country-name' })}
            {renderField('state', 'State', { placeholder: 'State', autoComplete: 'address-level1' })}
            {renderField('city', 'City', { placeholder: 'City', autoComplete: 'address-level2' })}
          </div>
        </section>
      </div>
      <div className="mr-form__footer">
        <span className="mr-form__footer-note">Saved securely to the shared Patient directory.</span>
        <div className="mr-form__actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-patient">Cancel</button>
          <button type="submit" className="admin-button" disabled={saving || blocked} data-testid="button-save-patient">
            {saving ? 'Saving…' : patient ? 'Save changes' : 'Add patient'}
          </button>
        </div>
      </div>
    </form>
  );
}