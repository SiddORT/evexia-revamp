import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Building2, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { createHeadquarter, editHeadquarter, getHeadquarter, listHeadquarters } from '../../services/serverHeadquarters.js';
import { abbreviation, normalizeName, normalizeCode, validateHeadquarter } from '../../services/headquarterCode.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../category.css';
import '../../headquarter.css';

const LIST = '/admin/masters/headquarters';
const empty = () => ({ name: '', state_code: '', status: '' });

function HeadquarterForm({ record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? { name: record.name, state_code: record.state_code, status: record.status } : empty());
  const [automatic, setAutomatic] = useState(!record);
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
    if (field === 'state_code') setAutomatic(false);
    setValues((current) => ({ ...current, [field]: value,
      ...(field === 'name' && automatic ? { state_code: abbreviation(value) } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    // Keep uncertain/conflicting outcome visible until authoritative reconciliation.
    if (!blocked) setServerError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const nextErrors = validateHeadquarter(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true); setServerError('');
    try {
      await onSave({ name: normalizeName(values.name), state_code: normalizeCode(values.state_code), status: values.status });
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) { setServerError(cause.message); setBlocked(cause.code === 'headquarter_stale' || Boolean(cause.ambiguous) || cause.code === 'not_found'); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function reconcile() {
    if (busy.current) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true);
    try {
      const current = await onRefresh(values); guard();
      if (!alive.current) return;
      setServerError(current ? `Current server record: ${current.name}; ${current.state_code}; ${current.status}. Your draft is retained. Compare these details before saving again.` : 'No matching record exists. Your draft is retained; review before retrying.');
      setBlocked(false);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setServerError(cause.message);
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  return <form className="admin-category-form admin-hq-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Headquarter details</h2><p>Fields marked * are required. Records are shared on the server.</p></div><Building2 size={21} /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={reconcile}><RefreshCw size={16} /> Review current server details (keep draft)</button></div>}
      <div className="mr-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-name">HQ Name *</label><input id="headquarter-name" className="mr-form__control" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. North Mumbai" aria-invalid={Boolean(errors.name)} data-testid="input-headquarter-name" />{errors.name && <p className="mr-form__error" role="alert">{errors.name}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-state-code">State Code *</label><input id="headquarter-state-code" className="mr-form__control admin-hq-code-input" value={values.state_code} onChange={(event) => update('state_code', event.target.value.toUpperCase())} aria-invalid={Boolean(errors.state_code)} data-testid="input-headquarter-state-code" />
          {errors.state_code && <p className="mr-form__error" role="alert">{errors.state_code}</p>}
        </div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-status">Status *</label><select id="headquarter-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} aria-invalid={Boolean(errors.status)} data-testid="select-headquarter-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" role="alert">{errors.status}</p>}</div>
      </div>
    </div>
    <div className="mr-form__footer"><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-headquarter">{pending ? 'Saving…' : record ? 'Save changes' : 'Save headquarter'}</button></div></div>
  </form>;
}

export default function HeadquarterFormPage({ id }) {
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
    getHeadquarter(id).then((row) => { guard(); if (active) { snapshot.current = row; setRecord(row); setError(''); } })
      .catch((cause) => { try { guard(); } catch { return; } if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, revision]);
  async function refresh(values) {
    if (!id) {
      const result = await listHeadquarters({ query: normalizeName(values.name), status: 'all', limit: 100, offset: 0 });
      const same = result.items.find((row) => normalizeName(row.name).toLowerCase() === normalizeName(values.name).toLowerCase());
      if (same) throw new Error(`A headquarter with this name is already saved: ${same.name}; ${same.state_code}; ${same.status}. Your draft is retained. Return to the list and inspect it instead of creating a duplicate.`);
      if (result.filtered > 100) throw new Error('More than 100 matches. Inspect the list before retrying.');
      return null;
    }
    const current = await getHeadquarter(id);
    snapshot.current = current;
    return current;
  }
  async function save(values) {
    const guard = reportingIdentityGuard();
    await (id ? editHeadquarter(snapshot.current, values) : createHeadquarter(values));
    guard();
    if (alive.current) navigate(`${LIST}?saved=${id ? 'updated' : 'added'}`);
  }
  const title = id ? 'Edit headquarter' : 'Add headquarter';
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Directory / Headquarter Master</p><h1>{title}</h1><p className="admin-page-head__description">Manage a shared headquarter’s name, code and availability.</p></div><button className="admin-button admin-button--secondary" onClick={() => navigate(LIST)}><ArrowLeft size={16} /> Back to headquarters</button></div>
    {loading ? <p role="status">Loading headquarter…</p> : error || (id && !record) ? <section className="admin-panel" role="alert"><h2>Headquarter could not be loaded</h2><p>{error || 'This headquarter may have been deleted.'}</p><button className="admin-button" onClick={() => setRevision((value) => value + 1)}>Retry</button></section> : <section className="admin-panel" aria-label={title}><HeadquarterForm key={id || 'new'} record={record} onSave={save} onCancel={() => navigate(LIST)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}
