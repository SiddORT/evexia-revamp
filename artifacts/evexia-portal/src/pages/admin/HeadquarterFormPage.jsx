import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Building2, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import useHeadquarters from '../../hooks/useHeadquarters.js';
import '../../mr.css';
import '../../category.css';
import '../../headquarter.css';

const LIST_PATH = '/admin/masters/headquarters';
const emptyValues = { name: '', stateCode: '', status: '' };
const draftKey = (id) => `evexia-headquarter-draft:${id || 'new'}`;

function initialValues(record, id) {
  const fallback = record ? { name: record.name || '', stateCode: record.stateCode || '', status: record.status || 'active' } : emptyValues;
  try {
    const saved = window.sessionStorage.getItem(draftKey(id));
    if (saved) {
      const draft = JSON.parse(saved);
      if (draft && typeof draft.name === 'string' && typeof draft.stateCode === 'string' && typeof draft.status === 'string') return draft;
    }
  } catch { /* Unavailable storage does not prevent editing. */ }
  return fallback;
}

function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = 'HQ Name is required.';
  if (!values.stateCode.trim()) errors.stateCode = 'State Code is required.';
  if (!['active', 'inactive'].includes(values.status)) errors.status = 'Select a status.';
  return errors;
}

function HeadquarterForm({ id, record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => initialValues(record, id));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  function update(field, value) {
    const next = { ...values, [field]: value };
    setValues(next);
    try { window.sessionStorage.setItem(draftKey(id), JSON.stringify(next)); } catch { /* Keep the in-memory draft. */ }
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
      const result = onSave({ name: values.name.trim(), stateCode: values.stateCode.trim().toUpperCase(), status: values.status });
      if (result.success) {
        try { window.sessionStorage.removeItem(draftKey(id)); } catch { /* Saved record is unaffected. */ }
      } else setServerError(result.error || 'The headquarter could not be saved. Check the details and try again.');
    } catch (cause) { setServerError(cause.message || 'The headquarter could not be saved.'); }
  }

  return <form className="admin-category-form admin-hq-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Headquarter details</h2><p>Fields marked * are required. Changes are saved to this browser only.</p></div><Building2 size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-headquarter-error"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button></div>}
      <div className="mr-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-name">HQ Name <span className="mr-form__required">*</span></label><input id="headquarter-name" className="mr-form__control" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Maharashtra" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'headquarter-name-error' : undefined} data-testid="input-headquarter-name" />{errors.name && <p className="mr-form__error" id="headquarter-name-error" role="alert">{errors.name}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-state-code">State Code <span className="mr-form__required">*</span></label><input id="headquarter-state-code" className="mr-form__control admin-hq-code-input" value={values.stateCode} onChange={(event) => update('stateCode', event.target.value.toUpperCase())} placeholder="e.g. MH" autoCapitalize="characters" aria-invalid={Boolean(errors.stateCode)} aria-describedby={errors.stateCode ? 'headquarter-state-code-error' : undefined} data-testid="input-headquarter-state-code" />{errors.stateCode && <p className="mr-form__error" id="headquarter-state-code-error" role="alert">{errors.stateCode}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-status">Status <span className="mr-form__required">*</span></label><select id="headquarter-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'headquarter-status-error' : undefined} data-testid="select-headquarter-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" id="headquarter-status-error" role="alert">{errors.status}</p>}</div>
      </div>
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Your draft stays in this tab until it is saved. No server account is updated.</span><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-headquarter">Cancel</button><button type="submit" className="admin-button" data-testid="button-save-headquarter">{record ? 'Save changes' : 'Save headquarter'}</button></div></div>
  </form>;
}

export default function HeadquarterFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, error, retry, add, edit } = useHeadquarters();
  const [revision, setRevision] = useState(0);
  const record = id ? records.find((item) => item.id === id) : null;
  const title = id ? 'Edit headquarter' : 'Add headquarter';

  function refresh() {
    retry();
    setRevision((current) => current + 1);
  }
  function save(values) {
    const result = id ? edit(id, values) : add(values);
    if (result.success) {
      try { window.sessionStorage.removeItem(draftKey(id)); } catch { /* Storage is optional. */ }
      navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
    }
    return result;
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Directory / Headquarter Master</p><h1>{title}</h1><p className="admin-page-head__description">{id ? 'Update the name, state code and availability of this headquarter.' : 'Add a headquarter to your browser-local directory.'}</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-headquarters"><ArrowLeft size={16} aria-hidden="true" /> Back to headquarters</button></div>
    {error || (id && !record) ? <section className="admin-panel admin-category-form__recovery" role="alert"><h2>{error ? 'Headquarters could not be loaded' : 'Headquarter not found'}</h2><p>{error || 'This headquarter may have been removed or the link may be incorrect. Refresh the latest records or return to Headquarter Master.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-return-headquarters">Return to headquarters</button><button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-headquarter-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button></div></section> : <section className="admin-panel" aria-label={title}><HeadquarterForm key={`${id || 'new'}-${revision}`} id={id} record={record} onSave={save} onCancel={() => navigate(LIST_PATH)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}