import { useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import '../../mr.css';

const FIELDS = [
  'name', 'phone', 'userId', 'email', 'hq', 'zoneId', 'employeeCode',
  'dateOfJoining', 'designation', 'reportingManagerId', 'paymentLimit',
  'doctorDaysLimit', 'status', 'addressLine1', 'addressLine2', 'landmark',
  'pincode', 'city', 'state', 'country',
];
const OPTIONAL = new Set(['reportingManagerId', 'addressLine2', 'paymentLimit', 'doctorDaysLimit']);

function initialValues(mr) {
  return Object.fromEntries(FIELDS.map((key) => [
    key,
    key === 'status' ? (mr?.status || 'active')
      : key === 'country' ? (mr?.country ?? 'India')
      : key === 'dateOfJoining' ? String(mr?.[key] ?? '').slice(0, 10)
        : String(mr?.[key] ?? ''),
  ]));
}

function validate(values) {
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
  if (values.dateOfJoining) {
    const date = values.dateOfJoining;
    const parsed = new Date(`${date}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== Number(date.slice(0, 4)) || parsed.getMonth() + 1 !== Number(date.slice(5, 7)) || parsed.getDate() !== Number(date.slice(8, 10))) {
      errors.dateOfJoining = 'Enter a valid joining date.';
    } else if (parsed.getTime() > new Date().getTime()) {
      errors.dateOfJoining = 'Joining date cannot be in the future.';
    }
  }
  if (values.pincode && !/^[0-9]{6}$/.test(values.pincode)) {
    errors.pincode = 'Enter a 6-digit pincode.';
  }
  if (values.paymentLimit && (!/^\d+(\.\d{1,2})?$/.test(values.paymentLimit) || !Number.isFinite(Number(values.paymentLimit)))) {
    errors.paymentLimit = 'Enter a non-negative amount with up to 2 decimal places.';
  }
  if (values.doctorDaysLimit && (!/^\d+$/.test(values.doctorDaysLimit) || !Number.isSafeInteger(Number(values.doctorDaysLimit)))) {
    errors.doctorDaysLimit = 'Enter a non-negative whole number.';
  }
  if (values.status && !['active', 'inactive'].includes(values.status)) errors.status = 'Choose a valid status.';
  return errors;
}

export default function MRForm({ mr, records = [], zones = [], onSave, onClose }) {
  const [values, setValues] = useState(() => initialValues(mr));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const formRef = useRef(null);
  const assignedZone = zones.find((zone) => String(zone.id) === values.zoneId);
  const activeZones = zones.filter((zone) => zone.status === 'active');
  const zoneOptions = assignedZone?.status === 'inactive'
    ? [...activeZones, assignedZone]
    : activeZones;
  const missingZone = Boolean(values.zoneId) && !assignedZone;
  const otherMRs = records.filter((record) => String(record.id) !== String(mr?.id));

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

  function renderField(key, label, options = {}) {
    const { type = 'text', placeholder, autoComplete, span, hint, inputMode, min, step, selectOptions } = options;
    const errorId = `mr-${key}-error`;
    const hintId = `mr-${key}-hint`;
    const id = `mr-${key}`;
    return (
      <div className={`mr-form__field${span ? ' mr-form__field--wide' : ''}`} key={key}>
        <label className="mr-form__label" htmlFor={id}>
          {label} {!OPTIONAL.has(key) && <span className="mr-form__required" aria-hidden="true">*</span>}
        </label>
        {selectOptions ? (
          <select
            id={id}
            name={key}
            className="mr-form__control"
            value={values[key]}
            onChange={(event) => change(key, event.target.value)}
            aria-required={!OPTIONAL.has(key)}
            aria-invalid={Boolean(errors[key])}
            aria-describedby={[errors[key] && errorId, hint && hintId].filter(Boolean).join(' ') || undefined}
            data-testid={`select-mr-${key}`}
          >
            <option value="">{placeholder || 'Select an option'}</option>
            {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : (
          <input
            id={id}
            name={key}
            className="mr-form__control"
            type={type}
            value={values[key]}
            onChange={(event) => change(key, event.target.value)}
            placeholder={placeholder}
            autoComplete={autoComplete || 'off'}
            inputMode={inputMode}
            min={min}
            step={step}
            aria-required={!OPTIONAL.has(key)}
            aria-invalid={Boolean(errors[key])}
            aria-describedby={[errors[key] && errorId, hint && hintId].filter(Boolean).join(' ') || undefined}
            data-testid={`input-mr-${key}`}
          />
        )}
        {hint && <p id={hintId} className="mr-form__hint">{hint}</p>}
        {errors[key] && <p id={errorId} className="mr-form__error" role="alert" data-testid={`error-mr-${key}`}>{errors[key]}</p>}
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const cleaned = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim()]));
    const nextErrors = validate(cleaned);
    if (cleaned.zoneId && !zoneOptions.some((zone) => String(zone.id) === cleaned.zoneId)) {
      nextErrors.zoneId = 'Select an available zone.';
    }
    if (cleaned.reportingManagerId && !otherMRs.some((record) => String(record.id) === cleaned.reportingManagerId)) {
      nextErrors.reportingManagerId = 'Select an available reporting manager.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => {
        const firstInvalid = formRef.current?.querySelector('[aria-invalid="true"]');
        firstInvalid?.focus();
      });
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      const result = await onSave({
        ...cleaned,
        phone: cleaned.phone.replace(/[\s()-]/g, ''),
        paymentLimit: cleaned.paymentLimit === '' ? null : Number(cleaned.paymentLimit),
        doctorDaysLimit: cleaned.doctorDaysLimit === '' ? null : Number(cleaned.doctorDaysLimit),
      });
      if (!result?.success) setSaveError(result?.error || 'This MR could not be saved. Please try again.');
    } catch (error) {
      setSaveError(error?.message || 'This MR could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      className="mr-dialog"
      eyebrow="MR Master"
      title={mr ? 'Edit MR record' : 'Add MR record'}
      description={mr ? 'Update the staff profile and assignment details below.' : 'Create a local preview record for a medical representative.'}
      onClose={onClose}
    >
      <form className="mr-form" ref={formRef} onSubmit={handleSubmit} noValidate data-testid="form-mr">
        <div className="mr-form__body">
          {missingZone && <p className="mr-form__notice" role="status" data-testid="warning-mr-zone">The previously assigned zone is no longer available. Select an active zone before saving.</p>}
          {saveError && <p className="mr-form__notice mr-form__notice--error" role="alert" data-testid="error-mr-save">{saveError}</p>}

          <section className="mr-form__section" aria-labelledby="mr-identity-title">
            <div className="mr-form__section-head"><h3 id="mr-identity-title" className="mr-form__section-title">Identity & contact</h3><p className="mr-form__section-note">Fields marked * are required</p></div>
            <div className="mr-form__grid">
               {renderField('name', 'MR Name', { placeholder: 'MR Name', autoComplete: 'name' })}
               {renderField('phone', 'Phone No.', { placeholder: '10-digit number', autoComplete: 'tel', inputMode: 'tel' })}
              {renderField('userId', 'User ID', { placeholder: 'Login user ID' })}
               {renderField('email', 'Email ID', { type: 'email', placeholder: 'name@company.com', autoComplete: 'email' })}
              <div className="mr-form__field">
                <label className="mr-form__label" htmlFor="mr-password">Password</label>
                 <input id="mr-password" className="mr-form__control" type="text" value="Unavailable in preview" disabled aria-describedby="mr-password-hint" data-testid="input-mr-password" />
                 <p id="mr-password-hint" className="mr-form__hint">This preview does not create accounts. Passwords cannot be entered, stored or changed here.</p>
              </div>
            </div>
          </section>

          <section className="mr-form__section" aria-labelledby="mr-assignment-title">
            <div className="mr-form__section-head"><h3 id="mr-assignment-title" className="mr-form__section-title">Assignment & work</h3></div>
            <div className="mr-form__grid">
               {renderField('hq', 'HQ', { placeholder: 'Base location' })}
              {renderField('zoneId', 'Assigned zone', {
                placeholder: missingZone ? 'Choose a replacement zone' : 'Select a zone',
                hint: assignedZone?.status === 'inactive' ? 'This assigned zone is inactive. You can retain it or choose an active zone.' : undefined,
                selectOptions: zoneOptions.map((zone) => ({ value: String(zone.id), label: `${zone.name}${zone.status === 'inactive' ? ' (inactive)' : ''}` })),
              })}
              {renderField('employeeCode', 'Employee code', { placeholder: 'Employee code' })}
              {renderField('dateOfJoining', 'Date of joining', { type: 'date' })}
              {renderField('designation', 'Designation', { placeholder: 'Job designation' })}
              {renderField('reportingManagerId', 'Reporting manager', {
                placeholder: 'No reporting manager',
                selectOptions: otherMRs.map((record) => ({ value: String(record.id), label: `${record.name}${record.status === 'inactive' ? ' (inactive)' : ''}` })),
              })}
              {renderField('paymentLimit', 'Payment limit', { type: 'number', min: '0', step: '0.01', placeholder: 'Optional', inputMode: 'decimal' })}
              {renderField('doctorDaysLimit', 'Doctor days limit', { type: 'number', min: '0', step: '1', placeholder: 'Optional', inputMode: 'numeric' })}
              {renderField('status', 'Status', { selectOptions: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] })}
            </div>
          </section>

          <section className="mr-form__section" aria-labelledby="mr-address-title">
            <div className="mr-form__section-head"><h3 id="mr-address-title" className="mr-form__section-title">Address</h3></div>
            <div className="mr-form__grid">
              {renderField('addressLine1', 'Address line 1', { placeholder: 'Street address', span: true, autoComplete: 'address-line1' })}
              {renderField('addressLine2', 'Address line 2', { placeholder: 'Apartment, suite or area', span: true, autoComplete: 'address-line2' })}
              {renderField('landmark', 'Landmark', { placeholder: 'Nearby landmark' })}
              {renderField('pincode', 'Pincode', { placeholder: '6-digit pincode', inputMode: 'numeric', autoComplete: 'postal-code' })}
              {renderField('city', 'City', { placeholder: 'City', autoComplete: 'address-level2' })}
              {renderField('state', 'State', { placeholder: 'State', autoComplete: 'address-level1' })}
              {renderField('country', 'Country', { placeholder: 'Country', autoComplete: 'country-name' })}
            </div>
          </section>
        </div>
        <div className="mr-form__footer">
          <span className="mr-form__footer-note">Stored in this browser’s local preview.</span>
          <div className="mr-form__actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-mr">Cancel</button>
            <button type="submit" className="admin-button" disabled={saving} data-testid="button-save-mr">{saving ? 'Saving…' : mr ? 'Save changes' : 'Add MR'}</button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}