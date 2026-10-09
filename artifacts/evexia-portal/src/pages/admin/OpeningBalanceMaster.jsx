import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import DirectorySearchStatus from '../../components/admin/DirectorySearchStatus.jsx';
import useServerOpeningBalances from '../../hooks/useServerOpeningBalances.js';
import OpeningBalanceFormPage from './OpeningBalanceFormPage.jsx';
import { exportOpeningBalances, downloadOpeningBalanceFile } from '../../services/serverOpeningBalances.js';
import { formatBalance } from '../../services/openingBalanceValidation.js';
import { getSession, subscribeSession, reportingIdentityGuard } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../category.css';
import '../../openingBalance.css';

const PATH = '/admin/masters/opening-balances';
const audit = (by, at) => <span className="ob-audit"><strong>{by}</strong><span>{formatAdminTimestamp(at)}</span></span>;
export default function OpeningBalanceMaster() {
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const state = useServerOpeningBalances(query, status, page, pageSize);
  const [confirming, setConfirming] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState(() => new URLSearchParams(window.location.search).has('saved') ? 'Opening balance saved.' : '');
  const [menu, setMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const controller = useRef(null);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    if (new URLSearchParams(window.location.search).has('saved')) window.history.replaceState(window.history.state, '', PATH);
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) { controller.current?.abort(); setAdding(false); setConfirming(null); setNotice(''); setError(''); setQuery(''); }
    });
    return () => { alive.current = false; controller.current?.abort(); unsubscribe(); };
  }, []);
  const pageCount = Math.max(1, Math.ceil(state.filtered / pageSize));
  useEffect(() => { if (!state.loading && !state.error && page > pageCount) setPage(pageCount); }, [state.loading, state.error, page, pageCount]);
  function request(record, type) { setConfirming({ record, type }); setError(''); setBlocked(false); }
  async function confirm() {
    const guard = reportingIdentityGuard();
    try {
      await state.apply(confirming.record, confirming.type); guard();
      if (alive.current) { setConfirming(null); setNotice('Opening balance updated. Server history retained.'); }
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) { setError(cause.message); setBlocked(cause.code === 'opening_balance_stale' || cause.code === 'not_found' || Boolean(cause.ambiguous)); }
    }
  }
  async function download(format) {
    if (busy.current || state.loading || state.error) return;
    busy.current = true; setExporting(true); setError('');
    const guard = reportingIdentityGuard();
    controller.current = new AbortController();
    try {
      const blob = await exportOpeningBalances({ query, status }, format, controller.current.signal);
      guard(); if (alive.current) downloadOpeningBalanceFile(blob, format);
    } catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) setError(`${format === 'xlsx' ? 'Excel' : 'CSV'} export failed. ${cause.message}`);
    } finally { busy.current = false; if (alive.current) setExporting(false); }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    return <fieldset disabled={state.loading || state.pending} className={mobile ? 'admin-mr-card__actions ob-actions' : 'admin-table__actions ob-actions'}>
      <button type="button" className="admin-icon-button" aria-label={`Edit balance for ${record.doctorName}`} onClick={() => navigate(`${PATH}/${record.id}`)}><Pencil size={16} />{mobile && 'Edit'}</button>
      <button type="button" className="admin-icon-button" aria-label={`${toggle} balance for ${record.doctorName}`} onClick={() => request(record, record.status === 'active' ? 'inactive' : 'active')}><CirclePower size={16} />{mobile && toggle}</button>
      <button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Delete balance for ${record.doctorName}`} onClick={() => request(record, 'delete')}><Trash2 size={16} />{mobile && 'Delete'}</button>
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, i) => i + 1 },
    { key: 'year', label: 'Financial year', render: (r) => <strong className="ob-period">{r.startYear}–{r.endYear}</strong> },
    { key: 'doctor', label: 'Doctor', render: (r) => <span className="ob-doctor"><strong>{r.doctorName}</strong><small>{r.registrationNumber}{!r.doctorUsable && ' · inactive/unavailable reference'}</small></span> },
    { key: 'amount', label: 'Opening balance', render: (r) => <span className={`ob-number${r.amount.startsWith('-') ? ' ob-number--negative' : ''}`}>{formatBalance(r.amount)}</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.id} kind="opening-balance" /> },
    { key: 'created', label: 'Created details', render: (r) => audit(r.createdBy, r.createdAt) },
    { key: 'updated', label: 'Updated details', render: (r) => audit(r.updatedBy, r.updatedAt) },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'active' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Opening Balance Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Finance</p><h1>Opening Balance Master</h1><p className="admin-page-head__description">Shared financial-year starting positions. This register does not post ledger entries or calculate payment balances.</p></div>
      <div className="ob-head-actions">
        <button className="admin-button admin-button--secondary" onClick={state.retry} disabled={state.loading}><RefreshCw size={16} /> Refresh records</button>
        <button className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/opening-balance')}><Upload size={16} /> Import data</button>
        <DropdownMenu.Root open={menu} onOpenChange={(open) => { if (!open || !busy.current) setMenu(open); }}><DropdownMenu.Trigger asChild><button className="admin-button admin-button--secondary" disabled={state.loading || Boolean(state.error)} aria-disabled={exporting || undefined} data-testid="button-export-opening-balances"><Download size={16} />{exporting ? 'Exporting…' : 'Export data'}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} aria-label="Opening balance export format"><DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void download('csv')}>CSV</DropdownMenu.Item><DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void download('xlsx')}>Excel (.xlsx)</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button className="admin-button" data-testid="button-add-opening-balance" onClick={(event) => { event.currentTarget.focus(); setNotice(''); setAdding(true); }}><Plus size={16} /> Add opening balance</button>
      </div></div>
    {notice && <div className="admin-feedback" role="status">{notice}</div>}
    {error && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    <section className="admin-panel" aria-label="Opening balance list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields"><label className="admin-search"><Search size={16} /><span className="sr-only">Search opening balances</span><input maxLength={200} value={query} placeholder="Search year, doctor, registration or amount" onChange={(e) => { setQuery(e.target.value); setPage(1); }} /></label>
        <div className="admin-filter"><label htmlFor="ob-status">Status</label><select id="ob-status" className="admin-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        <button className="admin-button admin-button--secondary" disabled={!query && status === 'all'} onClick={() => { setQuery(''); setStatus('all'); setPage(1); }}>Clear filters</button>
      </div></div>
      {state.loading ? <p className="admin-empty" role="status">Loading shared opening balances…</p> : state.error ? <div className="admin-empty" role="alert"><p>{state.error}</p><button className="admin-button" onClick={state.retry}>Try again</button></div> : <>
        {state.items.length ? <><div className="ob-desktop"><DataTable columns={columns} rows={state.items} rowOffset={(page - 1) * pageSize} rowKey={(r) => r.id} label="Opening balance records" testIdPrefix="opening-balance" /></div>
          <div className="ob-mobile" role="list" aria-label="Opening balance records">{state.items.map((r) => <article className="ob-card" key={r.id} role="listitem"><div className="ob-card__head"><div><small>{r.startYear}–{r.endYear}</small><h2>{r.doctorName}</h2><small>{r.registrationNumber}</small></div><StatusBadge status={r.status} id={r.id} /></div><p className="ob-number">{formatBalance(r.amount)}</p><dl className="ob-card__details"><div><dt>Created</dt><dd>{audit(r.createdBy, r.createdAt)}</dd></div><div><dt>Updated</dt><dd>{audit(r.updatedBy, r.updatedAt)}</dd></div></dl>{actions(r, true)}</article>)}</div></> :
          <div className="admin-empty"><strong>{state.total ? 'No matching balances' : 'No opening balances yet'}</strong><p>{state.total ? 'Try another search or status.' : 'Add a shared Doctor’s starting position. Legacy browser data is not imported automatically.'}</p></div>}
        {state.partial ? <DirectorySearchStatus count={state.items.length} scanned={state.scanned} nextCursor={state.nextCursor} loading={state.loading} onNext={state.continueSearch} onRestart={state.restartSearch} /> : <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={state.filtered} total={state.total} label="balances" onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} testId="text-opening-balance-count" />}
      </>}
    </section>
    {confirming && <ConfirmationDialog pending={state.pending} blocked={blocked} title={`${actionName} opening balance?`} description={`${actionName} ${confirming.record.doctorName}’s balance for ${confirming.record.startYear}–${confirming.record.endYear}?${confirming.type === 'delete' ? ' It leaves ordinary lists and exports; versioned server deletion history is retained. No restore is available here.' : ''}`} actionLabel={`${actionName} balance`} destructive={confirming.type === 'delete'} error={error} onConfirm={confirm} onClose={() => { setConfirming(null); setError(''); state.retry(); }} />}
    {adding && <OpeningBalanceFormPage modal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setNotice('Opening balance saved.'); state.retry(); }} />}
  </AdminLayout>;
}
