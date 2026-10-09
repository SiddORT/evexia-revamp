import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Landmark, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp } from '../../components/admin/adminPreferences.js';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import OpeningBalanceDoctorSelect from '../../components/admin/OpeningBalanceDoctorSelect.jsx';
import { createOpeningBalance, editOpeningBalance, getOpeningBalance } from '../../services/serverOpeningBalances.js';
import { validateBalance, formatBalance } from '../../services/openingBalanceValidation.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../category.css';
import '../../openingBalance.css';

const PATH = '/admin/masters/opening-balances';
const empty = () => ({ startYear: String(new Date().getFullYear()), endYear: String(new Date().getFullYear() + 1), doctorId: '', amount: '', status: 'active' });
const fields = (row) => Object.fromEntries(['startYear', 'endYear', 'doctorId', 'amount', 'status'].map((k) => [k, String(row[k])]));
const option = (year) => ({ value: String(year), label: String(year) });

function YearField({ field, values, errors, onChange, disabled }) {
  const start = field === 'startYear';
  const low = start ? 1900 : 1901, high = start ? 9998 : 9999;
  const current = new Date().getFullYear();
  const rolling = Array.from({ length: 71 }, (_, i) => current + 30 - i).filter((y) => y >= low && y <= high);
  const saved = Number(values[field]);
  if (saved >= low && saved <= high && !rolling.includes(saved)) rolling.unshift(saved);
  const options = rolling.map(option);
  function search(query) {
    const term = query.trim();
    if (!term) return options;
    if (!/^\d{1,4}$/.test(term)) return [];
    // Bound the rendered results, not the valid year range; exact old years remain searchable.
    const result = [];
    for (let year = low; year <= high && result.length < 100; year++) if (String(year).includes(term)) result.push(option(year));
    return result;
  }
  const id = `opening-balance-${start ? 'start' : 'end'}-year`;
  return <div className="mr-form__field"><label className="mr-form__label" htmlFor={id}>Financial {start ? 'start' : 'end'} year *</label>
    <SearchableSelect id={id} label={`Financial ${start ? 'start' : 'end'} year`} value={values[field]} options={options} searchOptions={search} onChange={(value) => onChange(field, value)} placeholder="Search numeric year" invalid={Boolean(errors[field])} describedBy={errors[field] ? `${id}-error` : undefined} disabled={disabled} />
    {!start && <p className="ob-form__hint">Follows start year + 1; a different selection must be corrected before saving.</p>}
    {errors[field] && <p className="mr-form__error" id={`${id}-error`} role="alert">{errors[field]}</p>}
  </div>;
}

