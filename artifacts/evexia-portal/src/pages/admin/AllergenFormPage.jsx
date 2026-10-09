import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, FlaskConical, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import AllergenRefPicker from '../../components/admin/AllergenRefPicker.jsx';
import AllergenSearchableSelect from '../../components/admin/AllergenSearchableSelect.jsx';
import InfoDisclosure from '../../components/admin/InfoDisclosure.jsx';
import { allergenPayload, createAllergen, editAllergen, getAllergen, listAllergens, validateAllergen } from '../../services/serverAllergens.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../allergen.css';

const LIST = '/admin/masters/allergens';
const empty = () => ({ name: '', category_id: '', storage_location_id: '', selling_price: '', gst: '', concentration: '', threshold_limit: '', status: 'active', mix: false });
const fromRecord = (r) => ({ name: r.name, category_id: r.category_id, storage_location_id: r.storage_location_id, selling_price: r.selling_price ?? '', gst: r.gst, concentration: r.concentration, threshold_limit: r.threshold_limit ?? '', status: r.status, mix: r.mix === true });
const norm = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase();
const summary = (r) => `${r.name}; ${r.category_name}; ${r.storage_location_name}; price ${r.selling_price ?? 'none'}; GST ${r.gst}; ${r.concentration}; threshold ${r.threshold_limit ?? 'none'}; ${r.mix ? 'Mix' : 'No Mix'}; ${r.status}`;

function AllergenForm({ record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? fromRecord(record) : empty());
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      const s = getSession();
      if (s.user?.id !== owner || !['authenticated', 'renewing', 'renewal-error'].includes(s.status)) { setValues(empty()); setServerError(''); setErrors({}); }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  function update(field, value) {
    setValues((c) => ({ ...c, [field]: value }));
    setErrors((c) => ({ ...c, [field]: undefined }));
    if (!blocked) setServerError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const next = validateAllergen(values);
    setErrors(next);
    if (Object.keys(next).length) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true); setServerError('');
    try { await onSave(allergenPayload(values)); }
    catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) { setServerError(cause.message); setBlocked(/stale|conflict/.test(cause.code || '') || Boolean(cause.ambiguous) || cause.code === 'not_found'); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function reconcile() {
    if (busy.current) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true);
    try {
      const current = await onRefresh(values); guard();
      if (!alive.current) return;
      setServerError(current ? `Current server record: ${summary(current)}. Your draft is retained. Compare these details before saving again.` : 'No matching record exists. Your draft is retained; review before retrying.');
      setBlocked(false);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setServerError(cause.message);
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const err = (name) => errors[name] && <p className="mr-form__error" id={`allergen-${name}-error`} role="alert">{errors[name]}</p>;
  const text = (name, label, { optional = false, info, numeric = false, max } = {}) => {
    const fieldLabel = <label className="mr-form__label" htmlFor={`allergen-${name}`}>{label} {optional ? <span className="mr-form__hint">(optional)</span> : <span className="mr-form__required">*</span>}</label>;
    return <div className="mr-form__field">
    {info ? <InfoDisclosure id={`allergen-${name}-help`} title={label} text={info} testId={`button-allergen-${name}-info`}>{fieldLabel}</InfoDisclosure> : fieldLabel}
    <input id={`allergen-${name}`} className="mr-form__control" inputMode={numeric ? 'decimal' : undefined} maxLength={max} value={values[name]} onChange={(e) => update(name, e.target.value)} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `allergen-${name}-error` : undefined} data-testid={`input-allergen-${name}`} />
    {err(name)}
  </div>;
  };
  const decimalHint = 'Plain decimal, up to 12 integer and 6 fractional digits. Never rounded.';
  return <form className="admin-allergen-form" onSubmit={submit} noValidate>
    <div className="admin-allergen-form__intro"><div><h2>Product details</h2><p>Fields marked * are required. Records are shared on the server.</p></div><FlaskConical size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={reconcile} data-testid="button-reconcile-allergen"><RefreshCw size={16} aria-hidden="true" /> Review current server details (keep draft)</button></div>}
      <fieldset className="mr-form__grid" disabled={pending} style={{ border: 0, margin: 0, padding: 0 }}>
        {text('name', 'Product name', { max: 200 })}
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-category">Product category <span className="mr-form__required">*</span></label>
          <AllergenRefPicker id="allergen-category" kind="categories" label="Product category" value={values.category_id} disabled={pending} describedBy={errors.category_id ? 'allergen-category_id-error' : undefined} invalid={Boolean(errors.category_id)} testId="select-allergen-category"
            retained={record ? { id: record.category_id, name: record.category_name, status: record.category_status } : null} onChange={(id) => update('category_id', id)} />
          {err('category_id')}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-location">Storage location <span className="mr-form__required">*</span></label>
          <AllergenRefPicker id="allergen-location" kind="locations" label="Storage location" value={values.storage_location_id} disabled={pending} describedBy={errors.storage_location_id ? 'allergen-storage_location_id-error' : undefined} invalid={Boolean(errors.storage_location_id)} testId="select-allergen-location"
            retained={record ? { id: record.storage_location_id, name: record.storage_location_name, status: record.storage_location_status } : null} onChange={(id) => update('storage_location_id', id)} />
          {err('storage_location_id')}</div>
        {text('selling_price', 'Selling price', { optional: true, numeric: true, info: decimalHint })}
        {text('gst', 'GST (%)', { numeric: true, info: '0 to 100, up to 6 fractional digits.' })}
        {text('concentration', 'Concentration', { max: 200 })}
        {text('threshold_limit', 'Threshold limit', { optional: true, numeric: true, info: decimalHint })}
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-status">Status <span className="mr-form__required">*</span></label><AllergenSearchableSelect id="allergen-status" label="Status" value={values.status} disabled={pending} placeholder="Select status" invalid={Boolean(errors.status)} describedBy={errors.status ? 'allergen-status-error' : undefined} testId="select-allergen-status" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} onChange={(value) => update('status', value)} />{err('status')}</div>
        <div className="mr-form__field"><span className="mr-form__label" id="allergen-mix-label">Mix / No Mix</span>
          <button type="button" role="switch" aria-checked={values.mix} aria-labelledby="allergen-mix-label allergen-mix-state" className="admin-allergen-switch" onClick={() => update('mix', !values.mix)} data-testid="switch-allergen-mix">
            <span className="admin-allergen-switch__track" aria-hidden="true"><span className="admin-allergen-switch__thumb" /></span>
            <strong id="allergen-mix-state" data-testid="text-allergen-mix-state">{values.mix ? 'Mix' : 'No Mix'}</strong>
          </button>
          <p className="mr-form__hint">Catalogue metadata only. Not a stock mixing operation.</p></div>
      </fieldset>
    </div>
    <div className="mr-form__footer"><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-allergen">Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-allergen">{pending ? 'Saving…' : record ? 'Save changes' : 'Save product'}</button></div></div>
  </form>;
}

