import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { reportingRequest } from '../../auth/adminSession.js';
import '../../activityLogs.css';

const PAGE = 25;
const USER_PAGE = 8;
const DAY = 86400000;
const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
};
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const who = (u) => (u && typeof u === 'object' && u.label ? u.label : 'Unknown/System');
const errInfo = (e) => (e?.name === 'AbortError' ? null : { denied: [401, 403].includes(e?.status), message: [401, 403].includes(e?.status) ? 'Access to activity reporting was denied for this session.' : 'Activity data could not be loaded. Check your connection and retry.' });

function range(f) {
  for (const [key, label] of [['start', 'Start'], ['end', 'End']]) {
    const value = f[key];
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value ||
      value < '1970-01-01' || value > '2099-12-31')) {
      return { error: `${label} date must be a valid date between 1970 and 2099.` };
    }
  }
  if (f.start && f.end && f.end < f.start) return { error: 'End date cannot be before start date.' };
  const p = {};
  if (f.user) p.user_id = f.user.id;
  if (f.start) p.start = `${f.start}T00:00:00Z`;
  if (f.end) {
    const t = Date.parse(`${f.end}T00:00:00Z`);
    if (Number.isNaN(t)) return { error: 'End date is invalid.' };
    p.end = new Date(t + DAY).toISOString().replace('.000Z', 'Z');
  }
  if (f.start && Number.isNaN(Date.parse(`${f.start}T00:00:00Z`))) return { error: 'Start date is invalid.' };
  return { params: p };
}

