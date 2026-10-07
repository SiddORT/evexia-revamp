import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown, Filter, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import TableSkeleton, { TableLoadingStatus } from '../../components/admin/TableSkeleton.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { getSession, reportingRequest, subscribeSession } from '../../auth/adminSession.js';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import '../../activityLogs.css';

const PAGE = 25;
const MAX_OFFSET = 1000000;
const USER_PAGE = 8;
const DAY = 86400000;
const EMPTY = { user: null, start: '', end: '', format: '' };
const PROVENANCE = { server_prepared: 'Prepared by server', browser_reported: 'Browser-reported handoff' };
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const sessionKey = (s) => (s.status === 'authenticated' && s.user?.id ? s.user.id : '');

function useSessionKey() {
  const [key, setKey] = useState(() => sessionKey(getSession()));
  useEffect(() => {
    const sync = () => setKey(sessionKey(getSession()));
    sync();
    return subscribeSession(sync);
  }, []);
  return key;
}

function errInfo(e) {
  if (e?.name === 'AbortError') return null;
  if ([401, 403].includes(e?.status)) return { denied: true, message: 'Access to download history was denied for this session.' };
  if (e?.status === 400 || e?.status === 422) return { message: 'The filters were rejected by the server. Adjust them and retry.' };
  return { message: 'Download history could not be loaded. Check your connection and retry.' };
}

function buildParams(f, q) {
  for (const [key, label] of [['start', 'Start'], ['end', 'End']]) {
    const v = f[key];
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))
      || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v || v < '1970-01-01' || v > '2099-12-31')) {
      return { error: `${label} date must be a valid date between 1970 and 2099.` };
    }
  }
  if (f.start && f.end && f.end < f.start) return { error: 'End date cannot be before start date.' };
  const p = {};
  if (q) p.q = q.slice(0, 100);
  if (f.user) p.user_id = f.user.id;
  if (f.format) p.format = f.format;
  if (f.start) p.start = `${f.start}T00:00:00Z`;
  if (f.end) p.end = new Date(Date.parse(`${f.end}T00:00:00Z`) + DAY).toISOString().replace('.000Z', 'Z');
  return { params: p };
}

