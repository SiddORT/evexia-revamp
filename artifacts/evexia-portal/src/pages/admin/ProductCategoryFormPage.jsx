import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Layers3, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { createProductCategory, editProductCategory, getProductCategory, listProductCategories } from '../../services/serverProductCategories.js';
import { normalizeCategoryName as normalizeName, validateProductCategory } from '../../services/productCategoryValidation.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../category.css';

const LIST = '/admin/masters/product-categories';
const empty = () => ({ name: '', description: '', unit_price: '', status: 'active' });

function CategoryForm({ record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? { name: record.name, description: record.description, unit_price: record.unit_price, status: record.status } : empty());
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
      if (getSession().user?.id !== owner) { setValues(empty()); setServerError(''); setErrors({}); }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    // Keep uncertain/conflicting outcome visible until authoritative reconciliation.
    if (!blocked) setServerError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const nextErrors = validateProductCategory(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true); setServerError('');
    try {
      await onSave({ name: normalizeName(values.name), description: values.description.trim(), unit_price: values.unit_price.trim(), status: values.status });
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) { setServerError(cause.message); setBlocked(cause.code === 'product_category_stale' || Boolean(cause.ambiguous) || cause.code === 'not_found'); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function reconcile() {
    if (busy.current) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true);
    try {
      const current = await onRefresh(values); guard();
      if (!alive.current) return;
      setServerError(current ? `Current server record: ${current.name}; ${current.unit_price}; ${current.description}; ${current.status}. Your draft is retained. Compare these details before saving again.` : 'No matching record exists. Your draft is retained; review before retrying.');
      setBlocked(false);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setServerError(cause.message);
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  return <form className="admin-category-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Category details</h2><p>Fields marked * are required. Records are shared on the server.</p></div><Layers3 size={21} /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={reconcile}><RefreshCw size={16} /> Review current server details (keep draft)</button></div>}
      <div className="mr-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="category-name">Product category name *</label><input id="category-name" className="mr-form__control" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Diagnostic reagents" aria-invalid={Boolean(errors.name)} data-testid="input-category-name" />{errors.name && <p className="mr-form__error" role="alert">{errors.name}</p>}</div>
        <div className="mr-form__field mr-form__field--wide"><label className="mr-form__label" htmlFor="category-description">Description (optional)</label><textarea id="category-description" className="mr-form__control" value={values.description} onChange={(event) => update('description', event.target.value)} data-testid="input-category-description" />{errors.description && <p className="mr-form__error" role="alert">{errors.description}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="category-price">Unit price *</label><input id="category-price" className="mr-form__control" inputMode="decimal" value={values.unit_price} onChange={(event) => update('unit_price', event.target.value)} aria-invalid={Boolean(errors.unit_price)} data-testid="input-category-price" /><p className="mr-form__hint">0–999999999999.999999; up to 12 integer and 6 fractional digits. Plain decimal only, never rounded.</p>{errors.unit_price && <p className="mr-form__error" role="alert">{errors.unit_price}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="category-status">Status *</label><select id="category-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} aria-invalid={Boolean(errors.status)} data-testid="select-category-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" role="alert">{errors.status}</p>}</div>
      </div>
    </div>
    <div className="mr-form__footer"><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-category">{pending ? 'Saving…' : record ? 'Save changes' : 'Save category'}</button></div></div>
  </form>;
}

export default function ProductCategoryFormPage({ id }) {
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
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) { snapshot.current = null; setRecord(null); }
    });
  }, []);
  useEffect(() => {
    let active = true;
    if (!id) return;
    const guard = reportingIdentityGuard();
    setLoading(true);
    getProductCategory(id).then((row) => { guard(); if (active) { snapshot.current = row; setRecord(row); setError(''); } })
      .catch((cause) => { try { guard(); } catch { return; } if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, revision]);
  async function refresh(values) {
    if (!id) {
      const result = await listProductCategories({ query: normalizeName(values.name), status: 'all', limit: 100, offset: 0 });
      const same = result.items.find((row) => normalizeName(row.name).toLowerCase() === normalizeName(values.name).toLowerCase());
      if (same) throw new Error(`A category with this name is already saved: ${same.name}; ${same.unit_price}; ${same.description}; ${same.status}. Your draft is retained. Return to the list and inspect it instead of creating a duplicate.`);
      if (result.filtered > 100) throw new Error('More than 100 matches. Inspect the list before retrying.');
      return null;
    }
    const current = await getProductCategory(id);
    snapshot.current = current;
    return current;
  }
  async function save(values) {
    const guard = reportingIdentityGuard();
    await (id ? editProductCategory(snapshot.current, values) : createProductCategory(values));
    guard();
    if (alive.current) navigate(`${LIST}?saved=${id ? 'updated' : 'added'}`);
  }
  const title = id ? 'Edit category' : 'Add category';
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Directory / Product Category Master</p><h1>{title}</h1><p className="admin-page-head__description">Manage a shared category’s name, description, exact price and availability.</p></div><button className="admin-button admin-button--secondary" onClick={() => navigate(LIST)}><ArrowLeft size={16} /> Back to categories</button></div>
    {loading ? <p role="status">Loading category…</p> : error || (id && !record) ? <section className="admin-panel" role="alert"><h2>Product category could not be loaded</h2><p>{error || 'This category may have been deleted.'}</p><button className="admin-button" onClick={() => setRevision((value) => value + 1)}>Retry</button></section> : <section className="admin-panel" aria-label={title}><CategoryForm key={id || 'new'} record={record} onSave={save} onCancel={() => navigate(LIST)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}
