import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Building2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { createHeadquarter, editHeadquarter, getHeadquarter, listHeadquarters, listZoneChoices } from '../../services/serverHeadquarters.js';
import { abbreviation, normalizeName, normalizeCode, validateHeadquarter, validateAreas, suggestCodes, areaPayload, newAreaRow, savedAreaRow, MAX_AREAS } from '../../services/headquarterCode.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../category.css';
import '../../headquarter.css';

const LIST = '/admin/masters/headquarters';
const empty = () => ({ zone_id: '', name: '', state_code: '', status: '' });
const zoneText = (z) => z ? `${z.name}${z.deleted ? ' (deleted)' : z.status && z.status !== 'active' ? ' (inactive)' : ''}` : 'No zone assigned';
const describe = (r) => <div className="admin-hq-review"><strong>Current server record</strong>
  <span>Zone: {zoneText(r.zone)}</span><span>HQ Name: {r.name}</span><span>State Code: {r.state_code}</span><span>Status: {r.status}</span>
  <span>Areas ({r.area_count ?? r.areas?.length ?? 0}); next sequence {r.next_area_sequence}:</span>
  {r.areas?.length ? <ul>{r.areas.map((a) => <li key={a.id}>{a.name} - {a.code}{a.sequence != null ? ` (seq ${a.sequence})` : ''}</li>)}</ul> : <span>No areas.</span>}</div>;

function ZonePicker({ value, record, onChange, invalid, disabled }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const gen = useRef(0);
  const mounted = useRef(true);
  const known = useRef(new Map());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gen.current += 1; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    const mine = ++gen.current;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      listZoneChoices({ query: query.trim(), limit: 100, offset: 0 }, controller.signal)
        .then((r) => { guard(); if (!controller.signal.aborted && gen.current === mine) { r.items.forEach((z) => known.current.set(z.id, z)); setItems(r.items); setTotal(r.total); } })
        .catch((c) => { try { guard(); } catch { return; } if (!controller.signal.aborted && gen.current === mine) setError(c.message); })
        .finally(() => { if (!controller.signal.aborted && gen.current === mine) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, tick]);
  async function more() {
    const guard = reportingIdentityGuard();
    const mine = gen.current;
    setLoading(true);
    try {
      const r = await listZoneChoices({ query: query.trim(), limit: 100, offset: items.length });
      guard();
      if (!mounted.current || gen.current !== mine) return;
      r.items.forEach((z) => known.current.set(z.id, z));
      setItems((cur) => [...cur, ...r.items.filter((x) => !cur.some((y) => y.id === x.id))]); setTotal(r.total);
    } catch (c) { try { guard(); } catch { return; } if (mounted.current && gen.current === mine) setError(c.message); } finally { if (mounted.current && gen.current === mine) setLoading(false); }
  }
  const current = value ? (known.current.get(value) || (record?.zone?.id === value ? record.zone : null)) : null;
  const keep = current && !items.some((x) => x.id === current.id) ? current : null;
  return <div className="admin-hq-zone-picker">
    <input className="mr-form__control" type="search" maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search active zones" aria-label="Search zones" disabled={disabled} />
    <select id="headquarter-zone" className="mr-form__control" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} disabled={disabled} data-testid="select-headquarter-zone">
      <option value="" disabled>{loading && !items.length ? 'Loading zones…' : 'Select zone'}</option>
      {keep && <option value={keep.id}>{zoneText(keep)} - currently assigned</option>}
      {items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
    </select>
    <span className="admin-hq-area__hint" role="status">Showing {items.length} of {total} active zones{loading ? '…' : ''}</span>
    {items.length < total && <button type="button" className="admin-button admin-button--secondary" disabled={loading || disabled} onClick={more}>Load more zones</button>}
    {error && <p className="mr-form__error" role="alert">{error} <button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((v) => v + 1)}>Retry</button></p>}
  </div>;
}

