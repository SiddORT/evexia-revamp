import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, BriefcaseBusiness, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import useDesignations from '../../hooks/useDesignations.js';
import { DESIGNATION_COLUMNS, validateDesignation } from '../../services/designations.js';
import '../../mr.css';
import '../../category.css';
import '../../designation.css';

const LIST_PATH = '/admin/masters/designations';
const empty = { name: '', shortName: '', level: '', status: '', basicDa: '0', hra: '0', medicalAllowance: '0', travellingAllowance: '0', specialAllowance: '0', professionalTax: '0' };

function DesignationForm({ record, records, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? Object.fromEntries(DESIGNATION_COLUMNS.map(([key]) => [key, String(record[key])])) : empty);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setServerError('');
  }
  function submit(event) {
    event.preventDefault();
    const result = validateDesignation(values, records, record?.id);
    setErrors(result.errors);
    setServerError('');
    if (Object.keys(result.errors).length) return;
    try {
      const saved = onSave(result.fields);
      if (!saved.success) setServerError(saved.error || 'Designation could not be saved. Refresh records and try again.');
    } catch (cause) { setServerError(cause.message || 'Designation could not be saved.'); }
  }
  return <form className="admin-category-form admin-designation-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Designation details</h2><p>Fields marked * are required. Allowances and tax default to zero; records stay in this browser.</p></div><BriefcaseBusiness size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-designation-error"><RefreshCw size={16} aria-hidden="true" /> Refresh records and discard draft</button></div>}
      <div className="mr-form__grid admin-designation-grid">
        {DESIGNATION_COLUMNS.map(([key, label]) => <div className="mr-form__field" key={key}>
          <label className="mr-form__label" htmlFor={`designation-${key}`}>{label}{['name', 'shortName', 'level', 'status'].includes(key) && <> <span className="mr-form__required">*</span></>}</label>
          {key === 'status' ? <select id={`designation-${key}`} className="mr-form__control" value={values[key]} onChange={(event) => update(key, event.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `designation-${key}-error` : undefined} data-testid="select-designation-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
            : <input id={`designation-${key}`} className="mr-form__control" type={key === 'name' || key === 'shortName' ? 'text' : 'number'} min={key === 'level' ? '1' : '0'} step={key === 'level' ? '1' : 'any'} value={values[key]} onChange={(event) => update(key, event.target.value)} placeholder={key === 'name' ? 'Designation Name' : key === 'shortName' ? 'Short name' : key === 'level' ? 'Level' : '0'} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `designation-${key}-error` : undefined} data-testid={`input-designation-${key}`} />}
          {errors[key] && <p className="mr-form__error" id={`designation-${key}-error`} role="alert">{errors[key]}</p>}
        </div>)}
      </div>
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Changes stay in this browser; no payroll or employee records are updated.</span><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-designation">Cancel</button><button type="submit" className="admin-button" data-testid="button-save-designation">{record ? 'Save changes' : 'Save designation'}</button></div></div>
  </form>;
}
export default function DesignationFormPage({ id }) {
  const [, navigate] = useLocation();
  const { records, error, retry, add, edit } = useDesignations();
  const [revision, setRevision] = useState(0);
  const record = id ? records.find((item) => item.id === id) : null;
  const title = id ? 'Edit designation' : 'Add designation';
  function refresh() { retry(); setRevision((value) => value + 1); }
  function save(values) {
    const result = id ? edit(id, values) : add(values);
    if (result.success) navigate(`${LIST_PATH}?saved=${id ? 'updated' : 'added'}`);
    return result;
  }
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / People / Designation Master</p><h1>{title}</h1><p className="admin-page-head__description">Maintain levels, allowance percentages and professional tax.</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)} data-testid="button-back-designations"><ArrowLeft size={16} aria-hidden="true" /> Back to designations</button></div>
    {error || (id && !record) ? <section className="admin-panel admin-category-form__recovery" role="alert"><h2>{error ? 'Designations could not be loaded' : 'Designation not found'}</h2><p>{error || 'Refresh the latest records or return to Designation Master.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST_PATH)}>Return to designations</button><button type="button" className="admin-button" onClick={refresh} data-testid="button-refresh-designation-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button></div></section> : <section className="admin-panel" aria-label={title}><DesignationForm key={`${id || 'new'}-${revision}`} record={record} records={records} onSave={save} onCancel={() => navigate(LIST_PATH)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}