export default function AllergenFormPage({ id }) {
  const [, navigate] = useLocation();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [revision, setRevision] = useState(0);
  const snapshot = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => { if (getSession().user?.id !== owner) { snapshot.current = null; setRecord(null); } });
  }, []);
  useEffect(() => {
    let active = true;
    if (!id) return undefined;
    const guard = reportingIdentityGuard();
    setLoading(true);
    getAllergen(id).then((row) => { guard(); if (active) { snapshot.current = row; setRecord(row); setError(''); } })
      .catch((cause) => { try { guard(); } catch { return; } if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, revision]);
  async function refresh(values) {
    if (!id) {
      const result = await listAllergens({ query: values.name.trim(), status: 'all', mix: 'all', limit: 100, offset: 0 });
      const same = result.items.find((row) => norm(row.name) === norm(values.name));
      if (same) throw new Error(`A product with this name is already saved: ${summary(same)}. Your draft is retained. Inspect the list instead of creating a duplicate.`);
      if (result.filtered > 100) throw new Error('More than 100 matches. Inspect the list before retrying.');
      return null;
    }
    const current = await getAllergen(id);
    snapshot.current = current;
    return current;
  }
  async function save(values) {
    const guard = reportingIdentityGuard();
    await (id ? editAllergen(snapshot.current, values) : createAllergen(values));
    guard();
    if (alive.current) navigate(`${LIST}?saved=${id ? 'updated' : 'added'}`);
  }
  const title = id ? 'Edit product' : 'Add product';
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Inventory / Allergen Master</p><h1>{title}</h1><p className="admin-page-head__description">Manage a shared allergen product’s details, reference masters and availability.</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST)} data-testid="button-back-allergens"><ArrowLeft size={16} aria-hidden="true" /> Back to allergens</button></div>
    {loading ? <p role="status">Loading product…</p> : error || (id && !record) ? <section className="admin-panel admin-allergen-form__recovery" role="alert"><h2>Product could not be loaded</h2><p>{error || 'This product may have been deleted.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST)}>Return to allergens</button><button type="button" className="admin-button" onClick={() => setRevision((v) => v + 1)} data-testid="button-refresh-allergen-form">Retry</button></div></section>
      : <section className="admin-panel admin-allergen-panel" aria-label={title}><AllergenForm key={id || 'new'} record={record} onSave={save} onCancel={() => navigate(LIST)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}
