import { useEffect, useRef, useState } from 'react';
import InfoDisclosure from './InfoDisclosure.jsx';
import MRReferenceSelect from './MRReferenceSelect.jsx';
import MRFormCombobox from './MRFormCombobox.jsx';
import PhoneInput from './PhoneInput.jsx';
import { emptyMRValues, generateMRUsername, lookupPincode, MR_FIELDS as FIELDS, payloadFromValues, validateMRValues } from '../../services/serverMRs.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';

const OPTIONAL = new Set(['reportingManagerId', 'addressLine2', 'paymentLimit', 'doctorDaysLimit']);
const TABS = [
  { id: 'identity', label: 'Identity & contact', fields: ['name', 'phone', 'dialCountry', 'userId', 'email', 'contactRequirement', 'password', 'confirmPassword'] },
  { id: 'assignment', label: 'Assignment & work', fields: ['hq', 'zoneId', 'employeeCode', 'dateOfJoining', 'designation_id', 'reportingManagerId', 'paymentLimit', 'doctorDaysLimit', 'status'] },
  { id: 'address', label: 'Address', fields: ['pincode', 'addressLine1', 'addressLine2', 'landmark', 'city', 'state', 'country'] },
];
const ORDER = [...FIELDS, 'password', 'confirmPassword'];
const STATUS_CHOICES = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }];

