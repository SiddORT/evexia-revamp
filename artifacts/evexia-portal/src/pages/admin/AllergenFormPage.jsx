import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, FlaskConical, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import useAllergens from '../../hooks/useAllergens.js';
import { referenceLabel, validateAllergen } from '../../services/allergens.js';
import '../../mr.css';
import '../../allergen.css';

const LIST_PATH = '/admin/masters/allergens';
const emptyValues = { name: '', categoryId: '', sellingPrice: '', gst: '', storageLocationId: '', concentration: '', thresholdLimit: '', hsnCode: '', status: 'active', allergens: true };

function ReferenceSelect({ field, label, value, list, onChange, error, record }) {
  const selected = list.find((item) => item.id === value);
  const legacy = value && (!selected || selected.status !== 'active') && record?.[field] === value;
  return <div className="mr-form__field">
    <label className="mr-form__label" htmlFor={`allergen-${field}`}>{label} <span className="mr-form__required">*</span></label>
    <select id={`allergen-${field}`} className="mr-form__control" value={value} onChange={(event) => onChange(field, event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `allergen-${field}-error` : undefined} data-testid={`select-allergen-${field}`}>
      <option value="">Select {label.toLowerCase()}</option>
      {legacy && <option value={value}>{referenceLabel(list, value, label.toLowerCase())} — existing selection</option>}
      {list.filter((item) => item.status === 'active').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
    </select>
    {error ? <p className="mr-form__error" id={`allergen-${field}-error`} role="alert">{error}</p> : legacy ? <p className="mr-form__hint">This saved reference is no longer active. You may keep it, or choose an active {label.toLowerCase()}.</p> : null}
  </div>;
}

function AllergenForm({ record, records, refs, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? {
    name: record.name ?? '', categoryId: record.categoryId ?? '', sellingPrice: String(record.sellingPrice ?? ''),
    gst: String(record.gst ?? ''), storageLocationId: record.storageLocationId ?? '', concentration: record.concentration ?? '',
    thresholdLimit: String(record.thresholdLimit ?? ''), hsnCode: record.hsnCode ?? '', status: record.status ?? 'active',
    allergens: record.allergens,
  } : { ...emptyValues });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const categories = refs?.categories || [];
  const locations = refs?.locations || [];

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setServerError('');
  }
  function submit(event) {
    event.preventDefault();
    const result = validateAllergen(values, records, refs, record?.id);
    setErrors(result.errors);
    setServerError('');
    if (Object.keys(result.errors).length) return;
    try {
      const saved = onSave(result.fields);
      if (!saved.success) setServerError(saved.error || 'The product could not be saved. Refresh records and try again.');
    } catch (cause) { setServerError(cause.message || 'The product could not be saved.'); }
  }
  function field(name, label, options = {}) {
    const { optional = false, numeric = false, placeholder = '' } = options;
    return <div className="mr-form__field" key={name}>
      <label className="mr-form__label" htmlFor={`allergen-${name}`}>{label} {optional ? <span className="mr-form__hint">(optional)</span> : <span className="mr-form__required">*</span>}</label>
      <input id={`allergen-${name}`} className="mr-form__control" type={numeric ? 'number' : 'text'} min={numeric ? '0' : undefined} max={name === 'gst' ? '100' : undefined} step={numeric ? 'any' : undefined} inputMode={numeric ? 'decimal' : undefined} value={values[name]} onChange={(event) => update(name, event.target.value)} placeholder={placeholder} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `allergen-${name}-error` : undefined} data-testid={`input-allergen-${name}`} />
      {errors[name] && <p className="mr-form__error" id={`allergen-${name}-error`} role="alert">{errors[name]}</p>}
    </div>;
  }

  return <form className="admin-allergen-form" onSubmit={submit} noValidate>
    <div className="admin-allergen-form__intro"><div><h2>Product details</h2><p>Fields marked * are required. Changes are saved to this browser only.</p></div><FlaskConical size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {(serverError || errors.form) && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError || errors.form}</p>{serverError && <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-allergen-error"><RefreshCw size={16} aria-hidden="true" /> Refresh records and discard draft</button>}</div>}
      <div className="mr-form__grid">
        <div className="admin-allergen-form__section">Identity <small>Catalog name and its master references</small></div>
        {field('name', 'Product Name', { placeholder: 'e.g. Diagnostic reagent' })}
        <ReferenceSelect field="categoryId" label="Category" value={values.categoryId} list={categories} onChange={update} error={errors.categoryId} record={record} />
        <ReferenceSelect field="storageLocationId" label="Storage Location" value={values.storageLocationId} list={locations} onChange={update} error={errors.storageLocationId} record={record} />
        <p className="mr-form__footer-note">These locations use the separate browser-local dataset. Shared Storage Location Master changes do not affect these choices.</p>
        {field('hsnCode', 'HSN code', { optional: true, placeholder: 'e.g. 3822' })}
        <div className="admin-allergen-form__section">Pricing & specification <small>Amounts are non-negative; GST is between 0 and 100</small></div>
        {field('sellingPrice', 'Selling Price', { optional: true, numeric: true, placeholder: '0.00' })}
        {field('gst', 'GST (%)', { numeric: true, placeholder: 'e.g. 12' })}
        {field('concentration', 'Concentration', { placeholder: 'e.g. 10 mg/mL' })}
        {field('thresholdLimit', 'Threshold limit', { optional: true, numeric: true, placeholder: 'e.g. 5' })}
        <div className="admin-allergen-form__section">Availability & handling <small>Control visibility and the Allergens / No Mix designation</small></div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-status">Status <span className="mr-form__required">*</span></label><select id="allergen-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} aria-invalid={Boolean(errors.status)} data-testid="select-allergen-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" role="alert">{errors.status}</p>}</div>
        <fieldset className="mr-form__field"><legend className="mr-form__label">Allergens / No Mix <span className="mr-form__required">*</span></legend><div className="admin-allergen-form__choice"><label><input type="radio" name="allergen-designation" checked={values.allergens === true} onChange={() => update('allergens', true)} data-testid="radio-allergen-allergens" /> Allergens</label><label><input type="radio" name="allergen-designation" checked={values.allergens === false} onChange={() => update('allergens', false)} data-testid="radio-allergen-no-mix" /> No Mix</label></div>{errors.allergens && <p className="mr-form__error" role="alert">{errors.allergens}</p>}</fieldset>
      </div>
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Changes stay in this browser. No server account or inventory is updated.</span><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-allergen">Cancel</button><button type="submit" className="admin-button" data-testid="button-save-allergen">{record ? 'Save changes' : 'Save product'}</button></div></div>
  </form>;
}

