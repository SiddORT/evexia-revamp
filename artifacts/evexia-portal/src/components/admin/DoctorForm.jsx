import { useEffect, useRef, useState } from 'react';
import DoctorMRSelect from './DoctorMRSelect.jsx';
import MRReferenceSelect from './MRReferenceSelect.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import InfoDisclosure from './InfoDisclosure.jsx';
import Dialog from './Dialog.jsx';
import { AreaDialog, MappingReferenceSelect, ReasonField, TransferEffects, person, reasonError } from './doctorMapping/MappingParts.jsx';
import PhoneInput from './PhoneInput.jsx';
import useAddressSelection from './useAddressSelection.js';
import { GeographyControl, GeographyLabel, PostalSelection, useAddressCatalogue } from './AddressGeography.jsx';
import { dialCountry, normalizePhone } from '../../services/phoneCountries.js';
import { doctorTerritoryChoices, lookupDoctorPIN, setDoctorArea } from '../../services/serverDoctors.js';
import { discountRate, roundRate } from '../../services/rates.js';
import { masterNameError, masterLengthErrors, normalizeMasterName, presentMasterFailure } from '../../services/masterValidation.js';
import '../../doctor-form.css';
import './territory.css';
import '../../doctor-mr-mapping.css';

const FIELDS = [
  'name', 'phone', 'dialCountry', 'alternatePhone', 'email', 'dateOfJoining',
  'registrationNumber', 'qualification', 'clinicName', 'zoneId', 'hqId', 'areaId', 'mrId', 'invoiceType',
  'gstNumber', 'drugLicenceNumber', 'orderDiscount', 'daysLimit', 'paymentLimit',
  'status', 'addressLine1', 'addressLine2', 'landmark', 'pincode', 'country', 'state', 'city', 'contactRequirement',
];
const ERROR_FIELDS = FIELDS.filter((key) => key !== 'contactRequirement');
const REQUIRED = new Set([
  'name', 'registrationNumber', 'qualification', 'mrId', 'invoiceType',
  'status', 'addressLine1', 'landmark', 'pincode', 'city', 'state', 'country',
]);
const TABS = [
  { id: 'identity', label: 'Identity & contact', fields: ['name', 'phone', 'dialCountry', 'alternatePhone', 'email', 'dateOfJoining', 'registrationNumber', 'qualification'] },
  { id: 'clinic', label: 'Clinic & assignment', fields: ['clinicName', 'zoneId', 'hqId', 'areaId', 'mrId', 'status'] },
  { id: 'commercial', label: 'Commercial details', fields: ['invoiceType', 'gstNumber', 'drugLicenceNumber', 'orderDiscount', 'daysLimit', 'paymentLimit'] },
  { id: 'address', label: 'Address', fields: ['pincode', 'addressLine1', 'addressLine2', 'landmark', 'country', 'state', 'city'] },
];
const FIELD_INFO = {
  orderDiscount: 'Original percentage must be 0 to 100. Up to six source decimal places are rounded half-up to two when saved (1.005 → 1.01).',
  phone: 'Select the phone country and enter its national number. The selection is saved and also applies to the alternate phone.',
  daysLimit: 'Doctor Master setting only; not enforced for MR placement. MR orders use the owning MR’s Doctor Days Limit, measured from each saved order date while a positive balance remains.',
  paymentLimit: 'Doctor Master setting only; not an additional MR credit limit or fallback. MR placement uses the owning MR’s Payment Limit across all four real order types.',
  gstNumber: 'GST Number is required for GST invoices. For Indian addresses, enter a 15-character GSTIN.',
  pincode: 'A six-digit Indian PIN fills country, state and city when exactly one place matches. Multiple places require selection. District is used as city when no city is returned. Other countries use the geography catalogue.',
};
const PASSWORD_INFO = 'Passwords cannot be entered, generated, saved or exported. No doctor login is created.';

