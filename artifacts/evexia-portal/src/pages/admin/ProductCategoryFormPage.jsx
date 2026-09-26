import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Layers3, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import useProductCategories from '../../hooks/useProductCategories.js';
import '../../mr.css';
import '../../category.css';

const LIST_PATH = '/admin/masters/product-categories';
const emptyValues = { name: '', description: '', unitPrice: '', status: 'active' };

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'Product category name is required.';
  if (!String(values.unitPrice).trim()) errors.unitPrice = 'Unit price is required.';
  else if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(values.unitPrice).trim()) || !Number.isFinite(Number(values.unitPrice))) errors.unitPrice = 'Enter a non-negative numeric price.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Select a status.';
  return errors;
}

function CategoryForm({ record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? {
    name: record.name || '',
    description: record.description || '',
    unitPrice: String(record.unitPrice ?? ''),
    status: record.status || 'active',
  } : emptyValues);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setServerError('');
  }
  function submit(event) {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    setServerError('');
    if (Object.keys(nextErrors).length) return;
    try {
      const result = onSave({ name: values.name.trim(), description: values.description.trim(), unitPrice: Number(values.unitPrice), status: values.status });
      if (!result.success) setServerError(result.error || 'The category could not be saved. Refresh records and try again.');
    } catch (cause) { setServerError(cause.message || 'The category could not be saved.'); }
  }

  return <form className="admin-category-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Category details</h2><p>Fields marked * are required. Changes are saved to this browser only.</p></div><Layers3 size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-category-error"><RefreshCw size={16} aria-hidden="true" /> Refresh records and discard draft</button></div>}
      <div className="mr-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="category-name">Product category name <span className="mr-form__required">*</span></label><input id="category-name" className="mr-form__control" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Diagnostic reagents" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'category-name-error' : undefined} data-testid="input-category-name" />{errors.name && <p className="mr-form__error" id="category-name-error" role="alert">{errors.name}</p>}</div>
        <div className="mr-form__field mr-form__field--wide"><label className="mr-form__label" htmlFor="category-description">Description <span className="mr-form__hint">(optional)</span></label><textarea id="category-description" className="mr-form__control" value={values.description} onChange={(event) => update('description', event.target.value)} placeholder="What belongs in this category?" data-testid="input-category-description" /></div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="category-price">Unit price <span className="mr-form__required">*</span></label><input id="category-price" className="mr-form__control" type="number" min="0" step="any" inputMode="decimal" value={values.unitPrice} onChange={(event) => update('unitPrice', event.target.value)} placeholder="0.00" aria-invalid={Boolean(errors.unitPrice)} aria-describedby={errors.unitPrice ? 'category-price-error' : undefined} data-testid="input-category-price" />{errors.unitPrice ? <p className="mr-form__error" id="category-price-error" role="alert">{errors.unitPrice}</p> : <p className="mr-form__hint">Enter a non-negative numeric amount.</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="category-status">Status <span className="mr-form__required">*</span></label><select id="category-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'category-status-error' : undefined} data-testid="select-category-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" id="category-status-error" role="alert">{errors.status}</p>}</div>
      </div>
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Changes stay in this browser. No server account or inventory is updated.</span><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-category">Cancel</button><button type="submit" className="admin-button" data-testid="button-save-category">{record ? 'Save changes' : 'Save category'}</button></div></div>
  </form>;
}

export default function ProductCategoryFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, error, retry, add, edit } = useProductCategories();
  const [revision, setRevision] = useState(0);
  const record = id ? records.find((item) => item.id === id) : null;
  const title = id ? 'Edit product category' : 'Add product category';

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
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Inventory / Product Category Master</p><h1>{title}</h1><p className="admin-page-head__description">{id ? 'Update this category’s details and availability.' : 'Create a browser-local category for your product catalog.'}</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-categories"><ArrowLeft size={16} aria-hidden="true" /> Back to categories</button></div>
    {error || (id && !record) ? <section className="admin-panel admin-category-form__recovery" role="alert"><h2>{error ? 'Categories could not be loaded' : 'Category not found'}</h2><p>{error || 'This category may have been removed or the link may be incorrect. Refresh the latest records or return to Product Category Master.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-return-categories">Return to categories</button><button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-category-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button></div></section> : <section className="admin-panel" aria-label={title}><CategoryForm key={`${id || 'new'}-${revision}`} record={record} onSave={save} onCancel={() => navigate(LIST_PATH)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}