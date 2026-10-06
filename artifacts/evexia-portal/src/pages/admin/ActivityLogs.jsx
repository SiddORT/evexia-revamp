import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, Download, Filter, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import TableSkeleton, { TableLoadingStatus } from '../../components/admin/TableSkeleton.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { reportingRequest } from '../../auth/adminSession.js';
import { downloadReportingCSV } from '../../services/reportingCSV.js';
import '../../activityLogs.css';

const browserActions = {
  staff_create: 'Staff created', staff_update: 'Staff updated', staff_status: 'Staff status changed',
  browser_page_view: 'Page visited', browser_created: 'Record created',
  browser_updated: 'Record updated', browser_deleted: 'Record deleted',
  browser_imported: 'Records imported', browser_exported: 'Export generated',
  browser_settings_changed: 'Settings changed',
};
const revocationReasons = {
  new_login: 'Replaced by a new login',
  logout: 'Logged out',
  password_change: 'Password changed',
  identity_change: 'Account access changed',
  identity_invalid: 'Account security changed',
  replay: 'Revoked for security',
};
const endingReason = (s) => {
  if (s.state === 'REVOKED') return revocationReasons[s.revocation_reason] || 'Reason unavailable';
  if (s.state === 'EXPIRED') return 'Session time limit passed';
  if (s.state === 'INVALIDATED') return 'Account access or security changed';
  return '—';
};
const resourceNames = {
  dashboard: 'Dashboard', zone: 'Zone Master', courier_partner: 'Courier Partner',
  storage_location: 'Storage Location', headquarter: 'Headquarter Master',
  mr: 'MR Master', doctor: 'Doctor Master', patient: 'Patient Master',
  designation: 'Designation Master', staff: 'Staff', product_category: 'Product Category',
  allergen: 'Allergen Master', vendor: 'Vendor Master', sales_target: 'Sales Target',
  opening_balance: 'Opening Balance', purchase_order: 'Purchase Orders',
  purchase_received: 'Purchase Received', communication: 'Communication Settings',
  message_template: 'Message Templates', invoice_template: 'Invoice Templates',
  receipt_template: 'Receipt Templates', settings: 'Settings',
  roles_permissions: 'Roles & Permissions preview', activity_logs: 'Sessions & Activity Logs',
  masters: 'Masters',
};

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
  const key = JSON.stringify([params, identity]);
  const [paging, setPaging] = useState({ key, offset: 0 });
  const offset = paging.key === key ? paging.offset : 0;
  useEffect(() => { setPaging({ key, offset: 0 }); }, [key]);
  const setOffset = useCallback((next) => setPaging((previous) => {
    const current = previous.key === key ? previous.offset : 0;
    return { key, offset: typeof next === 'function' ? next(current) : next };
  }), [key]);
  const [s, setS] = useState({ loading: false, data: null, error: null, requestKey: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!enabled) { setS({ loading: false, data: null, error: null }); return undefined; }
    const ctl = new AbortController();
    setS({ loading: true, data: null, error: null, requestKey: `${key}:${offset}:${tick}` });
    reportingRequest(resource, { ...params, limit: PAGE, offset }, { signal: ctl.signal })
      .then((data) => {
        if (ctl.signal.aborted) return;
        if (offset > 0 && !data.items.length) {
          setOffset(Math.max(0, offset - PAGE));
        } else setS({ loading: false, data, error: null, requestKey: `${key}:${offset}:${tick}` });
      })
      .catch((e) => { const i = errInfo(e); if (i && !ctl.signal.aborted) setS({ loading: false, data: null, error: i, requestKey: `${key}:${offset}:${tick}` }); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, key, offset, enabled, tick, identity, setOffset]);
  const visible = s.requestKey === `${key}:${offset}:${tick}` && enabled
    ? s : { loading: enabled, data: null, error: null };
  return { ...visible, offset, setOffset, reload };
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
      <button type="button" className="admin-select alog-picker__btn" aria-labelledby="alog-user-label" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="button-activity-user">
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
      <span role={r.loading ? undefined : 'status'}>{d?.items?.length ? `Page ${Math.floor(r.offset / PAGE) + 1} · Rows ${r.offset + 1}–${r.offset + d.items.length}` : r.loading ? 'Loading page…' : r.error ? 'Page unavailable' : 'No rows · Page 1'}</span>
      <div className="admin-pagination__pages">
        <button type="button" aria-label="Previous page" disabled={r.offset === 0 || !d || r.loading || r.error} onClick={() => r.setOffset(Math.max(0, r.offset - PAGE))}><ChevronLeft size={14} /> Previous</button>
        <button type="button" aria-label="Next page" disabled={!d?.has_more || r.loading || r.error || r.offset + PAGE > 10000} onClick={() => r.setOffset(r.offset + PAGE)}>Next <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

function State({ r, empty, children, cols }) {
  if (r.error) return (
    <div className="admin-empty" role="alert"><div className="admin-empty__icon"><ShieldAlert size={20} /></div><strong>{r.error.denied ? 'Access denied' : 'Could not load'}</strong><p>{r.error.message}</p>
      {!r.error.denied && <button type="button" className="admin-button admin-button--secondary alog-retry" onClick={r.reload}>Retry</button>}</div>
  );
  if (!r.loading && !r.data) return null;
  if (!r.loading && !r.data.items?.length) return <div className="admin-empty"><div className="admin-empty__icon"><Activity size={20} /></div><strong>{empty}</strong><p>Adjust filters or date range.</p></div>;
  const widths = cols === 'sessions' ? [55, 200, 260, 155, 185, 185, 185, 185, 210] : [55, 185, 200, 180, 110, 160, 210, 260, 260];
  const skeletonColumns = widths.map((width, index) => ({
    key: index, skeletonWidth: index === 0 ? '22px' : `${Math.round(width * .65)}px`,
    skeletonLines: cols === 'sessions' && index === 1 ? 2 : 1,
  }));
  return <>
    {r.loading && <TableLoadingStatus label={cols === 'sessions' ? 'Loading sessions…' : 'Loading activity events…'} />}
    <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Results">
      <table className="admin-table alog-table" data-cols={cols} aria-busy={r.loading}>
        <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        {children[0]}
        {r.loading ? <TableSkeleton columns={skeletonColumns} rowCount={PAGE} /> : children[1]}
      </table>
    </div>
  </>;
}

export default function ActivityLogs() {
  const session = useAdminSession();
  const enabled = session.status === 'authenticated';
  const identity = session.user?.id || session.user?.email || '';
  const [draft, setDraft] = useState({ user: null, start: '', end: '', state: '' });
  const [applied, setApplied] = useState({ user: null, start: '', end: '', state: '' });
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [eventQuery, setEventQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [view, setView] = useState('sessions');
  const [sum, setSum] = useState({ loading: false, data: null, error: null });
  const [sumTick, setSumTick] = useState(0);
  const checked = range(applied);
  const params = checked.params || {};
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const timer = setTimeout(() => setEventQuery(eventSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [eventSearch]);
  const sessionParams = { ...params, ...(query ? { q: query } : {}), ...(applied.state ? { state: applied.state } : {}) };
  const eventParams = { ...params, ...(eventQuery ? { q: eventQuery } : {}) };
  const exportParams = view === 'sessions' ? sessionParams : eventParams;
  const sessionPending = search.trim() !== query;
  const eventPending = eventSearch.trim() !== eventQuery;
  const searchPending = view === 'sessions' ? sessionPending : eventPending;
  const sessionReport = useReport('sessions', sessionParams, enabled && view === 'sessions' && !sessionPending, identity);
  const eventReport = useReport('events', eventParams, enabled && view === 'events' && !eventPending, identity);
  const sessions = sessionPending ? { ...sessionReport, loading: true, data: null, error: null } : sessionReport;
  const events = eventPending ? { ...eventReport, loading: true, data: null, error: null } : eventReport;
  const idRef = useRef(identity);
  const exportController = useRef(null);
  const [exportState, setExportState] = useState({ busy: false, error: false, message: '' });
  const exportKey = JSON.stringify(exportParams);
  const cancelExport = () => {
    if (!exportController.current) return;
    exportController.current.abort();
    exportController.current = null;
    setExportState({ busy: false, error: true, message: 'Export cancelled because the search, filters, tab or session changed. No file was downloaded.' });
  };

  useEffect(() => {
    if (exportController.current) {
      exportController.current.abort();
      exportController.current = null;
      setExportState({ busy: false, error: true, message: 'Export cancelled because the search, filters, tab or session changed. No file was downloaded.' });
    } else setExportState({ busy: false, error: false, message: '' });
    return () => { exportController.current?.abort(); };
  }, [enabled, identity, view, exportKey]);

  const exportCSV = async () => {
    if (exportController.current || !enabled || checked.error || searchPending) return;
    const ctl = new AbortController();
    exportController.current = ctl;
    setExportState({ busy: true, error: false, message: 'Preparing fresh filtered CSV…' });
    try {
      const count = await downloadReportingCSV(view, exportParams, ctl.signal);
      if (!ctl.signal.aborted) setExportState({ busy: false, error: false, message: `CSV download started: ${count} rows matching the applied filters.` });
    } catch (error) {
      if (!ctl.signal.aborted) setExportState({ busy: false, error: true, message: error.message || 'Export failed. No file was downloaded. Retry.' });
    } finally {
      if (exportController.current === ctl) exportController.current = null;
    }
  };

  useEffect(() => {
    if (idRef.current !== identity) {
      idRef.current = identity;
      setDraft({ user: null, start: '', end: '', state: '' }); setApplied({ user: null, start: '', end: '', state: '' }); setFormError('');
      setSearch(''); setQuery(''); setEventSearch(''); setEventQuery(''); setFilterOpen(false);
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
    cancelExport();
    setFormError(''); setApplied(draft);
  };
  const reset = () => { cancelExport(); const z = { user: null, start: '', end: '', state: '' }; setDraft(z); setApplied(z); setFormError(''); };
  const refreshAll = () => { setSumTick((t) => t + 1); sessions.reload(); events.reload(); };
  const active = view === 'sessions' ? sessions : events;
  useEffect(() => {
    const reload = () => events.reload();
    window.addEventListener('evexia-admin-activity-recorded', reload);
    return () => window.removeEventListener('evexia-admin-activity-recorded', reload);
  }, [events.reload]);

  if (!enabled) return null;
  return (
    <AdminLayout title="Sessions & Activity Logs">
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Read-only audit</p>
          <h1>Sessions &amp; Activity Logs</h1>
          <p className="admin-page-head__description">Authentication, server operations, page visits and record actions. Browser-reported activity is labeled separately from verified server operations. All times are UTC.</p>
          <p className="admin-page-head__description">Counts are global registered backend accounts, including unmapped staff credentials, not browser-local masters, and are unaffected by history filters.</p>
        </div>
        <div className="alog-head-actions">
          <button type="button" className="admin-button admin-button--secondary alog-filter-button" aria-label={`Filters${[applied.user, applied.start, applied.end, applied.state].filter(Boolean).length ? ` (${[applied.user, applied.start, applied.end, applied.state].filter(Boolean).length} active)` : ''}`} aria-expanded={filterOpen} aria-controls="alog-filter-controls" onClick={() => setFilterOpen((o) => !o)} data-testid="button-activity-filters"><Filter size={16} aria-hidden="true" />{[applied.user, applied.start, applied.end, applied.state].some(Boolean) && <span className="alog-filter-dot" aria-hidden="true" />}</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={refreshAll} disabled={!enabled} data-testid="button-activity-refresh"><RefreshCw size={14} aria-hidden="true" /> Refresh report</button>
        </div>
      </div>

      <section className="alog-stats" aria-label="Summary" data-testid="section-activity-summary">
        {sum.error ? (
          <div className="admin-feedback admin-feedback--error" role="alert">{sum.error.message} {!sum.error.denied && <button type="button" className="admin-button admin-button--secondary" onClick={() => setSumTick((t) => t + 1)}>Retry</button>}</div>
        ) : (<>
          <div className="admin-panel alog-stat"><span>Registered backend accounts</span><strong data-testid="text-total-users">{sum.loading || !sum.data ? '…' : sum.data.total_users}</strong><small>Includes disabled and unmapped</small></div>
          <div className="admin-panel alog-stat"><span>Users with valid sessions</span><strong data-testid="text-active-users">{sum.loading || !sum.data ? '…' : sum.data.active_users}</strong><small>Distinct users, not live presence</small></div>
           <div className="admin-panel alog-stat"><span>Summary refreshed</span><strong className="alog-stat__time">{sum.loading ? '…' : fmt(sum.data?.refreshed_at)}</strong><small>When these counts were fetched, not when your login credentials were renewed.</small></div>
        </>)}
      </section>

       <div id="alog-filter-controls" className="admin-panel alog-filter-panel" hidden={!filterOpen} data-testid="section-activity-filters">
      <form className="alog-filters" onSubmit={apply} noValidate data-testid="form-activity-filters">
         <div className="admin-filter"><span id="alog-user-label">User</span><UserPicker value={draft.user} onChange={(u) => setDraft((d) => ({ ...d, user: u }))} enabled={enabled} identity={identity} /></div>
        <div className="admin-filter"><label htmlFor="alog-start">Start date (UTC)</label><input id="alog-start" type="date" className="admin-select" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} data-testid="input-activity-start" /></div>
        <div className="admin-filter"><label htmlFor="alog-end">End date (UTC, inclusive)</label><input id="alog-end" type="date" className="admin-select" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} data-testid="input-activity-end" /></div>
         {view === 'sessions' && <div className="admin-filter"><label htmlFor="alog-state">Session state</label><select id="alog-state" className="admin-select" value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))} data-testid="select-activity-state"><option value="">All states</option>{['ACTIVE', 'EXPIRED', 'REVOKED', 'INVALIDATED'].map((state) => <option key={state} value={state}>{state[0] + state.slice(1).toLowerCase()}</option>)}</select></div>}
        <div className="alog-filters__actions">
          <button type="submit" className="admin-button" data-testid="button-activity-apply">Apply</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-activity-reset">Reset</button>
        </div>
        {formError && <p className="admin-feedback admin-feedback--error alog-filters__error" role="alert" data-testid="status-activity-filter-error">{formError}</p>}
      </form>
       </div>

      <div className="alog-toolbar" data-testid="toolbar-activity">
      <div className="alog-tabs" role="tablist" aria-label="History">
        {[['sessions', 'Sessions'], ['events', 'Activity events']].map(([k, l]) => (
          <button key={k} id={`alog-tab-${k}`} type="button" role="tab" aria-selected={view === k} aria-controls={`alog-panel-${k}`} tabIndex={view === k ? 0 : -1} className={`alog-tab${view === k ? ' alog-tab--on' : ''}`} onClick={() => { if (view !== k) cancelExport(); setView(k); }} onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 'sessions' : e.key === 'End' ? 'events' : view === 'sessions' ? 'events' : 'sessions';
            if (view !== next) cancelExport();
            setView(next);
            document.getElementById(`alog-tab-${next}`)?.focus();
          }} data-testid={`tab-activity-${k}`}>{l}</button>
        ))}
      </div>
      <div className="alog-toolbar__controls">
        <div className="alog-search admin-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={view === 'sessions' ? 'Search sessions' : 'Search activity events'} placeholder={view === 'sessions' ? 'Search user name, email or session reference' : 'Search user, action, outcome or reference'} maxLength={100} value={view === 'sessions' ? search : eventSearch} onChange={(e) => { cancelExport(); if (view === 'sessions') setSearch(e.target.value); else setEventSearch(e.target.value); }} data-testid={`input-activity-${view === 'sessions' ? 'session' : 'event'}-search`} /></div>
        <button type="button" className="admin-button admin-button--secondary" onClick={exportCSV} disabled={exportState.busy || !enabled || !!checked.error || searchPending} data-testid={`button-activity-export-${view}`}>
          <Download size={14} aria-hidden="true" />{exportState.busy ? 'Exporting…' : `Export ${view === 'sessions' ? 'sessions' : 'activity'} CSV`}
        </button>
      </div>
      </div>
       <p className="alog-muted">Dates filter {view === 'sessions' ? 'session creation / login' : 'event occurrence'} in UTC; the selected end date is included. “—” means not recorded. {view === 'sessions' && 'Active: valid now. Expired: time limit passed. Revoked: ended by logout, a new login, or a security action. Invalidated: account is ineligible or its security version changed. Last refreshed: when login credentials were renewed within this session. Refresh report only reloads these results.'}</p>
      <div className="alog-export">
        <p className="alog-muted">Exports all matching rows, not just this page, using applied filters and search. Maximum 5,000 rows; narrow filters if exceeded. Session and record identifiers are excluded. Downloaded files contain account labels; keep them private.</p>
        {searchPending && <p className="alog-muted" role="status">Applying search… Export will be available when search is applied.</p>}
        {exportState.message && <p role={exportState.error ? 'alert' : 'status'} className={exportState.error ? 'admin-feedback admin-feedback--error' : 'alog-muted'} data-testid="status-activity-export">{exportState.message}</p>}
      </div>

      <section id={`alog-panel-${view}`} role="tabpanel" aria-labelledby={`alog-tab-${view}`} className="admin-panel" data-testid={`panel-activity-${view}`}>
        {view === 'sessions' ? (
           <>
          <State r={sessions} empty="No sessions found" cols="sessions">
             <thead><tr><th scope="col">Sr No</th><th>User</th><th>Session reference</th><th>State</th><th>Why session ended</th><th>Session created / login</th><th>Last refreshed</th><th>Expires</th><th>Revoked</th><th>Remember me / persistent</th></tr></thead>
             <tbody>{sessions.data?.items?.map((s, index) => (
               <tr key={s.id}><td>{sessions.offset + index + 1}</td><td><span className="admin-table__name">{who(s.user)}</span><br /><small>{dash(s.user?.role)} · {dash(s.user?.account_state)}</small></td>
                <td className="alog-mono">{s.id}</td>
                <td><span className={`admin-badge${s.state === 'ACTIVE' ? '' : ' admin-badge--inactive'}`}>{s.state}</span>{s.is_current && <small className="alog-current"> Current</small>}</td>
                <td data-testid="text-session-ending-reason">{endingReason(s)}</td>
                <td>{fmt(s.created_at)}</td><td>{fmt(s.last_refreshed_at)}</td><td>{fmt(s.expires_at)}</td><td>{fmt(s.revoked_at)}</td><td>{s.persistent ? 'Yes' : 'No'}</td></tr>
            ))}</tbody>
          </State>
           </>
        ) : (
          <State r={events} empty="No events found" cols="events">
            <thead><tr><th scope="col">Sr No</th><th>Event occurred</th><th>User</th><th>Action</th><th>Outcome</th><th>Reason</th><th>Resource</th><th>Session</th><th>Request</th></tr></thead>
            <tbody>{events.data?.items?.map((ev, index) => (
              <tr key={ev.id}><td>{events.offset + index + 1}</td><td>{fmt(ev.created_at)}</td><td>{who(ev.user)}</td><td>{browserActions[ev.action] || dash(ev.action)}</td>
                <td><span className={`admin-badge${['success', 'reported'].includes(String(ev.outcome).toLowerCase()) ? '' : ' admin-badge--inactive'}`}>{dash(ev.outcome)}</span></td>
                <td>{ev.reason === 'browser_reported' ? 'Browser-reported' : dash(ev.reason)}</td><td>{resourceNames[ev.resource_type] || dash(ev.resource_type)}{ev.resource_id ? ` / ${ev.resource_id}` : ''}</td>
                <td className="alog-mono">{dash(ev.session_id)}</td><td className="alog-mono">{dash(ev.request_id)}</td></tr>
            ))}</tbody>
          </State>
        )}
        <Pager r={active} />
      </section>
    </AdminLayout>
  );
}