function UserPicker({ value, onChange, sessionId }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [off, setOff] = useState(0);
  const [tick, setTick] = useState(0);
  const [s, setS] = useState({ loading: false, data: null, error: false });
  useEffect(() => { setOff(0); }, [q]);
  useEffect(() => {
    if (!open || !sessionId) return undefined;
    const ctl = new AbortController();
    setS({ loading: true, data: null, error: false });
    const t = setTimeout(() => {
      const params = { limit: USER_PAGE, offset: off };
      if (q.trim()) params.q = q.trim().slice(0, 100);
      reportingRequest('users', params, { signal: ctl.signal })
        .then((data) => { if (!ctl.signal.aborted && sessionKey(getSession()) === sessionId) setS({ loading: false, data, error: false }); })
        .catch((e) => { if (errInfo(e) && !ctl.signal.aborted) setS({ loading: false, data: null, error: true }); });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [open, q, off, tick, sessionId]);
  useEffect(() => { if (!sessionId) { setOpen(false); setQ(''); setOff(0); setS({ loading: false, data: null, error: false }); } }, [sessionId]);
  return (
    <div className="alog-picker">
      <button type="button" className="admin-select alog-picker__btn" aria-labelledby="dlog-user-label" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="button-download-user">
        {value ? value.label : 'All users'}
      </button>
      {open && (
        <div className="alog-picker__pop" data-testid="panel-download-users">
          <div className="admin-search"><Search size={15} aria-hidden="true" />
            <input type="search" aria-label="Search users" placeholder="Search users" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-download-user-search" />
          </div>
          <ul className="alog-picker__list" aria-label="User results">
            <li><button type="button" onClick={() => { onChange(null); setOpen(false); }}>All users</button></li>
            {s.loading && <li className="alog-muted" role="status">Loading users…</li>}
            {s.error && <li className="alog-muted" role="alert">Users could not be loaded. <button type="button" onClick={() => setTick((t) => t + 1)}>Retry</button></li>}
            {s.data?.items?.length === 0 && <li className="alog-muted">No matching users.</li>}
            {s.data?.items?.map((u) => (
              <li key={u.id}><button type="button" onClick={() => { onChange(u); setOpen(false); }} data-testid="option-download-user">
                <span>{u.label}</span><small>{dash(u.role)} · {dash(u.account_state)}</small></button></li>
            ))}
          </ul>
          <div className="alog-picker__nav">
            <button type="button" className="admin-button admin-button--secondary" disabled={off === 0 || s.loading} onClick={() => setOff(Math.max(0, off - USER_PAGE))}>Previous</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={!s.data?.has_more || s.loading} onClick={() => setOff(off + USER_PAGE)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DownloadLogs() {
  const boundary = useAdminSession();
  const sessionId = useSessionKey();
  const enabled = boundary.status === 'authenticated' && !!sessionId;
  const prefs = useAdminPreferences();
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [paging, setPaging] = useState({ key: '', offset: 0 });
  const [tick, setTick] = useState(0);
  const [s, setS] = useState({ loading: false, data: null, error: null, key: '' });

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  // History is memory-only: wipe everything when the session owner changes.
  useEffect(() => {
    setDraft(EMPTY); setApplied(EMPTY); setSearch(''); setQuery(''); setFormError('');
    setFilterOpen(false); setS({ loading: false, data: null, error: null, key: '' });
  }, [sessionId]);

  const checked = buildParams(applied, query);
  const params = checked.params || {};
  const filterKey = JSON.stringify([params, sessionId]);
  const offset = paging.key === filterKey ? paging.offset : 0;
  const pending = search.trim() !== query;
  const setOffset = useCallback((o) => setPaging({ key: filterKey, offset: Math.min(Math.max(0, o), MAX_OFFSET) }), [filterKey]);
  const reqKey = `${filterKey}:${offset}:${tick}`;

  useEffect(() => {
    if (!enabled || pending || checked.error) { setS({ loading: false, data: null, error: null, key: '' }); return undefined; }
    const ctl = new AbortController();
    const owner = sessionId;
    setS({ loading: true, data: null, error: null, key: reqKey });
    reportingRequest('downloads', { ...params, limit: PAGE, offset }, { signal: ctl.signal })
      .then((data) => {
        if (ctl.signal.aborted || sessionKey(getSession()) !== owner) return;
        if (offset > 0 && !data.items.length) { setOffset(Math.max(0, offset - PAGE)); return; }
        setS({ loading: false, data, error: null, key: reqKey });
      })
      .catch((e) => { const i = errInfo(e); if (i && !ctl.signal.aborted && sessionKey(getSession()) === owner) setS({ loading: false, data: null, error: i, key: reqKey }); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pending, reqKey]);

  const current = s.key === reqKey ? s : { loading: enabled && !pending && !checked.error, data: null, error: null };
  const loading = current.loading || (enabled && pending);
  const data = loading ? null : current.data;
  const activeCount = [applied.user, applied.start, applied.end, applied.format].filter(Boolean).length;

  const apply = (e) => {
    e.preventDefault();
    const r = buildParams(draft, '');
    if (r.error) { setFormError(r.error); return; }
    setFormError(''); setApplied(draft);
  };
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); setFormError(''); setSearch(''); setQuery(''); };

  if (!enabled) return null;
  const when = (v) => formatAdminTimestamp(v, prefs, true);
  const cols = [55, 200, 200, 220, 110, 220];
  const skeleton = cols.map((w, i) => ({ key: i, skeletonWidth: i === 0 ? '22px' : `${Math.round(w * .65)}px`, skeletonLines: 1 }));
  return (
    <AdminLayout title="Download Logs">
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Read-only audit</p>
          <h1>Download Logs</h1>
          <p className="admin-page-head__description">History of download initiations recorded since this feature was rolled out. Earlier downloads are not included. Newest first; times shown in your display preferences, filters use UTC dates.</p>
          <p className="admin-page-head__description">“Prepared by server” means the server generated the file for the request. “Browser-reported handoff” means the browser told us it started a download. Neither confirms the file finished saving to disk.</p>
        </div>
        <div className="alog-head-actions">
          <button type="button" className="admin-button admin-button--secondary alog-filter-button" aria-label={`Filters${activeCount ? ` (${activeCount} active)` : ''}`} aria-expanded={filterOpen} aria-controls="dlog-filter-controls" onClick={() => setFilterOpen((o) => !o)} data-testid="button-download-filters"><Filter size={16} aria-hidden="true" />{activeCount > 0 && <span className="alog-filter-dot" aria-hidden="true" />}</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-download-refresh"><RefreshCw size={14} aria-hidden="true" /> Refresh report</button>
        </div>
      </div>

      <div id="dlog-filter-controls" className="admin-panel alog-filter-panel" hidden={!filterOpen} data-testid="section-download-filters">
        <form className="alog-filters" onSubmit={apply} noValidate data-testid="form-download-filters">
          <div className="admin-filter"><span id="dlog-user-label">User</span><UserPicker value={draft.user} onChange={(u) => setDraft((d) => ({ ...d, user: u }))} sessionId={sessionId} /></div>
          <div className="admin-filter"><label htmlFor="dlog-start">Start date (UTC)</label><input id="dlog-start" type="date" className="admin-select" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} data-testid="input-download-start" /></div>
          <div className="admin-filter"><label htmlFor="dlog-end">End date (UTC, inclusive)</label><input id="dlog-end" type="date" className="admin-select" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} data-testid="input-download-end" /></div>
          <div className="admin-filter"><label htmlFor="dlog-format">Format</label><select id="dlog-format" className="admin-select" value={draft.format} onChange={(e) => setDraft((d) => ({ ...d, format: e.target.value }))} data-testid="select-download-format"><option value="">All formats</option>{['PDF', 'CSV', 'XLSX'].map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
          <div className="alog-filters__actions">
            <button type="submit" className="admin-button" data-testid="button-download-apply">Apply</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-download-reset">Reset</button>
          </div>
          {formError && <p className="admin-feedback admin-feedback--error alog-filters__error" role="alert" data-testid="status-download-filter-error">{formError}</p>}
        </form>
      </div>

      <div className="alog-toolbar" data-testid="toolbar-download">
        <div className="alog-toolbar__controls">
          <div className="alog-search admin-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search download logs" placeholder="Search user, label, module or format" maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-download-search" /></div>
        </div>
      </div>
      <p className="alog-muted">Dates filter the time the download was initiated, in UTC; the selected end date is included. “—” means not recorded. This page is read-only: files cannot be exported, deleted or downloaded again from here.</p>

      <section className="admin-panel" aria-label="Download history" data-testid="panel-download-history">
        {current.error ? (
          <div className="admin-empty" role="alert" data-testid="status-download-error"><div className="admin-empty__icon"><ShieldAlert size={20} /></div><strong>{current.error.denied ? 'Access denied' : 'Could not load'}</strong><p>{current.error.message}</p>
            {!current.error.denied && <button type="button" className="admin-button admin-button--secondary alog-retry" onClick={() => setTick((t) => t + 1)}>Retry</button>}</div>
        ) : checked.error ? (
          <div className="admin-empty" role="alert"><div className="admin-empty__icon"><ShieldAlert size={20} /></div><strong>Check filters</strong><p>{checked.error}</p></div>
        ) : !loading && data && !data.items.length ? (
          <div className="admin-empty" data-testid="status-download-empty"><div className="admin-empty__icon"><FileDown size={20} /></div><strong>No download logs found</strong><p>Only downloads initiated after rollout are recorded. Adjust filters or search.</p></div>
        ) : (<>
          {loading && <TableLoadingStatus label="Loading download logs…" />}
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Results">
            <table className="admin-table alog-table" aria-busy={loading} data-testid="table-download-logs">
              <colgroup>{cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
              <thead><tr><th scope="col">Sr No</th><th scope="col">Initiated</th><th scope="col">User</th><th scope="col">Download</th><th scope="col">Format</th><th scope="col">Recorded by</th></tr></thead>
              {loading ? <TableSkeleton columns={skeleton} rowCount={PAGE} /> : (
                <tbody>{data?.items?.map((r, i) => (
                  <tr key={r.id}><td>{offset + i + 1}</td><td>{when(r.created_at)}</td>
                    <td><span className="admin-table__name">{r.user?.label || 'Unknown/System'}</span><br /><small>{dash(r.user?.role)} · {dash(r.user?.account_state)}</small></td>
                    <td><span className="admin-table__name">{dash(r.label)}</span><br /><small>{dash(r.module)}</small></td>
                    <td><span className="admin-badge">{dash(r.format)}</span></td>
                    <td>{PROVENANCE[r.provenance] || dash(r.provenance)}</td></tr>
                ))}</tbody>
              )}
            </table>
          </div>
        </>)}
        <div className="admin-panel__foot admin-pagination">
          <span role={loading ? undefined : 'status'}>{data?.items?.length ? `Page ${Math.floor(offset / PAGE) + 1} · Rows ${offset + 1}–${offset + data.items.length} of ${data.total}` : loading ? 'Loading page…' : current.error ? 'Page unavailable' : 'No rows · Page 1'}</span>
          <div className="admin-pagination__pages">
            <button type="button" aria-label="Previous page" disabled={offset === 0 || !data || loading} onClick={() => setOffset(offset - PAGE)}><ChevronLeft size={14} /> Previous</button>
            <button type="button" aria-label="Next page" disabled={!data?.has_more || loading || offset + PAGE > MAX_OFFSET} onClick={() => setOffset(offset + PAGE)}>Next <ChevronRight size={14} /></button>
          </div>
        </div>
      </section>
    </AdminLayout>
  );
}
