import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Landmark, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { DOCTOR_STORAGE_KEY } from '../../services/doctors.js';
import { OPENING_BALANCE_KEY, createOpeningBalance, loadOpeningBalanceSnapshots, updateOpeningBalance, validateOpeningBalance } from '../../services/openingBalances.js';
import '../../mr.css';
import '../../category.css';
import '../../openingBalance.css';

const PATH = '/admin/masters/opening-balances';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const currentYear = new Date().getFullYear();
function BalanceForm({ record, snapshot, onSave, onCancel, onRefresh, stale }) {
  const [values, setValues] = useState(() => record ? {
    startYear: String(record.startYear), endYear: String(record.endYear), doctorId: record.doctorId, amount: String(record.amount), status: record.status,
  } : { startYear: String(currentYear), endYear: String(currentYear + 1), doctorId: '', amount: '', status: 'active' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const doctorExists = snapshot.doctors.some((doctor) => doctor.id === values.doctorId);
  function update(field, value) {
    setValues((previous) => ({ ...previous, [field]: value, ...(field === 'startYear' && /^\d{4}$/.test(value) ? { endYear: String(Number(value) + 1) } : {}) }));
    setErrors((previous) => ({ ...previous, [field]: undefined, ...(field === 'startYear' ? { endYear: undefined } : {}) }));
    setMessage('');
  }
  function submit(event) {
    event.preventDefault();
    if (stale) { setMessage('Records changed in another tab. Refresh and review this form before saving.'); return; }
    const result = validateOpeningBalance(values, snapshot.records, snapshot.doctors, record?.id);
    setErrors(result.errors || {});
    setMessage(result.errors?.form || '');
    if (Object.keys(result.errors || {}).length) return;
    try { onSave(result.fields); }
    catch (cause) { setMessage(cause.message || 'Opening balance could not be saved. Refresh records before trying again.'); }
  }
  const maxYear = currentYear + 30;
  const years = Array.from({ length: 71 }, (_, index) => maxYear - index);
  return <form className="admin-category-form ob-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Financial year details</h2><p>One balance per doctor per financial year. A negative amount indicates a credit position; zero is allowed.</p></div><Landmark size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {(stale || message) && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{message || 'Opening balances or doctors changed in another tab. Refresh and review this form before saving.'}</p><button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} data-testid="button-refresh-opening-balance-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records and discard draft</button></div>}
      <div className="ob-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="ob-start">Financial start year <span className="mr-form__required">*</span></label><select id="ob-start" className="mr-form__control" value={values.startYear} onChange={(event) => update('startYear', event.target.value)} aria-invalid={Boolean(errors.startYear)} aria-describedby={errors.startYear ? 'ob-start-error' : undefined} data-testid="select-opening-balance-start-year">{!years.includes(Number(values.startYear)) && <option value={values.startYear}>{values.startYear}</option>}{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>{errors.startYear && <p className="mr-form__error" id="ob-start-error" role="alert">{errors.startYear}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="ob-end">Financial end year <span className="mr-form__required">*</span></label><select id="ob-end" className="mr-form__control" value={values.endYear} onChange={(event) => update('endYear', event.target.value)} aria-invalid={Boolean(errors.endYear)} aria-describedby={errors.endYear ? 'ob-end-error' : undefined} data-testid="select-opening-balance-end-year">{!years.includes(Number(values.endYear)) && <option value={values.endYear}>{values.endYear}</option>}{[Number(values.startYear) + 1, ...years.filter((year) => year !== Number(values.startYear) + 1)].map((year) => <option key={year} value={year}>{year}</option>)}</select><p className="ob-form__hint">Automatically follows the start year.</p>{errors.endYear && <p className="mr-form__error" id="ob-end-error" role="alert">{errors.endYear}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="ob-doctor">Doctor <span className="mr-form__required">*</span></label><select id="ob-doctor" className="mr-form__control" value={values.doctorId} onChange={(event) => update('doctorId', event.target.value)} aria-invalid={Boolean(errors.doctorId)} aria-describedby={errors.doctorId ? 'ob-doctor-error' : undefined} data-testid="select-opening-balance-doctor"><option value="">Select doctor</option>{values.doctorId && !doctorExists && <option value={values.doctorId}>Missing doctor · {values.doctorId}</option>}{snapshot.doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}{doctor.registrationNumber ? ` · ${doctor.registrationNumber}` : ''}</option>)}</select>{!snapshot.doctors.length && <p className="ob-form__hint">No doctors are available. Add a doctor in Doctor Master first.</p>}{values.doctorId && !doctorExists && <p className="mr-form__error" role="alert">This doctor no longer exists in Doctor Master. Select an available doctor.</p>}{errors.doctorId && <p className="mr-form__error" id="ob-doctor-error" role="alert">{errors.doctorId}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="ob-amount">Opening balance <span className="mr-form__required">*</span></label><input id="ob-amount" className="mr-form__control" type="number" inputMode="decimal" step="any" value={values.amount} onChange={(event) => update('amount', event.target.value)} placeholder="e.g. -8800.00 or 34881.00" aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'ob-amount-error' : undefined} data-testid="input-opening-balance-amount" /><p className="ob-form__hint">Enter a signed amount; no currency symbol or separators.</p>{errors.amount && <p className="mr-form__error" id="ob-amount-error" role="alert">{errors.amount}</p>}</div>
      </div>
      {record && <div className="ob-form__audit"><span>Created by <strong>{record.createdBy || '—'}</strong> · {record.createdAt ? new Date(record.createdAt).toLocaleString('en-IN') : '—'}</span><span>Last updated by <strong>{record.updatedBy || '—'}</strong> · {record.updatedAt ? new Date(record.updatedAt).toLocaleString('en-IN') : '—'}</span><span>Status <strong>{record.status}</strong></span></div>}
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Preview only · saving does not post to a ledger.</span><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-opening-balance">Cancel</button><button type="submit" className="admin-button" disabled={stale} data-testid="button-save-opening-balance">{record ? 'Save changes' : 'Save opening balance'}</button></div></div>
  </form>;
}
export default function OpeningBalanceFormPage({ id }) {
  const [, navigate] = useLocation();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    function onStorage(event) { if (event.key === OPENING_BALANCE_KEY || event.key === DOCTOR_STORAGE_KEY || event.key === null) setStale(true); }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  function refresh() {
    try { setSnapshot(loadOpeningBalanceSnapshots()); setError(''); setStale(false); setRevision((value) => value + 1); }
    catch (cause) { setSnapshot(null); setError(cause.message || 'Opening balances could not be loaded.'); setStale(true); }
  }
  useEffect(() => { refresh(); }, [id]);
  function save(fields) {
    if (!snapshot || stale) throw new Error('Records changed. Refresh before saving.');
    const current = loadOpeningBalanceSnapshots();
    if (!same(current.records, snapshot.records) || !same(current.doctors, snapshot.doctors)) { setStale(true); throw new Error('Opening balances or doctors changed in another tab. Refresh and review before saving.'); }
    if (id) updateOpeningBalance(snapshot.records, snapshot.doctors, id, fields);
    else createOpeningBalance(snapshot.records, snapshot.doctors, fields);
    navigate(`${PATH}?saved=${id ? 'updated' : 'added'}`);
  }
  const record = id ? snapshot?.records.find((item) => item.id === id) : null;
  const title = id ? 'Edit opening balance' : 'Add opening balance';
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Finance / Opening Balance Master</p><h1>{title}</h1><p className="admin-page-head__description">Assign a doctor’s starting position to one financial year.</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(PATH)} data-testid="button-back-opening-balances"><ArrowLeft size={16} aria-hidden="true" /> Back to balances</button></div>
    {error || (snapshot && id && !record) ? <section className="admin-panel admin-category-form__recovery" role="alert"><h2>{error ? 'Balances could not be loaded' : 'Opening balance not found'}</h2><p>{error || 'This record may have changed or been removed in another tab.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(PATH)}>Return to balances</button><button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-opening-balance-form"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button></div></section> : snapshot ? <section className="admin-panel" aria-label={title}><BalanceForm key={`${id || 'new'}-${revision}`} record={record} snapshot={snapshot} onSave={save} onCancel={() => navigate(PATH)} onRefresh={refresh} stale={stale} /></section> : <section className="admin-panel" role="status" aria-label="Loading opening balance form">{[0, 1, 2].map((n) => <div key={n} className="ob-skeleton" />)}</section>}
  </AdminLayout>;
}