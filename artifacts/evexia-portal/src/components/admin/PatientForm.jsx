import { useEffect, useRef, useState } from 'react';
import '../../mr.css';
import '../../patient.css';

const FIELDS = [
  'name', 'gender', 'phone', 'email', 'dateOfBirth', 'doctorId',
  'instructionsLanguage', 'status', 'addressLine1', 'addressLine2',
  'landmark', 'pincode', 'city', 'state', 'country',
];
const OPTIONAL = new Set(['email', 'addressLine2']);
const TABS = [
  { id: 'identity', label: 'Identity & contact', fields: ['name', 'gender', 'phone', 'email', 'dateOfBirth'] },
  { id: 'care', label: 'Care & assignment', fields: ['doctorId', 'instructionsLanguage', 'status'] },
  { id: 'address', label: 'Address', fields: ['addressLine1', 'addressLine2', 'landmark', 'pincode', 'city', 'state', 'country'] },
];
const LANGUAGES = ['English', 'Hindi', 'Bengali', 'Gujarati', 'Kannada', 'Malayalam', 'Marathi', 'Odia', 'Punjabi', 'Tamil', 'Telugu', 'Urdu'];

function initialValues(patient) {
  return Object.fromEntries(FIELDS.map((key) => [
    key,
    key === 'status' ? String(patient?.status ?? 'active')
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
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function ageFromDate(value) {
  if (!validDate(value)) return '';
  const today = new Date();
  const [year, month, day] = value.split('-').map(Number);
  if (new Date(`${value}T00:00:00`) > today) return '';
  return String(today.getFullYear() - year - (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0));
}

function validate(values, doctorOptions) {
  const errors = {};
  FIELDS.forEach((key) => {
    if (!OPTIONAL.has(key) && !values[key].trim()) errors[key] = 'This field is required.';
  });
  if (values.phone && !/^[0-9]{10}$/.test(values.phone.replace(/[\s()-]/g, ''))) {
    errors.phone = 'Enter a 10-digit phone number.';
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (values.dateOfBirth) {
    if (!validDate(values.dateOfBirth)) errors.dateOfBirth = 'Enter a valid date of birth.';
    else if (new Date(`${values.dateOfBirth}T00:00:00`) > new Date()) errors.dateOfBirth = 'Date of birth cannot be in the future.';
  }
  if (values.doctorId && !doctorOptions.some((doctor) => String(doctor.id) === values.doctorId)) {
    errors.doctorId = 'Select an available doctor.';
  }
  if (values.pincode && values.country.toLowerCase() === 'india' && !/^[0-9]{6}$/.test(values.pincode)) {
    errors.pincode = 'Enter a 6-digit pincode for India.';
  }
  if (values.gender && !['male', 'female', 'other'].includes(values.gender)) errors.gender = 'Choose a valid gender.';
  if (values.status && !['active', 'inactive'].includes(values.status)) errors.status = 'Choose a valid status.';
  return errors;
}

export default function PatientForm({ patient, doctors = [], blocked = false, onSave, onClose, onRefresh }) {
  const [values, setValues] = useState(() => initialValues(patient));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('identity');
  const formRef = useRef(null);
  const tabRefs = useRef([]);
  const pendingFocus = useRef(null);

  const assignedDoctor = doctors.find((doctor) => String(doctor.id) === values.doctorId);
  const activeDoctors = doctors.filter((doctor) => doctor.status === 'active');
  const doctorOptions = assignedDoctor?.status === 'inactive' && !activeDoctors.some((doctor) => String(doctor.id) === values.doctorId)
    ? [...activeDoctors, assignedDoctor] : activeDoctors;
  const missingDoctor = Boolean(values.doctorId) && !assignedDoctor;
  const invalidAssignment = Boolean(values.doctorId) && !doctorOptions.some((doctor) => String(doctor.id) === values.doctorId);

  useEffect(() => {
    if (pendingFocus.current) {
      formRef.current?.elements.namedItem(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [activeTab, errors]);

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
    const describedBy = [errors[key] && errorId, hint && hintId].filter(Boolean).join(' ') || undefined;
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
        <label className="mr-form__label" htmlFor={id}>
          {label} {!OPTIONAL.has(key) && <span className="mr-form__required" aria-hidden="true">*</span>}
        </label>
        {selectOptions ? (
          <select {...shared} data-testid={`select-patient-${key}`}>
            <option value="">{placeholder || 'Select an option'}</option>
            {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : (
          <input {...shared} type={type} placeholder={placeholder} autoComplete={autoComplete || 'off'}
            inputMode={inputMode} max={type === 'date' ? todayLocal() : undefined}
            data-testid={`input-patient-${key}`} />
        )}
        {hint && <p id={hintId} className="mr-form__hint">{hint}</p>}
        {errors[key] && <p id={errorId} className="mr-form__error" role="alert" data-testid={`error-patient-${key}`}>{errors[key]}</p>}
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving || blocked) return;
    const cleaned = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim()]));
    const nextErrors = validate(cleaned, doctorOptions);
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
      const result = await onSave({ ...cleaned, phone: cleaned.phone.replace(/[\s()-]/g, '') });
      if (!result?.success) setSaveError(result?.error || 'This patient could not be saved. Please try again.');
    } catch (error) {
      setSaveError(error?.message || 'This patient could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mr-form patient-form" ref={formRef} onSubmit={handleSubmit} noValidate data-testid="form-patient">
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
        <p className="patient-form__privacy" data-testid="notice-patient-preview"><strong>Browser-local preview.</strong> Do not enter real patient or health information. These records are stored in this browser only.</p>
        {blocked && <div className="patient-form__block" role="alert" data-testid="warning-patient-blocked">
          <p>Saving is unavailable while patient records need attention. Refreshing discards changes on this page.</p>
          <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-patient-blocked">Refresh records</button>
        </div>}
        {missingDoctor && <p className="mr-form__notice" role="alert" data-testid="warning-patient-doctor">The previously assigned doctor is no longer available. Select an active doctor before saving.</p>}
        {!missingDoctor && invalidAssignment && <p className="mr-form__notice" role="alert" data-testid="warning-patient-doctor">This doctor is unavailable. Select an active doctor before saving.</p>}
        {saveError && (
          <div className="mr-form__notice mr-form__notice--error" role="alert" data-testid="error-patient-save">
            <p>{saveError}</p>
            <p>Refresh records to review the latest data before trying again. Refreshing discards changes on this page.</p>
            <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-patient-save">Refresh records</button>
          </div>
        )}
        <section className="mr-form__section" id="patient-panel-identity" role="tabpanel" aria-labelledby="patient-tab-identity" tabIndex={0} hidden={activeTab !== 'identity'}>
          <div className="mr-form__section-head"><h3 className="mr-form__section-title">Identity & contact</h3><p className="mr-form__section-note">Fields marked * are required</p></div>
          <div className="mr-form__grid">
            {renderField('name', 'Patient name', { placeholder: 'Patient name', autoComplete: 'name' })}
            {renderField('gender', 'Gender', { selectOptions: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] })}
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
          <div className="mr-form__grid">
            {renderField('doctorId', 'Assigned doctor', {
              placeholder: invalidAssignment ? 'Choose a replacement doctor' : 'Select a doctor',
              hint: assignedDoctor?.status === 'inactive' ? 'This assigned doctor is inactive. You can retain the assignment or select an active doctor.' : undefined,
              selectOptions: doctorOptions.map((doctor) => ({ value: String(doctor.id), label: `${doctor.name}${doctor.status === 'inactive' ? ' (inactive)' : ''}` })),
            })}
            {renderField('instructionsLanguage', 'Instructions language', {
              selectOptions: [...new Set([...LANGUAGES, values.instructionsLanguage].filter(Boolean))].map((language) => ({ value: language, label: language })),
            })}
            {renderField('status', 'Status', { selectOptions: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] })}
          </div>
        </section>
        <section className="mr-form__section" id="patient-panel-address" role="tabpanel" aria-labelledby="patient-tab-address" tabIndex={0} hidden={activeTab !== 'address'}>
          <div className="mr-form__section-head"><h3 className="mr-form__section-title">Address</h3></div>
          <div className="mr-form__grid">
            {renderField('addressLine1', 'Address line 1', { placeholder: 'Street address', span: true, autoComplete: 'address-line1' })}
            {renderField('addressLine2', 'Address line 2', { placeholder: 'Apartment, suite or area', span: true, autoComplete: 'address-line2' })}
            {renderField('landmark', 'Landmark', { placeholder: 'Nearby landmark' })}
            {renderField('pincode', 'Pincode', { placeholder: '6-digit pincode for India', inputMode: 'numeric', autoComplete: 'postal-code' })}
            {renderField('city', 'City', { placeholder: 'City', autoComplete: 'address-level2' })}
            {renderField('state', 'State', { placeholder: 'State', autoComplete: 'address-level1' })}
            {renderField('country', 'Country', { placeholder: 'Country', autoComplete: 'country-name' })}
          </div>
        </section>
      </div>
      <div className="mr-form__footer">
        <span className="mr-form__footer-note">Stored in this browser’s local preview. No real health information.</span>
        <div className="mr-form__actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-patient">Cancel</button>
          <button type="submit" className="admin-button" disabled={saving || blocked || invalidAssignment} data-testid="button-save-patient">
            {saving ? 'Saving…' : patient ? 'Save changes' : 'Add patient'}
          </button>
        </div>
      </div>
    </form>
  );
}