function initialValues(doctor) {
  return Object.fromEntries(FIELDS.map((key) => [
    key,
    key === 'contactRequirement' ? (doctor?.contactRequirement || 'optional')
      : key === 'country' ? (doctor?.country ?? 'India')
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
  const errors = masterLengthErrors(values, {
    phone: 20, alternatePhone: 20, email: 320, registrationNumber: 100,
    qualification: 200, clinicName: 200, gstNumber: 20, drugLicenceNumber: 100,
    pincode: 12, addressLine1: 300, addressLine2: 300, landmark: 200,
    country: 100, state: 100, city: 100,
  });
  const nameError = masterNameError(values.name, 'doctor name', { personal: true });
  if (nameError) errors.name = nameError;
  for (const key of REQUIRED) if (!values[key]?.trim()) errors[key] = 'This field is required.';
  if (!values.phone.trim() && !values.email.trim()) {
    errors.phone = errors.email = 'Enter either a phone number or an email address.';
  }
  const dial = dialCountry(values.dialCountry);
  if (!dial) errors.dialCountry = 'Choose a supported country code.';
  if (values.phone && dial && normalizePhone(values.phone, values.dialCountry) === null) {
    errors.phone = `Enter a valid phone number for ${dial.name}.`;
  }
  if (values.alternatePhone && dial && normalizePhone(values.alternatePhone, values.dialCountry) === null) {
    errors.alternatePhone = `Enter a valid alternate phone number for ${dial.name}.`;
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = 'Enter a valid email address.';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (values.dateOfJoining && (!validDate(values.dateOfJoining) || values.dateOfJoining > today)) {
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
  } else if (values.gstNumber && values.country.toLocaleLowerCase() !== 'india' && !/^[A-Za-z0-9 -]{5,20}$/.test(values.gstNumber)) {
    errors.gstNumber = 'Enter a GST number with 5–20 letters, digits, spaces or hyphens.';
  }
  if (values.orderDiscount) {
    try { discountRate(values.orderDiscount); }
    catch { errors.orderDiscount = 'Enter a discount from 0 to 100 with up to 6 source decimal places; rounded half-up to two on save.'; }
  }
  if (values.daysLimit && (!/^\d+$/.test(values.daysLimit) || Number(values.daysLimit) > 2147483647)) {
    errors.daysLimit = 'Enter a whole number from 0 to 2147483647.';
  }
  if (values.paymentLimit && (!/^\d{1,13}(\.\d{1,2})?$/.test(values.paymentLimit))) {
    errors.paymentLimit = 'Enter a non-negative amount with up to 13 integer digits and 2 decimal places.';
  }
  if (values.status && !['active', 'inactive'].includes(values.status)) errors.status = 'Choose a valid status.';
  return errors;
}

const LOCATION = ['zoneId', 'hqId', 'areaId'];
const territoryDisabled = (item, saved) => item.deleted || (item.status !== 'active' && item.id !== saved);

export default function DoctorForm({ doctor, records = [], mrs = [], fixedMR = null, onDraftChange, blocked = false, onSave, onClose, onRefresh }) {
  const [values, setValues] = useState(() => ({ ...initialValues(doctor), ...(fixedMR ? { mrId: String(fixedMR.id) } : {}) }));
  const [hydratedMRs, setHydratedMRs] = useState([]);
  const confirm = usePlatformConfirm();
  const savedLocation = LOCATION.map((key) => String(doctor?.[key] ?? ''));
  const locationChanged = LOCATION.some((key, index) => values[key] !== savedLocation[index]);
  const legacyLocation = Boolean(doctor) && savedLocation.some((value) => !value);
  const locationRequired = !doctor || locationChanged || (!fixedMR && values.mrId !== String(doctor?.mrId ?? ''));
  const locationComplete = LOCATION.every((key) => values[key]);
  async function changeLevel(key, next) {
    if (next === values[key]) return;
    const descendants = LOCATION.slice(LOCATION.indexOf(key) + 1).filter((child) => values[child]);
    const owner = !fixedMR && values.mrId;
    if (descendants.length || owner) {
      const parts = [...descendants.map((child) => child === 'hqId' ? 'HQ' : 'Area'), ...(owner ? ['assigned MR'] : [])];
      const ok = await confirm(`Changing the ${key === 'zoneId' ? 'Zone' : key === 'hqId' ? 'HQ' : 'Area'} clears the selected ${parts.join(', ')} because ${parts.length === 1 ? 'it' : 'they'} may no longer match this location. Cancel keeps every current selection.`, { actionLabel: 'Change and clear' });
      if (!ok) return;
    }
    const patch = { [key]: next };
    for (const child of LOCATION.slice(LOCATION.indexOf(key) + 1)) patch[child] = '';
    if (!fixedMR) patch.mrId = '';
    patchAddress(patch);
  }
  const zoneReq = (_, params, signal) => doctorTerritoryChoices('zones', params, signal);
  const hqReq = (_, params, signal) => doctorTerritoryChoices('headquarters', { ...params, zoneId: values.zoneId }, signal);
  const areaReq = (_, params, signal) => doctorTerritoryChoices('areas', { ...params, zoneId: values.zoneId, hqIds: [values.hqId] }, signal);
  function renderLevel(key, label, kind, request, parentReady, savedName, hint) {
    return <div className="doctor-form__field" key={key}>
      <label className="doctor-form__label" htmlFor={`doctor-${key}`}>{label} {locationRequired && <span className="doctor-form__required" aria-hidden="true">*</span>}</label>
      <MRReferenceSelect key={`${key}-${values.zoneId}-${key === 'areaId' ? values.hqId : ''}`} id={`doctor-${key}`} name={key} kind={kind} label={label} value={values[key]}
        savedName={values[key] === String(doctor?.[key] ?? '') ? savedName : undefined} onChange={(next) => changeLevel(key, next)}
        requestChoices={request} placeholder={parentReady ? `Select ${label}` : hint} required disabled={!parentReady || saving || blocked}
        isDisabled={territoryDisabled} invalid={Boolean(errors[key])} describedBy={errors[key] ? `doctor-${key}-error` : undefined}
        emptyGuidance={`No ${label} choices are available here.`} testId={`select-doctor-${key}`} />
      {errors[key] && <p id={`doctor-${key}-error`} className="doctor-form__error" role="alert">{errors[key]}</p>}
    </div>;
  }
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [areaReason, setAreaReason] = useState('');
  const [savedArea, setSavedArea] = useState(() => ({ zoneId: doctor?.zoneId || null, hqId: doctor?.hqId || null, areaId: doctor?.areaId || null, areaName: doctor?.areaName || '', areaHeadquarterName: doctor?.areaHeadquarterName || '', areaVersion: doctor?.areaVersion ?? 0 }));
  const [areaDialog, setAreaDialog] = useState(false);
  const [areaDraft, setAreaDraft] = useState({ areaId: '', reason: '' });
  const [areaPending, setAreaPending] = useState(false);
  const [areaError, setAreaError] = useState('');
  const [areaFeedback, setAreaFeedback] = useState('');
  const [mrReview, setMrReview] = useState(null);
  const [reconcileBlocked, setReconcileBlocked] = useState(false);
  useEffect(() => {
    onDraftChange?.({ dirty: JSON.stringify(values) !== JSON.stringify({ ...initialValues(doctor), ...(fixedMR ? { mrId: String(fixedMR.id) } : {}) }), busy: saving });
  }, [values, saving, doctor, fixedMR, onDraftChange]);
  const [activeTab, setActiveTab] = useState('identity');
  const formRef = useRef(null);
  const tabRefs = useRef([]);
  const pendingFocus = useRef(null);
  const selectedMR = [...hydratedMRs, ...mrs].find((mr) => String(mr.id) === values.mrId);
  const activeMRs = mrs.filter((mr) => mr.usable);
  const mrOptions = selectedMR && !activeMRs.includes(selectedMR) ? [...activeMRs, selectedMR] : activeMRs;
  const missingMR = Boolean(values.mrId) && (!selectedMR || selectedMR.deleted || !selectedMR.zoneId);
  const address = useAddressSelection({ values, onChange: patchAddress, lookupPIN: lookupDoctorPIN, editing: Boolean(doctor), disabled: blocked || saving });
  const catalogue = useAddressCatalogue(address);
  function patchAddress(patch) {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, undefined])) };
      if ('phone' in patch || 'email' in patch) {
        for (const key of ['phone', 'email']) {
          if (next[key] === 'Enter either a phone number or an email address.') delete next[key];
        }
      }
      return next;
    });
    setSaveError('');
  }

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
    address.change(key, value);
  }

  function renderField(key, label, options = {}) {
    const { type = 'text', placeholder, autoComplete, span, inputMode, min, step, selectOptions } = options;
    const errorId = `doctor-${key}-error`;
    const id = `doctor-${key}`;
    const required = REQUIRED.has(key) || (key === 'gstNumber' && values.invoiceType === 'gst');
    const describedBy = [errors[key] && errorId, key === 'pincode' && address.postal.message && 'doctor-pin-feedback'].filter(Boolean).join(' ') || undefined;
    const common = {
      id, name: key, className: 'doctor-form__control', value: values[key],
      onChange: (event) => change(key, event.target.value), autoComplete: autoComplete || 'off',
      onBlur: () => {
        if (key === 'orderDiscount' && values[key]) {
          try { change(key, discountRate(values[key])); } catch { /* Keep invalid drafts editable. */ }
        } else if (key === 'paymentLimit' && /^\d{1,13}(?:\.\d{1,2})?$/.test(values[key])) change(key, roundRate(values[key]));
      },
      'aria-required': required, 'aria-invalid': Boolean(errors[key]),
      'aria-describedby': describedBy, 'data-testid': `input-doctor-${key}`,
    };
    let input = <input {...common} type={type} placeholder={placeholder} inputMode={inputMode} min={min} step={step} />;
    if (['country', 'state', 'city'].includes(key)) {
      input = <GeographyControl address={address} catalogue={catalogue} field={key} id={id} label={label}
        required={required} invalid={Boolean(errors[key])} describedBy={describedBy} />;
    } else if (selectOptions) {
      input = <select {...common} data-testid={`select-doctor-${key}`}>
        <option value="">{placeholder || 'Select an option'}</option>
        {selectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>;
    } else if (key === 'phone') {
      input = <PhoneInput prefix="doctor" country={values.dialCountry} onCountryChange={(value) => change('dialCountry', value)}
        countryError={errors.dialCountry} controlClassName="doctor-form__control"
         inputProps={{ ...common, placeholder, disabled: saving || blocked }} />;
    } else if (key === 'alternatePhone') {
      input = <div className="doctor-form__input-row">
        <input {...common} type="tel" placeholder={placeholder} inputMode="tel" autoComplete="tel" />
      </div>;
    }
    return <div className={`doctor-form__field${span ? ' doctor-form__field--wide' : ''}${key === 'pincode' ? ' doctor-form__field--pincode' : ''}`} key={key}>
       {['country', 'state', 'city'].includes(key) ? <GeographyLabel field={key} id={id} label={label} required={required} className="doctor-form__label" /> : FIELD_INFO[key] ? <InfoDisclosure id={`doctor-${key}-help`} title={label} text={FIELD_INFO[key]} testId={`button-doctor-${key}-info`}>
         <label className="doctor-form__label" htmlFor={id}>{label} {required && <span className="doctor-form__required" aria-hidden="true">*</span>}</label>
       </InfoDisclosure> : <label className="doctor-form__label" htmlFor={id}>{label} {required && <span className="doctor-form__required" aria-hidden="true">*</span>}</label>}
      {input}
      {key === 'phone' && errors.dialCountry && <p id="doctor-dialCountry-error" className="doctor-form__error" role="alert">{errors.dialCountry}</p>}
      {errors[key] && <p id={errorId} className="doctor-form__error" role="alert" data-testid={`error-doctor-${key}`}>{errors[key]}</p>}
    </div>;
  }

  async function saveArea() {
    if (areaPending || reconcileBlocked) return;
    setAreaPending(true); setAreaError('');
    try {
      const result = await setDoctorArea({ id: doctor.id, areaVersion: savedArea.areaVersion }, areaDraft.areaId || null, areaDraft.reason.trim());
      setSavedArea({ zoneId: result.zoneId || null, hqId: result.hqId || null, areaId: result?.areaId ?? null, areaName: result?.areaName || '', areaHeadquarterName: result?.areaHeadquarterName || '', areaVersion: result?.areaVersion ?? savedArea.areaVersion + 1 });
      setValues((old) => ({ ...old, areaId: result.areaId || '', hqId: result.hqId || '', zoneId: result.zoneId || '' }));
      setAreaReason('');
      setAreaDialog(false); setAreaDraft({ areaId: '', reason: '' }); setAreaFeedback('Doctor Area saved. Postal address and MR are unchanged.');
    } catch (cause) {
      if (cause?.ambiguous || !cause?.status || cause?.status === 409) { setReconcileBlocked(true); setAreaDialog(false); }
      setAreaError(cause?.message || 'Doctor Area could not be saved. Your draft is kept.');
    } finally { setAreaPending(false); }
  }

  async function handleSubmit(event, assignmentReason) {
    event?.preventDefault();
    if (saving || blocked || reconcileBlocked) return;
    const cleaned = Object.fromEntries(FIELDS.map((key) => [key, values[key].trim()]));
    cleaned.name = normalizeMasterName(values.name);
    const nextErrors = validate(cleaned);
    if (doctor && LOCATION.some((key) => cleaned[key] !== (savedArea[key] || '')) && reasonError(areaReason)) nextErrors.areaId = reasonError(areaReason);
    if (address.postal.required) nextErrors.pincode = 'Choose a PIN location or confirm catalogue selection.';
    if (locationRequired) for (const key of LOCATION) if (!cleaned[key]) nextErrors[key] = 'Choose the complete Zone, HQ and Area for this assignment.';
    if (cleaned.mrId && (!selectedMR || selectedMR.deleted || !selectedMR.zoneId || (!selectedMR.usable && cleaned.mrId !== doctor?.mrId))) nextErrors.mrId = 'Select an active server MR with a usable Zone.';
    const normalizedReg = cleaned.registrationNumber.toLocaleLowerCase();
    if (normalizedReg && records.some((record) => String(record.id) !== String(doctor?.id) && String(record.registrationNumber).toLocaleLowerCase() === normalizedReg)) {
      nextErrors.registrationNumber = 'This registration number already belongs to another doctor.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = ERROR_FIELDS.find((key) => nextErrors[key]);
      pendingFocus.current = first;
      setActiveTab(TABS.find((tab) => tab.fields.includes(first)).id);
      return;
    }
    const mrChanged = Boolean(doctor) && cleaned.mrId !== String(doctor.mrId ?? '');
    if (mrChanged && assignmentReason === undefined) { setMrReview((old) => old || { reason: '', reviewed: false, touched: false }); return; }
    setSaveError('');
    address.pause();
    setSaving(true);
    try {
      const result = await onSave({
        ...cleaned,
        zoneId: cleaned.zoneId || null, hqId: cleaned.hqId || null, areaId: cleaned.areaId || null,
        phone: cleaned.phone ? normalizePhone(cleaned.phone, cleaned.dialCountry) : '',
        alternatePhone: cleaned.alternatePhone ? normalizePhone(cleaned.alternatePhone, cleaned.dialCountry) : '',
        orderDiscount: cleaned.orderDiscount === '' ? '0.00' : discountRate(cleaned.orderDiscount),
        daysLimit: cleaned.daysLimit === '' ? 0 : Number(cleaned.daysLimit),
        paymentLimit: cleaned.paymentLimit === '' ? '0.00' : roundRate(cleaned.paymentLimit),
        ...(doctor ? { ...(mrChanged ? { assignmentReason } : {}), expected_area_version: savedArea.areaVersion, areaReason } : {}),
      });
      if (result?.success) setMrReview(null);
      if (!result?.success && (result?.reconcile || result?.ambiguous)) { setReconcileBlocked(true); setMrReview(null); }
      if (!result?.success) presentMasterFailure(result, { fields: ERROR_FIELDS, tabs: TABS, setErrors, setActiveTab, pendingFocus, setMessage: setSaveError, fallback: 'This doctor could not be saved. Your draft is preserved.' });
    } catch (error) {
      if (error?.ambiguous || !error?.status || error?.status === 409) { setReconcileBlocked(true); setMrReview(null); }
      presentMasterFailure(error, { fields: ERROR_FIELDS, tabs: TABS, setErrors, setActiveTab, pendingFocus, setMessage: setSaveError, fallback: 'This doctor could not be saved. Your draft is preserved.' });
    } finally {
      setSaving(false);
    }
  }

  return <form className="doctor-form" ref={formRef} onSubmit={handleSubmit} noValidate data-testid="form-doctor">
    <div className="doctor-form__about"><InfoDisclosure id="doctor-form-about" title="this Doctor form"
      text="Doctor records are shared server records. Adding or editing a doctor does not create a login account. Commercial limits are saved settings only; no payment ledger or order enforcement is connected."
      testId="button-doctor-form-info"><strong>About this form</strong></InfoDisclosure></div>
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
      {reconcileBlocked && <div className="doctor-form__notice doctor-form__notice--error" role="alert" data-testid="status-doctor-reconcile">
        <p>The last save result is uncertain or the record changed. Saving is paused until you reload the current record and review its assignment history. Your draft stays on screen until you reload.</p>
        <a className="doctor-master__text-button" href="/admin/masters/doctor-mr-mapping" target="_blank" rel="noreferrer" data-testid="link-doctor-review-history">Open Doctor MR Mapping to review history</a>
      </div>}
      {saveError && <div className="doctor-form__notice doctor-form__notice--error" role="alert" data-testid="error-doctor-save">
        <p>{saveError}</p><p>Refresh to review the latest records before trying again. Refreshing discards changes on this page.</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-doctor-save">Refresh records</button>
      </div>}
      <section className="doctor-form__section" id="doctor-panel-identity" role="tabpanel" aria-labelledby="doctor-tab-identity" tabIndex={0} hidden={activeTab !== 'identity'}>
        {doctor && <p className="doctor-form__hint">Doctor number: {doctor.doctorNumber}</p>}
        <div className="doctor-form__grid">
          {renderField('name', 'Doctor Name', { placeholder: 'Doctor name', autoComplete: 'name' })}
          {renderField('phone', 'Phone No.', { placeholder: 'Phone number' })}
          {renderField('alternatePhone', 'Alternate Phone No.', { placeholder: 'Alternate phone number' })}
          {renderField('email', 'Email ID', { type: 'email', placeholder: 'name@example.com', autoComplete: 'email' })}
          {renderField('dateOfJoining', 'Date of joining', { type: 'date' })}
          {renderField('registrationNumber', 'Registration Number', { placeholder: 'Registration number' })}
          {renderField('qualification', 'Qualification', { placeholder: 'Qualification' })}
          <div className="doctor-form__password-row">
            <div className="doctor-form__field">
               <InfoDisclosure id="doctor-password-help" title="Password" text={PASSWORD_INFO} testId="button-doctor-password-info">
                 <label className="doctor-form__label" htmlFor="doctor-password">Password</label>
               </InfoDisclosure>
              <div className="doctor-form__input-row">
                 <input id="doctor-password" className="doctor-form__control" type="password" placeholder="Unavailable" disabled autoComplete="off" data-testid="input-doctor-password" />
                 <button type="button" className="doctor-form__preview-action" disabled data-testid="button-generate-doctor-password">Generate password</button>
              </div>
            </div>
            <div className="doctor-form__field">
              <label className="doctor-form__label" htmlFor="doctor-confirm-password">Confirm password</label>
               <input id="doctor-confirm-password" className="doctor-form__control" type="password" placeholder="Unavailable" disabled autoComplete="off" data-testid="input-doctor-confirm-password" />
            </div>
          </div>
        </div>
      </section>
      <section className="doctor-form__section" id="doctor-panel-clinic" role="tabpanel" aria-labelledby="doctor-tab-clinic" tabIndex={0} hidden={activeTab !== 'clinic'}>
        <div className="doctor-form__section-head"><h3 className="doctor-form__section-title">Clinic & assignment</h3></div>
        <div className="doctor-form__grid">
          {renderField('clinicName', 'Clinic Name', { placeholder: 'Clinic name' })}
          <div className="doctor-form__field doctor-form__field--wide territory-panel" data-testid="doctor-location">
            <p className="territory-panel__eyebrow">Exact Doctor location</p>
            {legacyLocation && !locationChanged && <p className="doctor-form__notice" role="status" data-testid="notice-doctor-legacy-location">This saved Doctor has no complete Zone, HQ and Area. Unrelated edits keep it as is; nothing is derived from the address or assigned MR. Changing the MR requires choosing the full location.</p>}
            <div className="territory-panel__grid">
              {renderLevel('zoneId', 'Zone', 'zones', zoneReq, true, doctor?.zoneName, '')}
              {renderLevel('hqId', 'HQ', 'headquarters', hqReq, Boolean(values.zoneId), doctor?.hqName, 'Choose a Zone first')}
              {renderLevel('areaId', 'Area', 'areas', areaReq, Boolean(values.hqId), doctor?.areaName, 'Choose an HQ first')}
            </div>
          </div>
           <div className="doctor-form__field doctor-form__field--assignment">{fixedMR ? <><label className="doctor-form__label" htmlFor="doctor-mrId">Assigned MR</label><input id="doctor-mrId" name="mrId" className="doctor-form__control" value={fixedMR.name} readOnly /><p className="doctor-form__hint">Fixed to your authenticated MR account and kept on save. Choose a location your coverage includes.</p>{locationChanged && <p className="doctor-form__notice" role="status">The server rejects this save if your coverage does not include the chosen Zone, HQ and Area. Ownership is never changed for you.</p>}</> : <DoctorMRSelect labelClassName="doctor-form__label" value={values.mrId} savedName={doctor?.mrName}
            location={{ zoneId: values.zoneId, hqId: values.hqId, areaId: values.areaId }} disabled={saving || blocked}
            onHydrate={(items) => setHydratedMRs((old) => [...items, ...old.filter((row) => !items.some((item) => item.id === row.id))])}
             onChange={(value) => setValues((old) => ({ ...old, mrId: value }))} error={errors.mrId} />}
            {errors.mrId && <p className="doctor-form__error" role="alert">{errors.mrId}</p>}
            {!fixedMR && !locationComplete && <p className="doctor-form__hint">Choose Zone, HQ and Area to see every active MR responsible for that exact location.</p>}
            {!fixedMR && locationComplete && <p className="doctor-form__hint">Eligible: MRs covering the entire Zone, the entire HQ, or this Area explicitly. No MR is chosen for you.</p>}
          </div>
          {!fixedMR && doctor && <div className="doctor-form__field doctor-form__field--assignment">
            <span className="doctor-form__label" id="doctor-area-label">Doctor Area</span>
            <p className="doctor-form__hint" aria-labelledby="doctor-area-label" data-testid="text-doctor-area">{savedArea.areaName ? `${savedArea.areaName}${savedArea.areaHeadquarterName ? ` · Area HQ: ${savedArea.areaHeadquarterName}` : ''}` : 'Area not set'}</p>
            <button type="button" className="admin-button admin-button--secondary" disabled={saving || blocked || reconcileBlocked} onClick={() => { setAreaError(''); setAreaFeedback(''); setAreaDraft((old) => old.reason || old.areaId ? old : { areaId: savedArea.areaId || '', reason: '' }); setAreaDialog(true); }} data-testid="button-correct-doctor-area">Correct Doctor Area</button>
            {areaFeedback && <p className="doctor-form__hint" role="status">{areaFeedback}</p>}
            {areaError && !areaDialog && <p className="doctor-form__error" role="alert">{areaError}</p>}
            <p className="doctor-form__hint">Saved separately with a reason. Not the postal address and not MR coverage.</p>
          </div>}
          {doctor && LOCATION.some((key) => values[key] !== (savedArea[key] || '')) && <ReasonField id="doctor-area-edit-reason" label="Reason for Doctor Area correction" value={areaReason} onChange={setAreaReason} hint="The selected Area and its parent HQ are saved with this reason in assignment history. MR coverage is not changed." />}
          {renderField('status', 'Status', { selectOptions: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] })}
        </div>
      </section>
      <section className="doctor-form__section" id="doctor-panel-commercial" role="tabpanel" aria-labelledby="doctor-tab-commercial" tabIndex={0} hidden={activeTab !== 'commercial'}>
        <div className="doctor-form__section-head"><h3 className="doctor-form__section-title">Commercial details</h3></div>
        <div className="doctor-form__grid">
          {renderField('invoiceType', 'Invoice Type', { selectOptions: [{ value: 'normal', label: 'Normal' }, { value: 'gst', label: 'GST' }] })}
           {renderField('gstNumber', 'GST Number', { placeholder: values.invoiceType === 'gst' ? 'GSTIN' : 'Optional' })}
          {renderField('drugLicenceNumber', 'Drug Licence No.', { placeholder: 'Drug licence number' })}
          {renderField('orderDiscount', 'Order Discount (in %)', { type: 'text', placeholder: '0.00', inputMode: 'decimal' })}
          {renderField('daysLimit', 'Days Limit', { type: 'number', min: '0', step: '1', placeholder: '0', inputMode: 'numeric' })}
          {renderField('paymentLimit', 'Payment Limit', { type: 'number', min: '0', step: '0.01', placeholder: '0', inputMode: 'decimal' })}
        </div>
      </section>
      <section className="doctor-form__section" id="doctor-panel-address" role="tabpanel" aria-labelledby="doctor-tab-address" tabIndex={0} hidden={activeTab !== 'address'}>
        <div className="doctor-form__section-head"><h3 className="doctor-form__section-title">Address</h3></div>
        <div className="doctor-form__grid doctor-form__grid--address">
           {renderField('pincode', 'Pincode', { placeholder: 'Pincode', inputMode: 'numeric', autoComplete: 'postal-code' })}
          <PostalSelection address={address} prefix="doctor" fieldClass="doctor-form__lookup doctor-form__field"
            labelClass="doctor-form__label" hintClass="doctor-form__hint" />
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
      <div className="doctor-form__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={onClose} disabled={saving} data-testid="button-cancel-doctor">Cancel</button>
        <button type="submit" className="admin-button" disabled={saving || blocked || reconcileBlocked} data-testid="button-save-doctor">{saving ? 'Saving…' : doctor ? 'Save changes' : 'Add Doctor'}</button>
      </div>
    </div>
    {areaDialog && doctor && <AreaDialog doctor={{ ...doctor, ...savedArea }} draft={areaDraft} onDraft={setAreaDraft} pending={areaPending} error={areaError} onConfirm={saveArea} onClose={() => { if (!areaPending) { setAreaDialog(false); setAreaError(''); } }} />}
    {mrReview && doctor && (() => {
      const rError = reasonError(mrReview.reason);
      const ready = !rError && mrReview.reviewed;
      return <Dialog title="Review MR change" eyebrow={`Doctor ${doctor.doctorNumber || ''}`.trim()} onClose={() => { if (!saving) setMrReview(null); }} dismissDisabled={saving}
        description="Changing the MR transfers this Doctor. Confirm the identities below; the server re-checks the record version and destination."
        footer={<><button type="button" className="admin-button admin-button--secondary" disabled={saving} onClick={() => setMrReview(null)} data-testid="button-cancel-mr-review">Back to form</button>
          <button type="button" className="admin-button" disabled={!ready || saving} onClick={() => handleSubmit(null, mrReview.reason.trim())} data-testid="button-confirm-mr-review">{saving ? 'Saving…' : 'Save with MR change'}</button></>}>
        <div className="doctor-mapping__dialog">
          <dl className="doctor-mapping__event-body">
            <div><dt>Doctor</dt><dd>{person(doctor, 'doctorNumber')}</dd></div>
            <div><dt>Current MR</dt><dd>{doctor.mrName ? `${doctor.mrName}${doctor.mrUserId ? ` (${doctor.mrUserId})` : ''}` : 'Missing MR'}</dd></div>
            <div><dt>New MR</dt><dd>{person(selectedMR, 'userId')}{selectedMR?.zoneName ? ` · Zone ${selectedMR.zoneName}` : ''}</dd></div>
          </dl>
          <TransferEffects />
          <ReasonField id="doctor-assignment-reason" value={mrReview.reason} onChange={(reason) => setMrReview((old) => ({ ...old, reason }))} error={mrReview.reason ? rError : ''} />
          <label className="doctor-mapping__confirm"><input type="checkbox" checked={mrReview.reviewed} onChange={(event) => setMrReview((old) => ({ ...old, reviewed: event.target.checked }))} data-testid="checkbox-mr-review" /> I reviewed the old and new MR and that linked Patients move with this Doctor.</label>
          {saveError && <div className="admin-feedback admin-feedback--error" role="alert">{saveError}</div>}
        </div>
      </Dialog>;
    })()}
  </form>;
}