export default function MRForm({ mr, onSave, onClose, onRefresh }) {
  const [values, setValues] = useState(() => emptyMRValues(mr));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [postal, setPostal] = useState({ status: '', choices: [] });
  const [usernamePending, setUsernamePending] = useState(false);
  const manual = useRef(new Set());
  const lookedUp = useRef(mr?.pincode || '');
  const lookupSeq = useRef(0);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const warnings = { deleted: [] };
  const [activeTab, setActiveTab] = useState('identity');
  const formRef = useRef(null);
  const tabRefs = useRef([]);
  const pendingFocus = useRef(null);
  useEffect(() => {
    if (pendingFocus.current) {
      formRef.current?.elements.namedItem(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [activeTab, errors]);

  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => { if (getSession().user?.id !== owner) { lookupSeq.current++; setPassword(''); setConfirmPassword(''); } });
  }, []);
  useEffect(() => () => { lookupSeq.current++; }, []);
  useEffect(() => {
    const pin = values.pincode.trim();
    if (!/^[1-9][0-9]{5}$/.test(pin) || pin === lookedUp.current) { if (!/^[1-9][0-9]{5}$/.test(pin)) { lookupSeq.current++; setPostal({ status: '', choices: [] }); } return undefined; }
    const current = ++lookupSeq.current;
    const controller = new AbortController();
    setPostal({ status: 'Looking up pincode…', choices: [] });
    const timer = setTimeout(() => {
      lookupPincode(pin, controller.signal, mr ? 'edit' : 'add').then((result) => {
        if (current !== lookupSeq.current) return;
        lookedUp.current = pin;
        const choices = Array.isArray(result?.choices) ? result.choices : [];
        if (choices.length === 1) { applyChoice(choices[0]); setPostal({ status: 'City, state and country filled from the pincode. You can still edit them.', choices: [] }); }
        else if (choices.length > 1) setPostal({ status: 'Several places share this pincode. Choose one or enter the address manually.', choices });
        else setPostal({ status: result?.message || 'No place found for this pincode. Enter city, state and country manually.', choices: [] });
      }).catch((cause) => {
        if (current === lookupSeq.current && !controller.signal.aborted) setPostal({ status: `Pincode lookup is unavailable (${cause.message || 'error'}). Enter city, state and country manually.`, choices: [] });
      });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [values.pincode]);

  function applyChoice(choice) {
    setValues((current) => {
      const next = { ...current };
      for (const key of ['city', 'state', 'country']) if (!manual.current.has(key) && choice[key]) next[key] = choice[key];
      return next;
    });
  }
  async function generateUsername() {
    setUsernamePending(true);
    try { const result = await generateMRUsername(); change('userId', result.userId); }
    catch (cause) { setErrors((c) => ({ ...c, userId: cause.message || 'Could not generate a User ID.' })); }
    finally { setUsernamePending(false); }
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

  function change(key, value) {
    if (['city', 'state', 'country'].includes(key)) manual.current.add(key);
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
    const { type = 'text', placeholder, autoComplete, span, info, inputMode, min, step, selectOptions, customControl } = options;
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
        {customControl ? customControl : selectOptions ? (
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
          <PhoneInput prefix="mr" country={values.dialCountry} onCountryChange={(value) => change('dialCountry', value)}
            countryError={errors.dialCountry} controlClassName="mr-form__control"
            inputProps={{ ...input.props, disabled: saving }} />
        ) : key === 'userId' ? (
          <div className="mr-form__input-row">
            {input}
            <button type="button" className="mr-form__preview-action" disabled={usernamePending || Boolean(mr)} onClick={generateUsername}
               data-testid="button-generate-mr-user-id">{usernamePending ? 'Generating…' : 'Auto-generate'}</button>
          </div>
        ) : input}
        {errors[key] && <p id={errorId} className="mr-form__error" role="alert" data-testid={`error-mr-${key}`}>{errors[key]}</p>}
        {key === 'phone' && errors.dialCountry && <p id="mr-dialCountry-error" className="mr-form__error" role="alert">{errors.dialCountry}</p>}
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (saving) return;
    const cleaned = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim()]));
    const nextErrors = validateMRValues(cleaned, { creating: !mr, password, confirm: confirmPassword });
    if (mr && warnings.deleted.length) nextErrors.zoneId = nextErrors.zoneId || '';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = ORDER.find((key) => nextErrors[key]);
      pendingFocus.current = first === 'password' ? 'password' : first;
      setActiveTab(TABS.find((tab) => tab.fields.includes(first)).id);
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      const result = await onSave(payloadFromValues(cleaned), password);
      if (!result?.success) setSaveError(result?.error || 'This MR could not be saved. Please try again.');
      else { setPassword(''); setConfirmPassword(''); }
    } catch (error) {
      setSaveError(error?.message || 'This MR could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
      <form className="mr-form" ref={formRef} onSubmit={handleSubmit} noValidate data-testid="form-mr">
        <div className="mr-form__about"><InfoDisclosure id="mr-form-about" title="this MR form"
          text="MR records are shared server records. Adding an MR also creates a login account with the User ID. Editing never changes the password."
          testId="button-mr-form-info"><strong>About this form</strong></InfoDisclosure></div>
        <div className="mr-form__tabs" role="tablist" aria-label="MR profile sections">
          {TABS.map((tab, index) => <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} type="button"
            id={`mr-tab-${tab.id}`} role="tab" aria-controls={`mr-panel-${tab.id}`} aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1} className={`mr-form__tab${activeTab === tab.id ? ' mr-form__tab--active' : ''}${tab.fields.some((key) => errors[key]) ? ' mr-form__tab--error' : ''}`}
            onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKey(event, index)}
            data-testid={`tab-mr-${tab.id}`}>{tab.label}{tab.fields.some((key) => errors[key]) && <span className="mr-form__tab-error" aria-label="Contains errors">!</span>}</button>)}
        </div>
        <div className="mr-form__body">
          {(mr?.assignmentWarnings || []).map((warning, index) => <p key={index} className="mr-form__notice" role="status" data-testid="warning-mr-assignment">{String(warning?.message || warning)}</p>)}
          {saveError && <div className="mr-form__notice mr-form__notice--error" role="alert" data-testid="error-mr-save"><p>{saveError}</p><p>If the outcome is uncertain, refresh to check the saved record before trying again. Refreshing discards changes on this page.</p><button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-mr-save">Refresh records</button></div>}

          <section className="mr-form__section" id="mr-panel-identity" role="tabpanel" aria-labelledby="mr-tab-identity" tabIndex={0} hidden={activeTab !== 'identity'}>
            <div className="mr-form__section-head"><h3 id="mr-identity-title" className="mr-form__section-title">Identity & contact</h3><p className="mr-form__section-note">Fields marked * are required</p></div>
            <div className="mr-form__grid">
               {renderField('contactRequirement', 'Phone and email', { selectOptions: [{ value: 'required', label: 'Both required' }, { value: 'optional', label: 'Both optional' }] })}
               {renderField('name', 'MR Name', { placeholder: 'MR Name', autoComplete: 'name' })}
                {renderField('phone', 'Phone No.', { placeholder: 'National phone number', autoComplete: 'tel', inputMode: 'tel', info: 'Select the phone country and enter its national number. The country selection is saved with this MR.' })}
               {renderField('userId', 'User ID', { placeholder: 'User ID', info: mr ? 'User ID is the MR login name. Changing it signs that MR out of existing sessions.' : 'This is the MR login name: lowercase letters, digits, dot, underscore or hyphen. Auto-generate suggests an available one.' })}
               {renderField('email', 'Email ID', { type: 'email', placeholder: 'name@company.com', autoComplete: 'email' })}
              {!mr ? <>
              <div className="mr-form__field">
                <InfoDisclosure id="mr-password-help" title="Password"
                  text="Optional. Enter a password of 12 to 128 characters, or leave both blank and the server generates one, shown once after saving."
                  testId="button-mr-password-info"><label className="mr-form__label" htmlFor="mr-password">Initial password</label></InfoDisclosure>
                <input id="mr-password" name="password" className="mr-form__control" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors((c) => ({ ...c, password: undefined })); }} placeholder="Leave blank to generate" autoComplete="new-password" aria-invalid={Boolean(errors.password)} data-testid="input-mr-password" />
                {errors.password && <p className="mr-form__error" role="alert" data-testid="error-mr-password">{errors.password}</p>}
              </div>
              <div className="mr-form__field">
                <label className="mr-form__label" htmlFor="mr-confirm-password">Confirm password</label>
                <input id="mr-confirm-password" name="confirmPassword" className="mr-form__control" type="password" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setErrors((c) => ({ ...c, confirmPassword: undefined })); }} placeholder="Repeat password" autoComplete="new-password" aria-invalid={Boolean(errors.confirmPassword)} data-testid="input-mr-confirm-password" />
                {errors.confirmPassword && <p className="mr-form__error" role="alert" data-testid="error-mr-confirmPassword">{errors.confirmPassword}</p>}
              </div></> : <div className="mr-form__field mr-form__field--wide"><p className="mr-form__section-note" data-testid="text-mr-password-note">Passwords are not shown or edited here. Use Reset password in MR Master to issue a new one-time password.</p></div>}
            </div>
          </section>

          <section className="mr-form__section" id="mr-panel-assignment" role="tabpanel" aria-labelledby="mr-tab-assignment" tabIndex={0} hidden={activeTab !== 'assignment'}>
            <div className="mr-form__section-head"><h3 id="mr-assignment-title" className="mr-form__section-title">Assignment & work</h3></div>
            <div className="mr-form__grid">
               {renderField('hq', 'HQ', { customControl: <MRReferenceSelect id="mr-hq" kind="headquarters" label="HQ" value={values.hq} savedName={mr?.hqName} onChange={(v) => change('hq', v)} placeholder="Select a headquarter" invalid={Boolean(errors.hq)} describedBy={errors.hq ? 'mr-hq-error' : undefined} required emptyGuidance="No headquarters exist yet. Add one in Headquarter Master first." /> })}
              {renderField('zoneId', 'Assigned zone', { info: 'Only active zones can be newly assigned. A saved inactive zone can be kept with a warning; a deleted one must be replaced.', customControl: <MRReferenceSelect id="mr-zoneId" kind="zones" label="Assigned zone" value={values.zoneId} savedName={mr?.zoneName} onChange={(v) => change('zoneId', v)} placeholder="Select a zone" invalid={Boolean(errors.zoneId)} describedBy={errors.zoneId ? 'mr-zoneId-error' : undefined} required emptyGuidance="No zones exist yet. Add one in Zone Master first." /> })}
              {renderField('employeeCode', 'Employee code', { placeholder: 'Employee code' })}
              {renderField('dateOfJoining', 'Date of joining', { type: 'date' })}
              {renderField('designation_id', 'Designation', { info: 'Select an active catalogue designation. A saved inactive assignment can be retained; a deleted assignment must be replaced. Designations grant no permissions.', customControl: <MRReferenceSelect id="mr-designation_id" kind="designations" label="Designation" value={values.designation_id} savedName={mr?.designationName} onChange={(v) => change('designation_id', v)} placeholder="Select a designation" invalid={Boolean(errors.designation_id)} describedBy={errors.designation_id ? 'mr-designation_id-error' : undefined} required emptyGuidance="No designations exist yet. Add one in Designation Master first." /> })}
              {renderField('reportingManagerId', 'Reporting manager', { customControl: <MRReferenceSelect id="mr-reportingManagerId" kind="managers" label="Reporting manager" value={values.reportingManagerId} savedName={mr?.reportingManagerName} excludeId={mr?.id} onChange={(v) => change('reportingManagerId', v)} placeholder="No reporting manager" invalid={Boolean(errors.reportingManagerId)} describedBy={errors.reportingManagerId ? 'mr-reportingManagerId-error' : undefined} emptyGuidance="No other MRs exist yet." /> })}
              {renderField('paymentLimit', 'Payment limit', { type: 'number', min: '0', step: '0.01', placeholder: 'Defaults to 0.00', inputMode: 'decimal' })}
              {renderField('doctorDaysLimit', 'Doctor days limit', { type: 'number', min: '0', step: '1', placeholder: 'Defaults to 0', inputMode: 'numeric' })}
              {renderField('status', 'Status', { customControl: <MRFormCombobox id="mr-status" label="Status"
                value={values.status} selectedLabel={values.status === 'active' ? 'Active' : values.status === 'inactive' ? 'Inactive' : ''}
                choices={STATUS_CHOICES} onChange={(v) => change('status', v)} placeholder="Select status" required
                invalid={Boolean(errors.status)} describedBy={errors.status ? 'mr-status-error' : undefined} /> })}
            </div>
          </section>

          <section className="mr-form__section" id="mr-panel-address" role="tabpanel" aria-labelledby="mr-tab-address" tabIndex={0} hidden={activeTab !== 'address'}>
            <div className="mr-form__section-head"><h3 id="mr-address-title" className="mr-form__section-title">Address</h3></div>
            <div className="mr-form__grid">
                {renderField('pincode', 'Pincode', { placeholder: '6-digit pincode', inputMode: 'numeric', autoComplete: 'postal-code', info: 'A complete pincode fills City, State and Country automatically. Anything you type yourself is kept.' })}
              {(postal.status || postal.choices.length > 0) && <div className="mr-form__field mr-form__field--wide" role="status" data-testid="status-mr-postal"><p className="mr-form__section-note">{postal.status}</p>{postal.choices.length > 0 && <div className="mr-form__postal-choices">{postal.choices.map((choice, index) => <button type="button" key={index} className="admin-button admin-button--secondary" onClick={() => { applyChoice(choice); setPostal({ status: 'Place applied. You can still edit it.', choices: [] }); }} data-testid={`button-postal-choice-${index}`}>{[choice.city, choice.state, choice.country].filter(Boolean).join(', ')}</button>)}</div>}</div>}
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
            <button type="submit" className="admin-button" disabled={saving} data-testid="button-save-mr">{saving ? 'Saving…' : mr ? 'Save changes' : 'Add MR and create login'}</button>
          </div>
        </div>
      </form>
  );
}