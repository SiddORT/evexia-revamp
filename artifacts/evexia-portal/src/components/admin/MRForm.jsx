import { useEffect, useRef, useState } from 'react';
import InfoDisclosure from './InfoDisclosure.jsx';
import '../../mr.css';

const FIELDS = [
  'name', 'phone', 'userId', 'email', 'hq', 'zoneId', 'employeeCode',
  'dateOfJoining', 'designation', 'reportingManagerId', 'paymentLimit',
  'doctorDaysLimit', 'status', 'pincode', 'addressLine1', 'addressLine2',
  'landmark', 'city', 'state', 'country', 'contactRequirement',
];
const OPTIONAL = new Set(['reportingManagerId', 'addressLine2', 'paymentLimit', 'doctorDaysLimit']);
const TABS = [
  { id: 'identity', label: 'Identity & contact', fields: ['name', 'phone', 'userId', 'email', 'contactRequirement'] },
  { id: 'assignment', label: 'Assignment & work', fields: ['hq', 'zoneId', 'employeeCode', 'dateOfJoining', 'designation', 'reportingManagerId', 'paymentLimit', 'doctorDaysLimit', 'status'] },
  { id: 'address', label: 'Address', fields: ['pincode', 'addressLine1', 'addressLine2', 'landmark', 'city', 'state', 'country'] },
];

function initialValues(mr) {
  return Object.fromEntries(FIELDS.map((key) => [
    key,
    key === 'contactRequirement' ? (mr?.contactRequirement || 'required')
      : key === 'status' ? (mr?.status || 'active')
      : key === 'country' ? (mr?.country ?? 'India')
      : key === 'dateOfJoining' ? String(mr?.[key] ?? '').slice(0, 10)
        : String(mr?.[key] ?? ''),
  ]));
}

