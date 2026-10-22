import { useEffect, useState } from 'react';
import { Mail, RefreshCw, ShieldAlert } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import { loadEmailLogs } from '../../services/emailDelivery.js';
import '../../activityLogs.css';

const PAGE = 25;
const MAX_OFFSET = 10000;
const DAY = 86400000;
const EMPTY = { start: '', end: '', purpose: '', status: '', recipient: '' };
const PURPOSE = { password_recovery: 'Password recovery', account_invitation: 'Account invitation', template_test: 'Template test email' };
const STATUS = { pending: 'Pending', sending: 'Sending', smtp_accepted: 'SMTP accepted', failed: 'Failed', unknown: 'Unknown / interrupted' };
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

function validDate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`))
    && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v && v >= '1970-01-01' && v <= '2099-12-31';
}
function buildFilters(f) {
  if ((f.start && !validDate(f.start)) || (f.end && !validDate(f.end))) return { error: 'Dates must be valid dates between 1970 and 2099.' };
  if (f.start && f.end && f.end < f.start) return { error: 'End date cannot be before start date.' };
  const r = f.recipient.trim();
  if (r && (r.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(r))) return { error: 'Recipient must be one exact email address.' };
  const p = {};
  if (f.start) p.start = `${f.start}T00:00:00Z`;
  if (f.end) p.end = new Date(Date.parse(`${f.end}T00:00:00Z`) + DAY).toISOString().replace('.000Z', 'Z');
  if (f.purpose) p.purpose = f.purpose;
  if (f.status) p.status = f.status;
  if (r) p.recipient = r;
  return { filters: p };
}

function Report({ sessionId }) {
  const prefs = useAdminPreferences();
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [formError, setFormError] = useState('');
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE);
  const [tick, setTick] = useState(0);
  const [s, setS] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    setDraft(EMPTY); setApplied(EMPTY); setFormError(''); setOffset(0); setS({ loading: true, data: null, error: null });
  }, [sessionId]);

  const checked = buildFilters(applied);
  const fkey = JSON.stringify(checked.filters || {});
  useEffect(() => {
    if (checked.error) { setS({ loading: false, data: null, error: null }); return undefined; }
    const ctl = new AbortController();
    let guard;
    try { guard = reportingIdentityGuard(); } catch { return undefined; }
    setS((p) => ({ loading: true, data: null, error: null, prev: p.data }));
    loadEmailLogs({ ...checked.filters, limit: pageSize, offset }, { signal: ctl.signal })
      .then((data) => {
        if (ctl.signal.aborted) return;
        try { guard(); } catch { return; }
        if (!data || !Array.isArray(data.items)) throw new Error('shape');
        if (offset > 0 && !data.items.length) { setOffset(Math.max(0, offset - pageSize)); return; }
        setS({ loading: false, data, error: null });
      })
      .catch((e) => {
        if (ctl.signal.aborted || e?.name === 'AbortError') return;
        try { guard(); } catch { return; }
        const denied = [401, 403].includes(e?.status);
        setS({ loading: false, data: null, error: { denied, message: denied ? 'Access to email logs was denied for this session.' : e?.status === 400 || e?.status === 422 ? 'The filters were rejected by the server. Adjust them and retry.' : 'Email logs could not be loaded. Check your connection and retry.' } });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fkey, offset, pageSize, tick, sessionId]);

  const apply = (e) => {
    e.preventDefault();
    const r = buildFilters(draft);
    if (r.error) { setFormError(r.error); return; }
    setFormError(''); setOffset(0); setApplied({ ...draft, recipient: draft.recipient.trim() });
  };
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); setOffset(0); setFormError(''); };
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const { loading, data, error } = s;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.min(Math.ceil(total / pageSize), Math.floor(MAX_OFFSET / pageSize) + 1));
  const page = Math.floor(offset / pageSize) + 1;
  const when = (v) => formatAdminTimestamp(v, prefs, true);
  const counts = data?.counts || {};

  const columns = [
    { key: 'time', label: 'Time', render: (r) => when(r.created_at) },
    { key: 'recipient', label: 'Recipient', render: (r) => dash(r.recipient) },
    { key: 'purpose', label: 'Purpose / portal', render: (r) => <><span className="admin-table__name">{PURPOSE[r.purpose] || dash(r.purpose)}</span><br /><small>{r.portal === 'mr' ? 'MR portal' : r.portal === 'admin' ? 'Admin portal' : dash(r.portal)}</small></> },
    { key: 'template', label: 'Template', render: (r) => <>{dash(r.template_id)}<br /><small>{r.template_version == null ? '—' : `Version ${r.template_version}`}</small></> },
    { key: 'origin', label: 'Origin / actor', render: (r) => <>{dash(r.origin)}<br /><small>{r.origin === 'Self-service' ? 'Self-service' : dash(r.actor_id)}</small></> },
    { key: 'status', label: 'Status', render: (r) => <span className="admin-badge">{STATUS[r.status] || dash(r.status)}</span> },
    { key: 'category', label: 'Failure category', render: (r) => dash(r.failure_category) },
    { key: 'id', label: 'Correlation ID', render: (r) => <code>{dash(r.id)}</code> },
  ];
  const emptyView = error ? (
    <div className="admin-empty" role="alert"><div className="admin-empty__icon"><ShieldAlert size={20} /></div><strong>{error.denied ? 'Access denied' : 'Could not load'}</strong><p>{error.message}</p>
      {!error.denied && <button type="button" className="admin-button admin-button--secondary alog-retry" onClick={() => setTick((t) => t + 1)}>Retry</button>}</div>
  ) : checked.error ? (
    <div className="admin-empty" role="alert"><div className="admin-empty__icon"><ShieldAlert size={20} /></div><strong>Check filters</strong><p>{checked.error}</p></div>
  ) : (
    <div className="admin-empty" data-testid="status-email-empty"><div className="admin-empty__icon"><Mail size={20} /></div><strong>No email logs found</strong><p>Adjust the filters or date range.</p></div>
  );

  return (
    <AdminLayout title="Email Logs">
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Read-only audit</p>
          <h1>Email Logs</h1>
          <p className="admin-page-head__description">Delivery attempts for password recovery and account invitations, newest first. Dates use UTC and the end date is included.</p>
          <p className="admin-page-head__description">“SMTP accepted” means the mail server accepted the message. It does not confirm inbox delivery. “Unknown / interrupted” means the outcome could not be confirmed; check the log before sending again. Messages cannot be replayed from this page.</p>
        </div>
        <div className="alog-head-actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-email-refresh"><RefreshCw size={14} aria-hidden="true" /> Refresh report</button>
        </div>
      </div>

      <div className="admin-panel alog-filter-panel" data-testid="section-email-filters">
        <form className="alog-filters" onSubmit={apply} noValidate data-testid="form-email-filters">
          <div className="admin-filter"><label htmlFor="elog-start">Start date (UTC)</label><input id="elog-start" type="date" className="admin-select" value={draft.start} onChange={set('start')} /></div>
          <div className="admin-filter"><label htmlFor="elog-end">End date (UTC, inclusive)</label><input id="elog-end" type="date" className="admin-select" value={draft.end} onChange={set('end')} /></div>
          <div className="admin-filter"><label htmlFor="elog-purpose">Purpose</label><select id="elog-purpose" className="admin-select" value={draft.purpose} onChange={set('purpose')}><option value="">All purposes</option>{Object.entries(PURPOSE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="admin-filter"><label htmlFor="elog-status">Status</label><select id="elog-status" className="admin-select" value={draft.status} onChange={set('status')}><option value="">All statuses</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="admin-filter"><label htmlFor="elog-recipient">Recipient (exact email)</label><input id="elog-recipient" type="email" className="admin-select" maxLength={254} autoComplete="off" value={draft.recipient} onChange={set('recipient')} /></div>
          <div className="alog-filters__actions">
            <button type="submit" className="admin-button" data-testid="button-email-apply">Apply</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-email-reset">Reset</button>
          </div>
          {formError && <p className="admin-feedback admin-feedback--error alog-filters__error" role="alert">{formError}</p>}
        </form>
      </div>

      <p className="alog-muted" role="status" data-testid="summary-email-counts">
        {data ? `${total} matching · ${Object.entries(STATUS).map(([k, v]) => `${v}: ${counts[k] ?? 0}`).join(' · ')}` : loading ? 'Loading summary…' : 'Summary unavailable'}
      </p>

      <section className="admin-panel" aria-label="Email delivery history" data-testid="panel-email-logs">
        <DataTable columns={columns} rows={data?.items || []} rowKey={(r) => r.id} label="Email delivery history" testIdPrefix="email" loading={loading} loadingLabel="Loading email logs…" skeletonRows={8} empty={emptyView} />
        <TablePagination page={page} pageCount={pageCount} pageSize={pageSize} filtered={total} total={total} label="emails" testId="text-email-pagination"
          onPageChange={(p) => { if (!loading && p >= 1 && p <= pageCount) setOffset((p - 1) * pageSize); }}
          onPageSizeChange={(size) => { setPageSize(size); setOffset(0); }} />
      </section>
    </AdminLayout>
  );
}

export default function EmailLogs() {
  const boundary = useAdminSession();
  const sessionId = useSessionKey();
  if (boundary.status !== 'authenticated' || !sessionId) return null;
  if (boundary.user?.identity_kind !== 'super_admin') {
    return (
      <AdminLayout title="Email Logs">
        <section className="admin-panel"><div className="admin-empty" role="alert"><div className="admin-empty__icon"><ShieldAlert size={20} /></div><strong>Access denied</strong><p>Email logs are restricted to Super Admin.</p></div></section>
      </AdminLayout>
    );
  }
  return <Report key={sessionId} sessionId={sessionId} />;
}
