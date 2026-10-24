import { useEffect, useState } from 'react';
import { RefreshCw, Search, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import SelectIndicator from '../../components/admin/SelectIndicator.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import { loadStaffAccess } from '../../services/staff.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import './staffAccessDirectory.css';

const INITIAL = { query: '', status: '', login: '', cursor: null, history: [], pageSize: 10, attempt: 0 };
const EMPTY = { loading: true, items: [], total: null, filtered: null, error: '' };

function LoginBadge({ enabled }) {
  return <span className={`admin-badge${enabled ? '' : ' admin-badge--inactive'}`}>{enabled ? 'Enabled' : 'Disabled'}</span>;
}

export default function StaffAccessDirectory() {
  const { user } = useAdminSession();
  const [criteria, setCriteria] = useState(INITIAL);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [page, setPage] = useState(1);
  const [state, setState] = useState(EMPTY);
  const [cardView, setCardView] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  const searching = Boolean(criteria.query);
  const invalidSearch = draft.trim().length === 1 || /[\u0000-\u001f\u007f]/.test(draft);
  // Bind every response to its owner and complete applied scope before effects
  // run. Local search-result pages do not trigger another server scan.
  const requestKey = JSON.stringify({
    owner: user?.id, query: criteria.query, status: criteria.status, login: criteria.login,
    cursor: criteria.cursor, pageSize: criteria.pageSize, attempt: criteria.attempt,
    offset: searching ? 0 : (page - 1) * criteria.pageSize,
  });
  const current = state.key === requestKey && !dirty;
  const loading = !dirty && (!current || state.loading);
  const loaded = current && !state.loading && !state.error;

  useEffect(() => {
    if (dirty) return undefined;
    const controller = new AbortController();
    setState({ ...EMPTY, key: requestKey });
    loadStaffAccess(JSON.parse(requestKey), controller.signal)
      .then((result) => { if (!controller.signal.aborted) setState({ ...result, key: requestKey, loading: false, error: '' }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ ...EMPTY, key: requestKey, loading: false, error: error.message }); });
    return () => controller.abort();
  }, [requestKey, dirty]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setCardView(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const count = loaded ? (searching ? state.items.length : state.filtered) : 0;
  const pageCount = Math.max(1, Math.ceil(count / criteria.pageSize));
  useEffect(() => {
    if (loaded && page > pageCount) setPage(pageCount);
  }, [loaded, page, pageCount]);
  const rows = loaded ? (searching ? state.items.slice((page - 1) * criteria.pageSize, page * criteria.pageSize) : state.items) : [];

  function restart(patch) {
    setPage(1);
    setCriteria((old) => ({ ...old, ...patch, cursor: null, history: [], attempt: old.attempt + 1 }));
  }
  function refresh() {
    // Retry the current applied scope, not an unsubmitted draft or first section.
    setDraft(criteria.query);
    setDirty(false);
    setCriteria((old) => ({ ...old, attempt: old.attempt + 1 }));
  }
  function submit(event) {
    event.preventDefault();
    if (!invalidSearch) { setDirty(false); restart({ query: draft.trim() }); }
  }
  function changeSection(next) {
    if (!loaded || (next && !state.has_more) || (!next && !criteria.history.length)) return;
    setPage(1);
    setCriteria((old) => ({
      ...old, cursor: next ? state.next_cursor : old.history[old.history.length - 1],
      history: next ? [...old.history, old.cursor] : old.history.slice(0, -1),
      attempt: old.attempt + 1,
    }));
  }
  const columns = [
    { key: 'name', label: 'Staff', render: (row) => <span className="admin-table__name">{row.name}</span> },
    { key: 'code', label: 'Employee Code', render: (row) => row.employeeCode || 'Needs correction' },
    { key: 'role', label: 'Saved role', render: (row) => row.role },
    { key: 'status', label: 'Staff status', render: (row) => <StatusBadge status={row.status} id={row.id} kind="staff-access" /> },
    { key: 'login', label: 'Workspace login', render: (row) => <LoginBadge enabled={row.workspace_login_enabled} /> },
  ];
  return <AdminLayout title="Staff Access">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">User Management</p><h1>Staff Access</h1><p className="admin-page-head__description">Read-only saved staff roles and workspace login settings.</p></div></div>
    <section className="admin-panel staff-access" aria-label="Staff access directory" aria-busy={loading}>
      <form className="admin-toolbar master-filter-toolbar" onSubmit={submit} role="search" aria-label="Staff access search">
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={refresh}><RefreshCw size={16} aria-hidden="true" />Refresh access</button>
        <div className="admin-toolbar__fields">
          <div className="staff-access__search">
            <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search staff name or Employee Code</span>
              <input maxLength={200} value={draft} onChange={(event) => {
                setDraft(event.target.value);
                setDirty(true);
                setPage(1);
                setState(EMPTY);
              }} placeholder="Search name or Employee Code" aria-describedby="staff-access-search-help" aria-invalid={invalidSearch || undefined} />
            </label>
            <button type="submit" className="admin-button admin-button--secondary" disabled={loading || invalidSearch}>Search</button>
          </div>
          <div className="admin-filter"><label htmlFor="staff-access-status">Staff status</label><SelectIndicator>
            <select id="staff-access-status" className="admin-select" value={criteria.status} onChange={(event) => restart({ status: event.target.value })}>
              <option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </SelectIndicator></div>
          <div className="admin-filter"><label htmlFor="staff-access-login">Workspace login</label><SelectIndicator>
            <select id="staff-access-login" className="admin-select" value={criteria.login} onChange={(event) => restart({ login: event.target.value })}>
              <option value="">All logins</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option>
            </select>
          </SelectIndicator></div>
        </div>
        <MasterFilterReset disabled={!dirty && !draft && !criteria.query && !criteria.status && !criteria.login} onClick={() => { setDraft(''); setDirty(false); restart({ query: '', status: '', login: '' }); }} />
      </form>
      <p className="staff-access__note" id="staff-access-search-help">Search needs 2–200 characters. Each submitted section checks up to 500 eligible records for name or Employee Code only; continue deliberately to search further. {invalidSearch && <strong>Enter at least two characters without control characters.</strong>}</p>
      {dirty ? <div className="admin-empty" role="status"><strong>Search not applied</strong><p>Submit Search to load this name or Employee Code. Refresh access restores the applied criteria.</p></div>
        : loading ? <p role="status" className="admin-empty">Loading staff access…</p>
          : current && state.error ? <div role="alert" className="admin-empty"><strong>Staff Access could not be loaded</strong><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={refresh}>Try again</button></div>
            : loaded && <>
              {searching && <div className="staff-access__section" role="status">
                <p><strong>Search section {criteria.history.length + 1}</strong> · {state.items.length} matches in this section · {state.scanned} eligible records checked.
                  {' '}{state.has_more ? 'Directory search is incomplete. Continue to check later records.' : 'No later eligible records remain.'}
                  {criteria.history.length > 0 && ' Earlier section matches are not included here.'}</p>
                <div className="staff-access__section-actions">
                  <button type="button" className="admin-button admin-button--secondary" disabled={!criteria.history.length} onClick={() => changeSection(false)}>Previous search section</button>
                  <button type="button" className="admin-button admin-button--secondary" disabled={!state.has_more} onClick={() => changeSection(true)}>Search next section</button>
                </div>
              </div>}
              {rows.length ? cardView ? <div className="admin-zone-cards" role="list" aria-label="Staff access records">
                {rows.map((row) => <article className="admin-zone-card" role="listitem" key={row.id}>
                  <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><h2>{row.name}</h2></div></div>
                  <dl className="admin-zone-card__meta">
                    <div><dt>Employee Code</dt><dd>{row.employeeCode || 'Needs correction'}</dd></div>
                    <div><dt>Saved role</dt><dd>{row.role}</dd></div>
                    <div><dt>Staff status</dt><dd><StatusBadge status={row.status} id={row.id} kind="staff-access" /></dd></div>
                    <div><dt>Workspace login</dt><dd><LoginBadge enabled={row.workspace_login_enabled} /></dd></div>
                  </dl>
                </article>)}
              </div> : <DataTable rows={rows} label="Staff access records" testIdPrefix="staff-access" rowKey={(row) => row.id} columns={columns} />
                : <div className="admin-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span>
                  <strong>{searching ? 'No matches in this search section' : state.total === 0 ? 'No staff access records' : state.filtered === 0 ? 'No matching staff access records' : 'No records on this page'}</strong>
                  <p>{searching ? state.has_more ? 'Search the next section or change the search and filters.' : 'Try a different name, Employee Code or filter.' : state.total === 0 ? 'No eligible saved staff access records are available.' : 'Change the filters or return to an earlier page.'}</p>
                </div>}
              <TablePagination page={page} pageSize={criteria.pageSize} pageCount={pageCount} filtered={count} total={searching ? count : state.total}
                label={searching ? 'matches in this section' : 'staff access records'} pageScope={searching ? 'Current search section' : ''} indicated
                onPageChange={setPage} onPageSizeChange={(pageSize) => restart({ pageSize })} testId="text-staff-access-count" />
            </>}
    </section>
  </AdminLayout>;
}