function validate(values) {
  const errors = {};
  FIELDS.forEach((key) => {
    if (['phone', 'email'].includes(key) && values.contactRequirement === 'optional') return;
    if (!OPTIONAL.has(key) && !values[key].trim()) errors[key] = 'This field is required.';
  });
  if (!['required', 'optional'].includes(values.contactRequirement)) errors.contactRequirement = 'Choose a contact requirement.';
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

export default function MRForm({ mr, records = [], zones = [], onSave, onClose, onRefresh }) {
  const [values, setValues] = useState(() => initialValues(mr));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('identity');
  const [dialCode, setDialCode] = useState('IN');
  const formRef = useRef(null);
  const tabRefs = useRef([]);
  const pendingFocus = useRef(null);
  const assignedZone = zones.find((zone) => String(zone.id) === values.zoneId);
  const activeZones = zones.filter((zone) => zone.status === 'active');
  const zoneOptions = assignedZone?.status === 'inactive'
    ? [...activeZones, assignedZone]
    : activeZones;
  const missingZone = Boolean(values.zoneId) && !assignedZone;
  const otherMRs = records.filter((record) => String(record.id) !== String(mr?.id));

  useEffect(() => {
    if (pendingFocus.current) {
      formRef.current?.elements.namedItem(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [activeTab, errors]);

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

  function renderField(key, label, options = {}) {
    const { type = 'text', placeholder, autoComplete, span, info, inputMode, min, step, selectOptions } = options;
    const errorId = `mr-${key}-error`;
    const hintId = `mr-${key}-help`;
    const id = `mr-${key}`;
    const required = !OPTIONAL.has(key) && (!['phone', 'email'].includes(key) || values.contactRequirement === 'required');
    const input = (
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
        aria-required={required}
        aria-invalid={Boolean(errors[key])}
         aria-describedby={errors[key] ? errorId : undefined}
        data-testid={`input-mr-${key}`}
      />
    );
    return (
      <div className={`mr-form__field${span ? ' mr-form__field--wide' : ''}`} key={key}>
         {info ? <InfoDisclosure id={hintId} title={label} text={info} testId={`button-mr-${key}-info`}>
            <label className="mr-form__label" htmlFor={id}>{label} {required && <span className="mr-form__required" aria-hidden="true">*</span>}</label>
          </InfoDisclosure> : <label className="mr-form__label" htmlFor={id}>{label} {required && <span className="mr-form__required" aria-hidden="true">*</span>}</label>}
        {selectOptions ? (
          <select
            id={id}
            name={key}
            className="mr-form__control"
            value={values[key]}
            onChange={(event) => change(key, event.target.value)}
             aria-required={required}
            aria-invalid={Boolean(errors[key])}
             aria-describedby={errors[key] ? errorId : undefined}
            data-testid={`select-mr-${key}`}
          >
            <option value="">{placeholder || 'Select an option'}</option>
            {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : key === 'phone' ? (
          <div className="mr-form__input-row">
            <select id="mr-dial-code" className="mr-form__control mr-form__dial-code"
               aria-label="Dial code (preview only)"
              value={dialCode} onChange={(event) => setDialCode(event.target.value)}
              data-testid="select-mr-dial-code">
              <option value="IN">🇮🇳 +91</option>
              <option value="US">🇺🇸 +1</option>
              <option value="GB">🇬🇧 +44</option>
              <option value="AE">🇦🇪 +971</option>
            </select>
            {input}
          </div>
        ) : key === 'userId' ? (
          <div className="mr-form__input-row">
            {input}
            <button type="button" className="mr-form__preview-action" disabled
               data-testid="button-generate-mr-user-id">Auto-generate</button>
          </div>
        ) : input}
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
    for (const [key, label] of [['employeeCode', 'Employee code'], ['userId', 'User ID'], ['email', 'Email ID']]) {
      if (cleaned[key] && otherMRs.some((record) => record[key].toLocaleLowerCase() === cleaned[key].toLocaleLowerCase())) {
        nextErrors[key] = `${label} already belongs to another MR.`;
      }
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
      <form className="mr-form" ref={formRef} onSubmit={handleSubmit} noValidate data-testid="form-mr">
        <div className="mr-form__about"><InfoDisclosure id="mr-form-about" title="this MR form"
          text="MR records are stored only in this browser’s local preview. Adding or editing an MR does not create a login account."
          testId="button-mr-form-info"><strong>About this form</strong></InfoDisclosure></div>
        <div className="mr-form__tabs" role="tablist" aria-label="MR profile sections">
          {TABS.map((tab, index) => <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} type="button"
            id={`mr-tab-${tab.id}`} role="tab" aria-controls={`mr-panel-${tab.id}`} aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1} className={`mr-form__tab${activeTab === tab.id ? ' mr-form__tab--active' : ''}${tab.fields.some((key) => errors[key]) ? ' mr-form__tab--error' : ''}`}
            onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKey(event, index)}
            data-testid={`tab-mr-${tab.id}`}>{tab.label}{tab.fields.some((key) => errors[key]) && <span className="mr-form__tab-error" aria-label="Contains errors">!</span>}</button>)}
        </div>
        <div className="mr-form__body">
          {missingZone && <p className="mr-form__notice" role="status" data-testid="warning-mr-zone">The previously assigned zone is no longer available. Select an active zone before saving.</p>}
          {saveError && <div className="mr-form__notice mr-form__notice--error" role="alert" data-testid="error-mr-save"><p>{saveError}</p><p>To review the latest records before trying again, refresh below. Refreshing discards changes on this page.</p><button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-mr-save">Refresh records</button></div>}

          <section className="mr-form__section" id="mr-panel-identity" role="tabpanel" aria-labelledby="mr-tab-identity" tabIndex={0} hidden={activeTab !== 'identity'}>
            <div className="mr-form__section-head"><h3 id="mr-identity-title" className="mr-form__section-title">Identity & contact</h3><p className="mr-form__section-note">Fields marked * are required</p></div>
            <div className="mr-form__grid">
               {renderField('contactRequirement', 'Phone and email', { selectOptions: [{ value: 'required', label: 'Both required' }, { value: 'optional', label: 'Both optional' }] })}
               {renderField('name', 'MR Name', { placeholder: 'MR Name', autoComplete: 'name' })}
                {renderField('phone', 'Phone No.', { placeholder: '10-digit number', autoComplete: 'tel', inputMode: 'tel', info: 'Preview-only dial code; it does not change phone validation or the saved number.' })}
               {renderField('userId', 'User ID', { placeholder: 'User ID', info: 'Enter a User ID manually. Auto-generate is preview-only; saving does not create a login.' })}
               {renderField('email', 'Email ID', { type: 'email', placeholder: 'name@company.com', autoComplete: 'email' })}
              <div className="mr-form__field">
                 <InfoDisclosure id="mr-password-help" title="Password"
                   text="Preview only: passwords cannot be entered, generated, saved or exported. No account is created."
                   testId="button-mr-password-info"><label className="mr-form__label" htmlFor="mr-password">Password</label></InfoDisclosure>
                  <div className="mr-form__input-row">
                     <input id="mr-password" className="mr-form__control" type="password" placeholder="Unavailable" disabled autoComplete="off" data-testid="input-mr-password" />
                    <button type="button" className="mr-form__preview-action" disabled
                       data-testid="button-generate-mr-password">Generate password</button>
                  </div>
              </div>
               <div className="mr-form__field">
                 <label className="mr-form__label" htmlFor="mr-confirm-password">Confirm password</label>
                  <input id="mr-confirm-password" className="mr-form__control" type="password" placeholder="Unavailable" disabled autoComplete="off" data-testid="input-mr-confirm-password" />
               </div>
            </div>
          </section>

          <section className="mr-form__section" id="mr-panel-assignment" role="tabpanel" aria-labelledby="mr-tab-assignment" tabIndex={0} hidden={activeTab !== 'assignment'}>
            <div className="mr-form__section-head"><h3 id="mr-assignment-title" className="mr-form__section-title">Assignment & work</h3></div>
            <div className="mr-form__grid">
               {renderField('hq', 'HQ', { placeholder: 'Base location' })}
              {renderField('zoneId', 'Assigned zone', {
                placeholder: missingZone ? 'Choose a replacement zone' : 'Select a zone',
                 info: assignedZone?.status === 'inactive'
                   ? 'This assigned zone is inactive. You can retain it or choose an active zone.'
                   : 'Only active zones can be newly assigned. If a previously assigned zone becomes inactive, you can retain it or choose an active zone.',
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

          <section className="mr-form__section" id="mr-panel-address" role="tabpanel" aria-labelledby="mr-tab-address" tabIndex={0} hidden={activeTab !== 'address'}>
            <div className="mr-form__section-head"><h3 id="mr-address-title" className="mr-form__section-title">Address</h3></div>
            <div className="mr-form__grid">
                {renderField('pincode', 'Pincode', { placeholder: '6-digit pincode', inputMode: 'numeric', autoComplete: 'postal-code', info: 'Preview only: pincode will not auto-fill City, State or Country. Enter those fields manually.' })}
              {renderField('addressLine1', 'Address line 1', { placeholder: 'Street address', span: true, autoComplete: 'address-line1' })}
              {renderField('addressLine2', 'Address line 2', { placeholder: 'Apartment, suite or area', span: true, autoComplete: 'address-line2' })}
              {renderField('landmark', 'Landmark', { placeholder: 'Nearby landmark' })}
              {renderField('city', 'City', { placeholder: 'City', autoComplete: 'address-level2' })}
              {renderField('state', 'State', { placeholder: 'State', autoComplete: 'address-level1' })}
              {renderField('country', 'Country', { placeholder: 'Country', autoComplete: 'country-name' })}
            </div>
          </section>
        </div>
        <div className="mr-form__footer">
          <div className="mr-form__actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-mr">Cancel</button>
            <button type="submit" className="admin-button" disabled={saving} data-testid="button-save-mr">{saving ? 'Saving…' : mr ? 'Save changes' : 'Add MR'}</button>
          </div>
        </div>
      </form>
  );
}