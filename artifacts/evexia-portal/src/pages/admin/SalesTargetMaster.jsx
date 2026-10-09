import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, FolderOpen, Pencil, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import RemoteSelect from '../../components/admin/RemoteSelect.jsx';
import SalesTargetForm, { fetchMrs, fetchZones } from '../../components/admin/SalesTargetForm.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useSalesTargets from '../../hooks/useSalesTargets.js';
import useSalesTargetYears from '../../hooks/useSalesTargetYears.js';
import { exportSalesTargets, downloadSalesTargetFile } from '../../services/serverSalesTargets.js';
import { QUARTERS, formatAmount } from '../../services/salesTargetFields.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import '../../mr.css';
import '../../category.css';
import '../../vendor.css';
import '../../salesTarget.css';

const BLANK = { startYear: '', endYear: '', zone: null, mr: null, status: 'all' };
const Audit = ({ by, at }) => <span className="admin-target-audit"><strong>{by || '—'}</strong><time dateTime={at || undefined}>{formatAdminTimestamp(at)}</time></span>;
const period = (r) => `${r.startYear}–${r.endYear}`;

export default function SalesTargetMaster() {
  const session = useAdminSession();
  return <TargetWorkspace key={session.user?.id || 'signed-out'} />;
}

function TargetWorkspace() {
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState(BLANK);
  const [applied, setApplied] = useState(BLANK);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const filters = { query: search.trim(), status: applied.status, zoneId: applied.zone?.value, mrId: applied.mr?.value, startYear: applied.startYear, endYear: applied.endYear };
  const { records, total, filtered, totals, loading, pending, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus } = useSalesTargets(filters, page, pageSize);
  const { years } = useSalesTargetYears([draft.startYear, draft.endYear, applied.startYear, applied.endYear]);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [summary, setSummary] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialogTrigger = useRef('');
  const [returnFocus, setReturnFocus] = useState('');
  useEffect(() => {
    if (!returnFocus || loading || editing || confirming) return;
    // Refresh replaces the row DOM. Restore to the new matching trigger, or a
    // stable page action when deletion/filter changes removed that row.
    const target = document.querySelector(`[data-testid="${returnFocus}"]`)
      || document.querySelector('[data-testid="button-add-sales-target"]');
    target?.focus();
    setReturnFocus('');
  }, [returnFocus, loading, editing, confirming]);
  const exportBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);
  const startIndex = (page - 1) * pageSize;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const active = search || Object.keys(BLANK).some((k) => JSON.stringify(applied[k]) !== JSON.stringify(BLANK[k]));
  const filterLabels = [search && 'name', applied.zone?.label, applied.mr?.label,
    applied.startYear && `start ${applied.startYear}`, applied.endYear && `end ${applied.endYear}`,
    applied.status !== 'all' && applied.status].filter(Boolean);
  const apply = () => { setApplied(draft); setPage(1); };
  const reset = () => { setDraft(BLANK); setApplied(BLANK); setSearch(''); setPage(1); };

  async function save(values, record) {
    const result = await (editing === 'new' ? add(values) : edit(record, values));
    if (result.success) { setReturnFocus(dialogTrigger.current); setEditing(null); }
    return result;
  }
  function requestAction(record, type, event) { dialogTrigger.current = event.currentTarget.dataset.testid; clearFeedback(); setActionError(''); setBlocked(false); setConfirming({ record, type }); }
  async function confirmAction() {
    const { record, type } = confirming;
    const result = await (type === 'delete' ? remove(record) : changeStatus(record, type === 'activate' ? 'active' : 'inactive'));
    if (result.success) { setReturnFocus(dialogTrigger.current); setConfirming(null); setActionError(''); }
    else { setActionError(result.error); setBlocked(/_stale$/.test(result.code || '') || Boolean(result.ambiguous)); }
  }
  async function exportAll(format) {
    if (error || loading || exportBusy.current) return;
    exportBusy.current = true; setActionError(''); setExporting(true);
    const guard = reportingIdentityGuard();
    try {
      const blob = await exportSalesTargets(filters, format);
      guard();
      if (mounted.current) downloadSalesTargetFile(blob, format);
    } catch (cause) {
      if (mounted.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}): the download could not be confirmed, so the file outcome on disk is unknown. ${cause.message || 'Check your downloads and retry if needed.'}`);
    } finally { exportBusy.current = false; if (mounted.current) setExporting(false); }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    const cls = mobile ? 'admin-vendor-card__action' : 'admin-icon-button';
    const who = `${record.mrName} ${period(record)}`;
    const t = mobile ? 'mobile-' : '';
    return <fieldset disabled={loading || pending} style={{ border: 0, margin: 0, padding: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={cls} aria-label={`Edit target for ${who}`} title="Edit" onClick={(event) => { dialogTrigger.current = event.currentTarget.dataset.testid; clearFeedback(); setEditing(record); }} data-testid={`button-edit-sales-target-${t}${record.id}`}><Pencil size={16} aria-hidden="true" />{mobile && <span>Edit</span>}</button>
      <button type="button" className={cls} aria-label={`${toggle} target for ${who}`} title={toggle} onClick={(event) => requestAction(record, toggle.toLowerCase(), event)} data-testid={`button-toggle-sales-target-${t}${record.id}`}><CirclePower size={16} aria-hidden="true" />{mobile && <span>{toggle}</span>}</button>
      <button type="button" className={mobile ? `${cls} admin-zone-card__action--danger` : `${cls} admin-icon-button--danger`} aria-label={`Delete target for ${who}`} title="Delete" onClick={(event) => requestAction(record, 'delete', event)} data-testid={`button-delete-sales-target-${t}${record.id}`}><Trash2 size={16} aria-hidden="true" />{mobile && <span>Delete</span>}</button>
    </fieldset>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, i) => <span className="admin-table__serial">{i + 1}</span> },
    { key: 'mr', label: 'MR', render: (r) => <><strong data-testid={`text-sales-target-mr-${r.id}`}>{r.mrName}</strong><br /><small>{r.employeeCode}</small></> },
    { key: 'zone', label: 'Zone', render: (r) => r.zoneName || '—' },
    { key: 'hq', label: 'Headquarter', render: (r) => r.headquarterName || '—' },
    { key: 'period', label: 'Financial year', render: (r) => period(r) },
    ...QUARTERS.map((k) => ({ key: k, label: k.toUpperCase(), render: (r) => formatAmount(r[k]) })),
    { key: 'annual', label: 'Annual', render: (r) => <strong>{formatAmount(r.annualTotal)}</strong> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} id={r.id} kind="sales-target" /> },
    { key: 'created', label: 'Created', render: (r) => <Audit by={r.createdBy} at={r.createdAt} /> },
    { key: 'updated', label: 'Updated', render: (r) => <Audit by={r.updatedBy} at={r.updatedAt} /> },
    { key: 'actions', label: 'Actions', render: (r) => actions(r) },
  ];
  const verb = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  const summaryRows = [...QUARTERS, 'total'];
  return <AdminLayout title="Sales Target Master"><div className="admin-target-page">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Planning</p><h1>Sales Target Master</h1><p className="admin-page-head__description">Targets for MRs by financial year.</p></div>
      <div className="admin-target-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => setSummary(true)} disabled={loading || Boolean(error)} data-testid="button-sales-target-summary">Summary</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/sales-target')} data-testid="button-import-sales-targets"><Upload size={16} aria-hidden="true" /> Import data</button>
        <DropdownMenu.Root open={menuOpen} onOpenChange={(open) => { if (!open || !exportBusy.current) setMenuOpen(open); }}>
          <DropdownMenu.Trigger asChild><button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading} aria-disabled={exporting || undefined} data-testid="button-export-sales-targets"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content className="admin-dropdown__menu admin-courier-export__menu sales-target-export-menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} aria-label="Sales target export format">
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportAll('csv')} data-testid="menu-export-sales-targets-csv">CSV</DropdownMenu.Item>
            <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportAll('xlsx')} data-testid="menu-export-sales-targets-xlsx">Excel (.xlsx)</DropdownMenu.Item>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={(event) => { dialogTrigger.current = event.currentTarget.dataset.testid; clearFeedback(); setEditing('new'); }} data-testid="button-add-sales-target"><Plus size={16} aria-hidden="true" /> Add target</button>
      </div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-sales-target-feedback">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-sales-target-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Sales target list">
      <div className="admin-target-toolbar"><div className="admin-target-toolbar__fields">
        <label className="admin-search"><span className="sr-only">Search MR name</span><input maxLength={100} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search MR name" data-testid="input-search-sales-targets" /></label>
        <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={retry} data-testid="button-refresh-sales-targets"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
        <span role="status" className="admin-target-filter-feedback" data-testid="text-sales-target-filter-feedback">{active ? `${filtered} matching · ${filterLabels.join(', ')} applied` : `${total} total targets`}{dirty && ' · unapplied changes'}</span>
      </div>
      <details className="admin-target-filter-disclosure">
        <summary data-testid="button-toggle-sales-target-filters">Filter records{active ? ' · active' : ''}</summary>
        <div className="admin-target-toolbar__fields" id="sales-target-filters">
        <RemoteSelect describeSelection id="filter-sales-target-zone" label="Zone" value={draft.zone?.value || ''} selected={draft.zone} fetchPage={fetchZones} placeholder="All zones" onChange={(item) => setDraft((d) => ({ ...d, zone: item, mr: null }))} />
        <RemoteSelect describeSelection id="filter-sales-target-mr" label="MR" value={draft.mr?.value || ''} selected={draft.mr} resetKey={draft.zone?.value || ''} fetchPage={fetchMrs(draft.zone ? { zoneId: draft.zone.value } : {})} placeholder="All MRs" onChange={(item) => setDraft((d) => ({ ...d, mr: item }))} />
        <SearchableSelect id="filter-sales-target-start" label="Financial start year" value={draft.startYear} options={years} placeholder="Any start year" onChange={(v) => setDraft((d) => ({ ...d, startYear: v }))} />
        <SearchableSelect id="filter-sales-target-end" label="Financial end year" value={draft.endYear} options={years} placeholder="Any end year" onChange={(v) => setDraft((d) => ({ ...d, endYear: v }))} />
        <div className="admin-filter"><label htmlFor="filter-sales-target-status">Status</label><select id="filter-sales-target-status" className="admin-select" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))} data-testid="select-filter-sales-target-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
        <button type="button" className="admin-button" disabled={!dirty} onClick={apply} data-testid="button-apply-sales-target-filters">Apply filters</button>
        {(active || dirty) && <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-reset-sales-target-filters">Reset</button>}
      </div></details></div>
      <div className="admin-target-summary" data-testid="summary-sales-target-totals" aria-busy={loading}>{summaryRows.map((k) => <div key={k}><span>{k === 'total' ? 'Total' : `${k.toUpperCase()} target`}</span><strong data-testid={`text-sales-target-total-${k}`}>{loading || error ? '…' : formatAmount(totals[k])}</strong></div>)}</div>
      {loading ? <p className="admin-empty" role="status">Loading shared sales targets…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>Sales targets could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" style={{ marginTop: 16 }} onClick={retry} data-testid="button-retry-sales-targets">Try again</button></div> : <>
        {records.length ? <>
          <div className="admin-vendor-desktop"><DataTable columns={columns} rows={records} rowOffset={startIndex} rowKey={(r) => r.id} label="Sales target records" testIdPrefix="sales-target" /></div>
          <div className="admin-vendor-mobile" role="list" aria-label="Sales target records">{records.map((r, index) => <article className="admin-vendor-card" role="listitem" key={r.id} data-testid={`card-sales-target-${r.id}`}>
            <div className="admin-vendor-card__head"><div><small>#{startIndex + index + 1} · {r.employeeCode} · {period(r)}</small><h2>{r.mrName}</h2></div><StatusBadge status={r.status} id={`mobile-${r.id}`} kind="sales-target" /></div>
            <dl className="admin-vendor-card__meta"><div><dt>Zone</dt><dd>{r.zoneName || '—'}</dd></div><div><dt>Headquarter</dt><dd>{r.headquarterName || '—'}</dd></div>{QUARTERS.map((k) => <div key={k}><dt>{k.toUpperCase()}</dt><dd>{formatAmount(r[k])}</dd></div>)}<div><dt>Annual</dt><dd><strong>{formatAmount(r.annualTotal)}</strong></dd></div><div><dt>Created</dt><dd><Audit by={r.createdBy} at={r.createdAt} /></dd></div><div><dt>Updated</dt><dd><Audit by={r.updatedBy} at={r.updatedAt} /></dd></div></dl>
            {actions(r, true)}
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-sales-target-empty"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>{total ? 'No matching targets' : 'No sales targets yet'}</strong><p>{total ? 'Try another financial year, zone, MR, status or name.' : 'Add a target or import a CSV or Excel file to start quarterly MR budgets.'}</p></div>}
        <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} pageRows={records} startIndex={startIndex} filtered={filtered} total={total} label={total === 1 ? 'target' : 'targets'} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }} testId="text-sales-target-count" />
      </>}
    </section>
    {summary && <Dialog className="admin-target-summary-dialog" eyebrow="Sales Target Master" title="Target Summary" description={`Quarterly totals for all ${filtered} ${filtered === 1 ? 'target' : 'targets'} matching the applied filters, not just this page.`} onClose={() => setSummary(false)} footer={<button type="button" className="admin-button admin-button--secondary" onClick={() => setSummary(false)} data-testid="button-close-target-summary">Close</button>}>
      {loading || error ? <p className="admin-empty" role="status" data-testid="status-summary-loading">{error || 'Refreshing totals for the current filters…'}</p> : <div className="admin-target-summary-dialog__rows"><div className="admin-target-summary-dialog__heading"><span>Type</span><span>Amount (in Rs)</span></div>{summaryRows.map((k) => <div key={k}><span>{k === 'total' ? 'Total' : `${k.toUpperCase()} target`}</span><strong data-testid={`text-summary-${k}`}>{formatAmount(totals[k])}</strong></div>)}</div>}</Dialog>}
    {editing && <SalesTargetForm key={editing === 'new' ? 'new' : editing.id} record={editing === 'new' ? null : editing} onSave={save} onClose={() => { setReturnFocus(dialogTrigger.current); setEditing(null); retry(); }} />}
    {confirming && <ConfirmationDialog pending={pending} blocked={blocked} title={`${verb} sales target?`} description={`Are you sure you want to ${verb.toLowerCase()} the target for ${confirming.record.mrName} (${period(confirming.record)})?${confirming.type === 'delete' ? ' It will disappear from ordinary lists and exports. Server deletion history is retained; no restore is available here.' : ''}`} actionLabel={`${verb} target`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setReturnFocus(dialogTrigger.current); setConfirming(null); retry(); }} error={actionError} />}
  </div></AdminLayout>;
}
