import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, BriefcaseBusiness, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { createDesignation, editDesignation, getDesignation, listDesignations } from '../../services/serverDesignations.js';
import { validateServerDesignation, DESIGNATION_COLUMNS } from '../../services/serverDesignationValidation.js';
import '../../mr.css';
import '../../category.css';
import '../../designation.css';

const LIST_PATH = '/admin/masters/designations';
const empty = { name: '', shortName: '', status: '' };

function DesignationForm({ record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? Object.fromEntries(DESIGNATION_COLUMNS.map(([key]) => [key, String(record[key])])) : empty);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false);
  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setServerError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const result = validateServerDesignation(values);
    setErrors(result.errors);
    setServerError('');
    if (Object.keys(result.errors).length) return;
    busy.current = true;
    setPending(true);
    try {
      await onSave(result.fields);
    } catch (cause) {
      setServerError(cause.message || 'Designation could not be saved.');
      setBlocked(cause.code === 'designation_stale' || Boolean(cause.ambiguous));
    } finally { busy.current = false; setPending(false); }
  }
  return <form className="admin-category-form admin-designation-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Designation details</h2><p>Fields marked * are required. Records save on the server.</p></div><BriefcaseBusiness size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={async () => {
        if (busy.current) return;
        busy.current = true; setPending(true);
        try {
          const current = await onRefresh(values);
          setServerError(current ? `Current server details: ${DESIGNATION_COLUMNS.map(([field, label]) => `${label}: ${current[field]}`).join('; ')}. Your draft is retained. Review before saving again.` : 'No matching server designation was found. Your draft is retained; review before retrying.');
          setBlocked(false);
        } catch (cause) { setServerError(cause.message); }
        finally { busy.current = false; setPending(false); }
      }} data-testid="button-refresh-designation-error"><RefreshCw size={16} aria-hidden="true" /> Review current server details (keep draft)</button></div>}
      <div className="mr-form__grid admin-designation-grid">
        {DESIGNATION_COLUMNS.map(([key, label]) => <div className="mr-form__field" key={key}>
          <label className="mr-form__label" htmlFor={`designation-${key}`}>{label} <span className="mr-form__required">*</span></label>
          {key === 'status' ? <select disabled={pending} id={`designation-${key}`} className="mr-form__control" value={values[key]} onChange={(event) => update(key, event.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `designation-${key}-error` : undefined} data-testid="select-designation-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
            : <input disabled={pending} id={`designation-${key}`} className="mr-form__control" type="text" maxLength={key === 'name' ? 200 : 50} value={values[key]} onChange={(event) => update(key, event.target.value)} placeholder={key === 'name' ? 'Designation Name' : 'Short name'} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `designation-${key}-error` : undefined} data-testid={`input-designation-${key}`} />}
          {errors[key] && <p className="mr-form__error" id={`designation-${key}-error`} role="alert">{errors[key]}</p>}
        </div>)}
      </div>
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Shared business metadata only; no payroll or staff records are rewritten.</span><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-designation">Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-designation">{pending ? 'Saving…' : record ? 'Save changes' : 'Save designation'}</button></div></div>
  </form>;
}
export default function DesignationFormPage({ id }) {
  const [path, navigate] = useLocation();
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => () => { pathRef.current = null; }, []);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [revision, setRevision] = useState(0);
  const snapshot = useRef(null);
  useEffect(() => {
    let alive = true;
    if (!id) return;
    setLoading(true);
    getDesignation(id).then((row) => {
      if (alive) { snapshot.current = row; setRecord(row); setError(''); }
    }).catch((cause) => { if (alive) setError(cause.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, revision]);
  const title = id ? 'Edit designation' : 'Add designation';

  async function refresh(values) {
    if (!id) {
      const result = await listDesignations({ query: values.name.trim(), status: 'all', limit: 100, offset: 0 });
      const sameName = result.items.find((row) => row.name.toLowerCase() === values.name.trim().replace(/\s+/g, ' ').toLowerCase());
      if (sameName) throw new Error(`A designation with this name is already saved: ${sameName.name}; short name ${sameName.shortName}; ${sameName.status}. Your draft is retained. Return to the list and inspect it instead of creating a duplicate.`);
      if (result.filtered > 100) throw new Error('More than 100 matching records. Narrow or inspect the list before retrying. Your draft is retained.');
      return null;
    }
    const current = await getDesignation(id);
    snapshot.current = current;
    return current;
  }
  async function save(values) {
    const startedPath = pathRef.current;
    await (id ? editDesignation(snapshot.current, values) : createDesignation(values));
    if (pathRef.current === startedPath) navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
  }

  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">User Management / Designation Master</p><h1>{title}</h1><p className="admin-page-head__description">Maintain designation names, short names and status in shared server records.</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-designations"><ArrowLeft size={16} aria-hidden="true" /> Back to designations</button></div>
    {loading ? <p role="status">Loading designation…</p> : error || (id && !record) ? <section className="admin-panel admin-category-form__recovery" role="alert"><h2>Designation could not be loaded</h2><p>{error || 'This designation may have been deleted.'}</p><button type="button" className="admin-button" onClick={() => setRevision((value) => value + 1)} data-testid="button-refresh-designation-form">Retry</button></section> : <section className="admin-panel" aria-label={title}><DesignationForm key={id || 'new'} record={record} onSave={save} onCancel={() => navigate(LIST_PATH)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}