function HeadquarterForm({ record, onSave, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? { zone_id: record.zone?.id || record.zone_id || '', name: record.name, state_code: record.state_code, status: record.status } : empty());
  const [rows, setRows] = useState(() => record ? (record.areas || []).map(savedAreaRow) : []);
  const [base, setBase] = useState(record?.next_area_sequence || 1);
  const [automatic, setAutomatic] = useState(!record);
  const [errors, setErrors] = useState({});
  const [areaErrors, setAreaErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [review, setReview] = useState(null);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const suggestions = useMemo(() => suggestCodes(rows, values.state_code, base), [rows, values.state_code, base]);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) { setValues(empty()); setRows([]); setServerError(''); setReview(null); setErrors({}); setAreaErrors({}); }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  function update(field, value) {
    if (field === 'state_code') setAutomatic(false);
    setValues((current) => ({ ...current, [field]: value,
      ...(field === 'name' && automatic ? { state_code: abbreviation(value) } : {}) }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (!blocked) setServerError('');
  }
  const patchRow = (key, patch) => { setRows((cur) => cur.map((r) => r.key === key ? { ...r, ...patch } : r)); setAreaErrors((c) => ({ ...c, [key]: undefined })); if (!blocked) setServerError(''); };
  const addRow = () => setRows((cur) => cur.length >= MAX_AREAS ? cur : [...cur, newAreaRow()]);
  const removeRow = (key) => setRows((cur) => cur.filter((r) => r.key !== key));
  function regenerate() { setAutomatic(true); update('state_code', abbreviation(values.name)); setAutomatic(true); }
  const staleRows = rows.filter((r) => r.removedOnServer);
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const nextErrors = validateHeadquarter(values);
    if (!values.zone_id) nextErrors.zone_id = 'Select a zone.';
    const live = rows.filter((r) => !r.removedOnServer);
    const rowErrors = validateAreas(live, suggestions);
    setErrors(nextErrors); setAreaErrors(rowErrors);
    if (staleRows.length) { setServerError('Some saved areas were removed on the server. Discard them or re-add them as new areas before saving.'); return; }
    if (Object.keys(nextErrors).length || Object.keys(rowErrors).length) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true); setServerError('');
    try {
      await onSave({ zone_id: values.zone_id, name: normalizeName(values.name), state_code: normalizeCode(values.state_code), status: values.status, areas: areaPayload(live, suggestions) });
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) {
        for (const [field, message] of Object.entries(cause.fields || {})) {
          const match = /^areas\.(\d+)\.(?:name|code|id)$/.exec(field);
          if (match && live[Number(match[1])]) setAreaErrors((current) => ({ ...current, [live[Number(match[1])].key]: message }));
          else if (field === 'areas') setAreaErrors((current) => ({ ...current, _: message }));
          else setErrors((current) => ({ ...current, [field]: message }));
        }
        setServerError(cause.message); setBlocked(cause.code === 'headquarter_stale' || Boolean(cause.ambiguous) || cause.code === 'not_found');
      }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function reconcile() {
    if (busy.current) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true);
    try {
      const result = await onRefresh(values); guard();
      if (!alive.current) return;
      const current = result.record;
      if (result.kind === 'current') {
        const ids = new Set((current.areas || []).map((a) => a.id));
        setRows((cur) => cur.map((r) => r.id && !ids.has(r.id) ? { ...r, removedOnServer: true } : r));
        setBase((b) => Math.max(b, current.next_area_sequence || 1));
        setServerError('The server record has changed or the outcome is uncertain. Review the full current details below. Your draft is retained.');
      } else if (result.kind === 'existing') {
        setServerError('A headquarter with this name already exists. Creating another is blocked. Your draft is retained.');
      } else {
        setServerError('No matching record exists on the server. Your draft is retained; acknowledge before retrying.');
      }
      setReview(result);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setServerError(cause.message);
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  function acknowledge() { setReview(null); setBlocked(false); setServerError(''); }
  const ackOpen = review && review.kind !== 'existing';
  return <form className="admin-category-form admin-hq-form" onSubmit={submit} noValidate>
    <div className="admin-category-form__intro"><div><h2>Headquarter details</h2><p>Fields marked * are required. Records are shared on the server.</p></div><Building2 size={21} /></div>
    <div className="mr-form__body">
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p>
        {review?.record && describe(review.record)}
        {review?.kind === 'existing' ? <><button type="button" className="admin-button" onClick={onCancel}>Return to list to inspect it</button></>
          : !review && <button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={reconcile}><RefreshCw size={16} /> Review current server details (keep draft)</button>}</div>}
      <div className="mr-form__grid">
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-zone">Zone *</label><ZonePicker value={values.zone_id} record={record} onChange={(v) => update('zone_id', v)} invalid={Boolean(errors.zone_id)} disabled={pending} />{errors.zone_id && <p className="mr-form__error" role="alert">{errors.zone_id}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-name">HQ Name *</label><input id="headquarter-name" className="mr-form__control" value={values.name} onChange={(event) => update('name', event.target.value)} disabled={pending} placeholder="e.g. North Mumbai" aria-invalid={Boolean(errors.name)} data-testid="input-headquarter-name" />{errors.name && <p className="mr-form__error" role="alert">{errors.name}</p>}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-state-code">State Code *</label><input id="headquarter-state-code" className="mr-form__control admin-hq-code-input" value={values.state_code} onChange={(event) => update('state_code', event.target.value.toUpperCase())} disabled={pending} aria-invalid={Boolean(errors.state_code)} data-testid="input-headquarter-state-code" />
          <button type="button" className="admin-button admin-button--secondary" onClick={regenerate} disabled={pending}><RefreshCw size={16} /> Regenerate from HQ name</button>
          {errors.state_code && <p className="mr-form__error" role="alert">{errors.state_code}</p>}
        </div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="headquarter-status">Status *</label><select id="headquarter-status" className="mr-form__control" value={values.status} onChange={(event) => update('status', event.target.value)} disabled={pending} aria-invalid={Boolean(errors.status)} data-testid="select-headquarter-status"><option value="" disabled>Select status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>{errors.status && <p className="mr-form__error" role="alert">{errors.status}</p>}</div>
      </div>
      <fieldset className="admin-hq-areas" aria-label="Areas" disabled={pending} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="admin-hq-areas__head"><h3>Areas ({rows.length}/{MAX_AREAS})</h3><button type="button" className="admin-button admin-button--secondary" onClick={addRow} disabled={pending || rows.length >= MAX_AREAS}><Plus size={16} /> Add area</button></div>
        {areaErrors._ && <p className="mr-form__error" role="alert">{areaErrors._}</p>}
        {!rows.length && <p className="admin-hq-area__hint">No areas. Areas are optional.</p>}
        {rows.map((row, i) => {
          const auto = !row.id && !row.manual;
          return <div className="admin-hq-area" key={row.key}>
            <input className="mr-form__control" value={row.name} onChange={(e) => patchRow(row.key, { name: e.target.value })} placeholder="Area name" aria-label={`Area ${i + 1} name`} aria-invalid={Boolean(areaErrors[row.key])} disabled={row.removedOnServer} />
            <div><input className="mr-form__control admin-hq-code-input" value={auto ? suggestions[row.key] || '' : row.code} onChange={(e) => patchRow(row.key, { code: e.target.value.toUpperCase(), manual: true })} placeholder="Code" aria-label={`Area ${i + 1} code`} aria-invalid={Boolean(areaErrors[row.key])} disabled={row.removedOnServer} />
              {auto && <span className="admin-hq-area__hint">Suggested; assigned by server</span>}</div>
            <button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Remove area ${i + 1}`} onClick={() => removeRow(row.key)}><Trash2 size={16} /></button>
            {row.removedOnServer && <p className="mr-form__error admin-hq-area__error" role="alert">This saved area was removed on the server. <button type="button" className="admin-button admin-button--secondary" onClick={() => patchRow(row.key, { id: null, manual: true, removedOnServer: false })}>Re-add as new area</button> or remove the row.</p>}
            {areaErrors[row.key] && <p className="mr-form__error admin-hq-area__error" role="alert">{areaErrors[row.key]}</p>}
          </div>;
        })}
      </fieldset>
    </div>
    <div className="mr-form__footer"><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel}>Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-headquarter">{pending ? 'Saving…' : record ? 'Save changes' : 'Save headquarter'}</button></div></div>
    {ackOpen && <ConfirmationDialog title="Save draft over reviewed version?" description={review.kind === 'current' ? 'Retrying will save your entire retained HQ, zone and area draft over the current server version you just reviewed. Server values you have not copied into the draft will be replaced.' : 'No matching record exists. Retrying will create a new headquarter from your entire retained HQ, zone and area draft.'} actionLabel="Acknowledge and continue" onConfirm={acknowledge} onClose={() => setReview(null)} />}
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
      if (same) return { kind: 'existing', record: await getHeadquarter(same.id) };
      if (result.filtered > 100) throw new Error('More than 100 matches. Inspect the list before retrying.');
      return { kind: 'none', record: null };
    }
    const current = await getHeadquarter(id);
    snapshot.current = current;
    return { kind: 'current', record: current };
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