export default function AllergenFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, refs, error, retry, add, edit } = useAllergens();
  const [revision, setRevision] = useState(0);
  const record = id ? records.find((item) => item.id === id) : null;
  const title = id ? 'Edit product' : 'Add product';

  function refresh() {
    retry();
    setRevision((current) => current + 1);
  }
  function save(values) {
    const result = id ? edit(id, values) : add(values);
    if (result.success) navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Inventory / Allergen Master</p><h1>{title}</h1><p className="admin-page-head__description">{id ? 'Update this product’s details, reference masters and availability.' : 'Create a browser-local product in Allergen Master.'}</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-allergens"><ArrowLeft size={16} aria-hidden="true" /> Back to allergens</button></div>
    {error || (id && !record) ? <section className="admin-panel admin-allergen-form__recovery" role="alert"><h2>{error ? 'Products could not be loaded' : 'Product not found'}</h2><p>{error || 'This product may have been removed or the link may be incorrect. Refresh the latest records or return to Allergen Master.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-return-allergens">Return to allergens</button><button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-allergen-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button></div></section> : <section className="admin-panel" aria-label={title}><AllergenForm key={`${id || 'new'}-${revision}`} record={record} records={records} refs={refs} onSave={save} onCancel={() => navigate(LIST_PATH)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}