function useReport(resource, params, enabled, identity) {
  const [offset, setOffset] = useState(0);
  const [s, setS] = useState({ loading: false, data: null, error: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(params);
  useEffect(() => { setOffset(0); }, [key, identity]);
  useEffect(() => {
    if (!enabled) { setS({ loading: false, data: null, error: null }); return undefined; }
    const ctl = new AbortController();
    setS((p) => ({ loading: true, data: null, error: null, prev: p.error }));
    reportingRequest(resource, { ...params, limit: PAGE, offset }, { signal: ctl.signal })
      .then((data) => { if (!ctl.signal.aborted) setS({ loading: false, data, error: null }); })
      .catch((e) => { const i = errInfo(e); if (i && !ctl.signal.aborted) setS({ loading: false, data: null, error: i }); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, key, offset, enabled, tick, identity]);
  return { ...s, offset, setOffset, reload: () => setTick((t) => t + 1) };
}

function UserPicker({ value, onChange, enabled, identity }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [off, setOff] = useState(0);
  const [s, setS] = useState({ loading: false, data: null, error: false });
  const [tick, setTick] = useState(0);
  useEffect(() => { setOff(0); }, [q]);
  useEffect(() => {
    if (!open || !enabled) return undefined;
    const ctl = new AbortController();
    setS({ loading: true, data: null, error: false });
    const t = setTimeout(() => {
      const params = { limit: USER_PAGE, offset: off };
      if (q.trim()) params.q = q.trim().slice(0, 100);
      reportingRequest('users', params, { signal: ctl.signal })
        .then((data) => { if (!ctl.signal.aborted) setS({ loading: false, data, error: false }); })
        .catch((e) => { if (errInfo(e) && !ctl.signal.aborted) setS({ loading: false, data: null, error: true }); });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [open, q, off, enabled, tick, identity]);
  useEffect(() => { if (!enabled) { setOpen(false); setQ(''); setOff(0); setS({ loading: false, data: null, error: false }); } }, [enabled, identity]);
  return (
    <div className="alog-picker">
      <button type="button" className="admin-select alog-picker__btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="button-activity-user">
        {value ? value.label : 'All users'}
      </button>
      {open && (
        <div className="alog-picker__pop" data-testid="panel-activity-users">
          <div className="admin-search"><Search size={15} aria-hidden="true" />
            <input type="search" aria-label="Search users" placeholder="Search users" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-activity-user-search" />
          </div>
          <ul className="alog-picker__list" aria-label="User results">
            <li><button type="button" onClick={() => { onChange(null); setOpen(false); }}>All users</button></li>
            {s.loading && <li className="alog-muted" role="status">Loading users…</li>}
            {s.error && <li className="alog-muted" role="alert">Users could not be loaded. <button type="button" onClick={() => setTick((t) => t + 1)}>Retry</button></li>}
            {s.data?.items?.length === 0 && <li className="alog-muted">No matching users.</li>}
            {s.data?.items?.map((u) => (
              <li key={u.id}><button type="button" onClick={() => { onChange(u); setOpen(false); }} data-testid="option-activity-user">
                <span>{u.label}</span><small>{dash(u.role)} · {dash(u.account_state)}</small></button></li>
            ))}
          </ul>
          <div className="alog-picker__nav">
            <button type="button" className="admin-button admin-button--secondary" disabled={off === 0 || s.loading} onClick={() => setOff(Math.max(0, off - USER_PAGE))}>Previous</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={!s.data?.has_more || s.loading || off + USER_PAGE > 10000} onClick={() => setOff(off + USER_PAGE)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pager({ r }) {
  const d = r.data;
  return (
    <div className="admin-panel__foot admin-pagination">
      <span>{d?.items?.length ? `Rows ${r.offset + 1}–${r.offset + d.items.length}` : 'No rows'}</span>
      <div className="admin-pagination__pages">
        <button type="button" aria-label="Previous page" disabled={r.offset === 0 || r.loading} onClick={() => r.setOffset(Math.max(0, r.offset - PAGE))}><ChevronLeft size={14} /></button>
        <button type="button" aria-label="Next page" disabled={!d?.has_more || r.loading || r.offset + PAGE > 10000} onClick={() => r.setOffset(r.offset + PAGE)}><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

function State({ r, empty, children, cols }) {
  if (r.loading) return <div className="admin-empty" role="status" aria-busy="true"><div className="alog-skel" /><div className="alog-skel" /><div className="alog-skel" /><p>Loading…</p></div>;
  if (r.error) return (
    <div className="admin-empty" role="alert"><div className="admin-empty__icon"><ShieldAlert size={20} /></div><strong>{r.error.denied ? 'Access denied' : 'Could not load'}</strong><p>{r.error.message}</p>
      {!r.error.denied && <button type="button" className="admin-button admin-button--secondary alog-retry" onClick={r.reload}>Retry</button>}</div>
  );
  if (!r.data) return null;
  if (!r.data.items?.length) return <div className="admin-empty"><div className="admin-empty__icon"><Activity size={20} /></div><strong>{empty}</strong><p>Adjust filters or date range.</p></div>;
  return <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Results"><table className="admin-table alog-table" data-cols={cols}>{children}</table></div>;
}

export default function ActivityLogs() {
  const session = useAdminSession();
  const enabled = session.status === 'authenticated';
  const identity = session.user?.id || session.user?.email || '';
  const [draft, setDraft] = useState({ user: null, start: '', end: '' });
  const [applied, setApplied] = useState({ user: null, start: '', end: '' });
  const [formError, setFormError] = useState('');
  const [view, setView] = useState('sessions');
  const [sum, setSum] = useState({ loading: false, data: null, error: null });
  const [sumTick, setSumTick] = useState(0);
  const checked = range(applied);
  const params = checked.params || {};
  const sessions = useReport('sessions', params, enabled && view === 'sessions', identity);
  const events = useReport('events', params, enabled && view === 'events', identity);
  const idRef = useRef(identity);

  useEffect(() => {
    if (idRef.current !== identity) {
      idRef.current = identity;
      setDraft({ user: null, start: '', end: '' }); setApplied({ user: null, start: '', end: '' }); setFormError('');
    }
  }, [identity]);

  useEffect(() => {
    if (!enabled) { setSum({ loading: false, data: null, error: null }); return undefined; }
    const ctl = new AbortController();
    setSum({ loading: true, data: null, error: null });
    reportingRequest('summary', {}, { signal: ctl.signal })
      .then((data) => { if (!ctl.signal.aborted) setSum({ loading: false, data, error: null }); })
      .catch((e) => { const i = errInfo(e); if (i && !ctl.signal.aborted) setSum({ loading: false, data: null, error: i }); });
    return () => ctl.abort();
  }, [enabled, identity, sumTick]);

  const apply = (e) => {
    e.preventDefault();
    const r = range(draft);
    if (r.error) { setFormError(r.error); return; }
    setFormError(''); setApplied(draft);
  };
  const reset = () => { const z = { user: null, start: '', end: '' }; setDraft(z); setApplied(z); setFormError(''); };
  const refreshAll = useCallback(() => { setSumTick((t) => t + 1); sessions.reload(); events.reload(); }, [sessions, events]);
  const cur = sum.data?.current_session;
  const active = view === 'sessions' ? sessions : events;

  if (!enabled) return null;
  return (
    <AdminLayout title="Sessions & Activity Logs">
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Read-only audit</p>
          <h1>Sessions &amp; Activity Logs</h1>
          <p className="admin-page-head__description">Only recorded server operations and authentication events are audited here. Clicks, page views and browser-local master edits are not logged. All times are UTC.</p>
          <p className="admin-page-head__description">Counts are global registered backend accounts, not browser-local staff, doctors or patients, and are unaffected by history filters.</p>
        </div>
        <button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={!enabled} data-testid="button-activity-refresh"><RefreshCw size={14} aria-hidden="true" /> Refresh all</button>
      </div>

      <section className="alog-stats" aria-label="Summary" data-testid="section-activity-summary">
        {sum.error ? (
          <div className="admin-feedback admin-feedback--error" role="alert">{sum.error.message} {!sum.error.denied && <button type="button" className="admin-button admin-button--secondary" onClick={() => setSumTick((t) => t + 1)}>Retry</button>}</div>
        ) : (<>
          <div className="admin-panel alog-stat"><span>Registered backend accounts</span><strong data-testid="text-total-users">{sum.loading || !sum.data ? '…' : sum.data.total_users}</strong><small>Includes disabled and unmapped</small></div>
          <div className="admin-panel alog-stat"><span>Users with valid sessions</span><strong data-testid="text-active-users">{sum.loading || !sum.data ? '…' : sum.data.active_users}</strong><small>Distinct users, not live presence</small></div>
          <div className="admin-panel alog-stat"><span>Summary refreshed</span><strong className="alog-stat__time">{sum.loading ? '…' : fmt(sum.data?.refreshed_at)}</strong></div>
          <div className="admin-panel alog-stat alog-stat--wide" data-testid="section-current-session"><span>Current session</span>
            {cur ? <dl className="alog-kv"><div><dt>User</dt><dd>{who(cur.user)}</dd></div><div><dt>Session reference</dt><dd className="alog-mono">{cur.id}</dd></div><div><dt>State</dt><dd>{cur.state}</dd></div><div><dt>Created / login</dt><dd>{fmt(cur.created_at)}</dd></div><div><dt>Last refreshed</dt><dd>{fmt(cur.last_refreshed_at)}</dd></div><div><dt>Expires</dt><dd>{fmt(cur.expires_at)}</dd></div><div><dt>Remember me / persistent</dt><dd>{cur.persistent ? 'Yes' : 'No'}</dd></div></dl> : <strong>{sum.loading ? '…' : 'Unavailable'}</strong>}
          </div>
        </>)}
      </section>

      <form className="admin-panel alog-filters" onSubmit={apply} noValidate data-testid="form-activity-filters">
        <div className="admin-filter"><label>User</label><UserPicker value={draft.user} onChange={(u) => setDraft((d) => ({ ...d, user: u }))} enabled={enabled} identity={identity} /></div>
        <div className="admin-filter"><label htmlFor="alog-start">Start date (UTC)</label><input id="alog-start" type="date" className="admin-select" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} data-testid="input-activity-start" /></div>
        <div className="admin-filter"><label htmlFor="alog-end">End date (UTC, inclusive)</label><input id="alog-end" type="date" className="admin-select" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} data-testid="input-activity-end" /></div>
        <div className="alog-filters__actions">
          <button type="submit" className="admin-button" data-testid="button-activity-apply">Apply</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-activity-reset">Reset</button>
        </div>
        {formError && <p className="admin-feedback admin-feedback--error alog-filters__error" role="alert" data-testid="status-activity-filter-error">{formError}</p>}
      </form>

      <div className="alog-tabs" role="tablist" aria-label="History">
        {[['sessions', 'Sessions'], ['events', 'Activity events']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`alog-tab${view === k ? ' alog-tab--on' : ''}`} onClick={() => setView(k)} data-testid={`tab-activity-${k}`}>{l}</button>
        ))}
      </div>
      <p className="alog-muted">Dates filter {view === 'sessions' ? 'session creation / login' : 'event occurrence'} in UTC; the selected end date is included. “—” means not recorded. INVALIDATED means the account is ineligible or its security version changed.</p>

      <section className="admin-panel" aria-label={view === 'sessions' ? 'Sessions' : 'Activity events'} data-testid={`panel-activity-${view}`}>
        {view === 'sessions' ? (
          <State r={sessions} empty="No sessions found" cols="sessions">
            <thead><tr><th>User</th><th>Session reference</th><th>State</th><th>Session created / login</th><th>Last refreshed</th><th>Expires</th><th>Revoked</th><th>Remember me / persistent</th></tr></thead>
            <tbody>{sessions.data?.items?.map((s) => (
              <tr key={s.id}><td><span className="admin-table__name">{who(s.user)}</span><br /><small>{dash(s.user?.role)} · {dash(s.user?.account_state)}</small></td>
                <td className="alog-mono">{s.id}</td>
                <td><span className={`admin-badge${s.state === 'ACTIVE' ? '' : ' admin-badge--inactive'}`}>{s.state}</span>{s.is_current && <small className="alog-current"> Current</small>}</td>
                <td>{fmt(s.created_at)}</td><td>{fmt(s.last_refreshed_at)}</td><td>{fmt(s.expires_at)}</td><td>{fmt(s.revoked_at)}</td><td>{s.persistent ? 'Yes' : 'No'}</td></tr>
            ))}</tbody>
          </State>
        ) : (
          <State r={events} empty="No events found" cols="events">
            <thead><tr><th>Event occurred</th><th>User</th><th>Action</th><th>Outcome</th><th>Reason</th><th>Resource</th><th>Session</th><th>Request</th></tr></thead>
            <tbody>{events.data?.items?.map((ev) => (
              <tr key={ev.id}><td>{fmt(ev.created_at)}</td><td>{who(ev.user)}</td><td>{dash(ev.action)}</td>
                <td><span className={`admin-badge${String(ev.outcome).toLowerCase() === 'success' ? '' : ' admin-badge--inactive'}`}>{dash(ev.outcome)}</span></td>
                <td>{dash(ev.reason)}</td><td>{dash(ev.resource_type)}{ev.resource_id ? ` / ${ev.resource_id}` : ''}</td>
                <td className="alog-mono">{dash(ev.session_id)}</td><td className="alog-mono">{dash(ev.request_id)}</td></tr>
            ))}</tbody>
          </State>
        )}
        <Pager r={active} />
      </section>
    </AdminLayout>
  );
}