function BalanceForm({ record, onSave, onCancel, onReload }) {
  const [values, setValues] = useState(() => record ? fields(record) : empty());
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsub = subscribeSession(() => { if (getSession().user?.id !== owner) { setValues(empty()); setMessage(''); setErrors({}); } });
    return () => { alive.current = false; unsub(); };
  }, []);
  function update(field, value) {
    setValues((old) => ({ ...old, [field]: value, ...(field === 'startYear' ? { endYear: value ? String(Number(value) + 1) : '' } : {}) }));
    setErrors((old) => ({ ...old, [field]: undefined, ...(field === 'startYear' ? { endYear: undefined } : {}) }));
    if (!blocked) setMessage('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const errors = validateBalance(values);
    setErrors(errors);
    if (Object.keys(errors).length) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true); setMessage('');
    try { await onSave({ ...values, startYear: +values.startYear, endYear: +values.endYear, amount: values.amount.trim() }); }
    catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) { setMessage(cause.message); setBlocked(cause.code === 'opening_balance_stale' || cause.code === 'not_found' || Boolean(cause.ambiguous)); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function reload() {
    if (busy.current) return;
    if (!window.confirm('Discard this draft and load current server details? If a save outcome was uncertain, inspect the list first.')) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true);
    try {
      const current = await onReload(); guard();
      if (alive.current) { setValues(current ? fields(current) : empty()); setErrors({}); setMessage('Current server details loaded.'); setBlocked(false); }
    } catch (cause) { try { guard(); } catch { return; } if (alive.current) setMessage(cause.message); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  return <form className="admin-category-form ob-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Financial year details</h2><p>One balance per Doctor/year. Negative amounts indicate a credit position; zero is allowed.</p></div><Landmark size={21} /></div>
    <div className="mr-form__body">
      {message && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{message}</p><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={reload}><RefreshCw size={16} /> Reload current details and discard draft</button><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel}>Inspect shared records</button></div>}
      <fieldset disabled={pending}><div className="ob-form__grid">
        <YearField field="startYear" values={values} errors={errors} onChange={update} disabled={pending} />
        <YearField field="endYear" values={values} errors={errors} onChange={update} disabled={pending} />
        <OpeningBalanceDoctorSelect value={values.doctorId} record={record} disabled={pending} error={errors.doctorId} onChange={(v) => update('doctorId', v)} />
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="ob-amount">Opening balance *</label><input id="ob-amount" className="mr-form__control" inputMode="decimal" value={values.amount} onChange={(e) => update('amount', e.target.value)} aria-invalid={Boolean(errors.amount)} aria-describedby="ob-amount-help" data-testid="input-opening-balance-amount" /><p id="ob-amount-help" className={errors.amount ? 'mr-form__error' : 'ob-form__hint'} role={errors.amount ? 'alert' : undefined}>{errors.amount || 'Signed plain decimal within ±9999999999999.99; at most two decimal places. Never rounded.'}</p></div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="ob-form-status">Status *</label><select id="ob-form-status" className="mr-form__control" value={values.status} onChange={(e) => update('status', e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></fieldset>
      {record && <div className="ob-form__audit"><span>Created by <strong>{record.createdBy}</strong> · {formatAdminTimestamp(record.createdAt)}</span><span>Updated by <strong>{record.updatedBy}</strong> · {formatAdminTimestamp(record.updatedAt)}</span><span>Saved amount: {formatBalance(record.amount)}</span></div>}
    </div>
    <div className="mr-form__footer"><span className="mr-form__footer-note">Saving does not post ledger entries. Same-identity renewal retains this in-memory draft.</span><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-opening-balance">{pending ? 'Saving…' : record ? 'Save changes' : 'Save opening balance'}</button></div></div>
  </form>;
}

export default function OpeningBalanceFormPage({ id }) {
  const [, navigate] = useLocation();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const snapshot = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsub = subscribeSession(() => { if (getSession().user?.id !== owner) { snapshot.current = null; setRecord(null); setError(''); } });
    return () => { alive.current = false; unsub(); };
  }, []);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoading(true);
    getOpeningBalance(id, controller.signal).then((row) => { guard(); if (!controller.signal.aborted) { snapshot.current = row; setRecord(row); setError(''); } })
      .catch((cause) => { try { guard(); } catch { return; } if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted && alive.current) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);
  async function save(values) {
    const guard = reportingIdentityGuard();
    await (id ? editOpeningBalance(snapshot.current, values) : createOpeningBalance(values));
    guard(); if (alive.current) navigate(`${PATH}?saved=${id ? 'updated' : 'added'}`);
  }
  async function reload() {
    if (!id) throw new Error('For an uncertain create, inspect the shared list before discarding or retrying this draft.');
    const guard = reportingIdentityGuard();
    const row = await getOpeningBalance(id); guard();
    if (alive.current) { snapshot.current = row; setRecord(row); }
    return row;
  }
  const title = id ? 'Edit opening balance' : 'Add opening balance';
  return <AdminLayout title={title}><div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Finance / Opening Balance Master</p><h1>{title}</h1><p className="admin-page-head__description">Assign a shared Doctor’s starting position to one financial year.</p></div><button className="admin-button admin-button--secondary" onClick={() => navigate(PATH)}><ArrowLeft size={16} /> Back to balances</button></div>
    {loading ? <p role="status">Loading opening balance…</p> : error || id && !record ? <section className="admin-panel" role="alert"><h2>Opening balance could not be loaded</h2><p>{error || 'Record unavailable.'}</p><button className="admin-button" onClick={() => setRevision((n) => n + 1)}>Retry</button></section> : <section className="admin-panel ob-form-panel"><BalanceForm key={id || 'new'} record={record} onSave={save} onCancel={() => navigate(PATH)} onReload={reload} /></section>}
  </AdminLayout>;
}
