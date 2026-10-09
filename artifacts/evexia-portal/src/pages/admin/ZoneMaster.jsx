import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, MapPinned, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import ZoneForm from '../../components/admin/ZoneForm.jsx';
import useZones from '../../hooks/useZones.js';
import { exportZones, downloadZoneFile } from '../../services/serverZones.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { canViewZones, hasZonePermission } from '../../auth/capabilities.js';

function details(by, at) {
  return <span className="admin-table__details"><strong>{by}</strong><small>{formatAdminTimestamp(at)}</small></span>;
}

export default function ZoneMaster() {
  const { user } = useAdminSession();
  if (!canViewZones(user)) return <AccessDenied title="Zone Master" heading="Zone Master is not available" testId="status-zone-denied" message="Your role has no Masters > Zone permissions, so zone records are hidden. Ask a Super Admin to update your role." />;
  return <ZoneWorkspace user={user} />;
}

function ZoneWorkspace({ user }) {
  const can = (key) => hasZonePermission(user, key);
  const { theme, appearance } = useAdminPreferences();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { zones, total, filtered, loading, pending, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus } = useZones(search, filter, page, pageSize);
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportBusy = useRef(false);
  const exportMounted = useRef(true);
  useEffect(() => { exportMounted.current = true; return () => { exportMounted.current = false; }; }, []);
  const [blocked, setBlocked] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [cardView, setCardView] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const syncView = () => setCardView(media.matches);
    syncView();
    media.addEventListener('change', syncView);
    return () => media.removeEventListener('change', syncView);
  }, []);
  const pageCount = Math.max(1, Math.ceil(filtered / pageSize));
  const pagination = { page, pageSize, pageCount, pageRows: zones, startIndex: (page - 1) * pageSize,
    setPage, setPageSize: (size) => { setPageSize(size); setPage(1); }, resetPage: () => setPage(1) };
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);

  async function save(values, record) {
    const result = await (editing === 'new' ? add(values) : edit(record, values));
    if (result.success) setEditing(null);
    return result;
  }

  async function confirmAction() {
    const { zone, type } = confirming;
    const result = await (type === 'delete' ? remove(zone) : changeStatus(zone, type === 'activate' ? 'active' : 'inactive'));
    if (result.success) { setConfirming(null); setActionError(''); }
    else { setActionError(result.error + (result.code === 'zone_stale' || result.ambiguous ? ' Cancel and refresh the table before confirming again.' : '')); setBlocked(result.code === 'zone_stale' || Boolean(result.ambiguous)); }
  }

  function requestAction(zone, type) {
    clearFeedback();
    setActionError('');
    setBlocked(false);
    setConfirming({ zone, type });
  }

  async function exportVisible(format) {
    if (error || loading || exportBusy.current) return;
    exportBusy.current = true;
    setActionError('');
    setExporting(true);
    const guard = reportingIdentityGuard();
    try {
      const blob = await exportZones({ query: search, status: filter }, format);
      guard();
      if (exportMounted.current) downloadZoneFile(blob, format);
    } catch (cause) {
      if (exportMounted.current) setActionError(`Export failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Refresh records and try again.'}`);
    } finally {
      exportBusy.current = false;
      if (exportMounted.current) setExporting(false);
    }
  }

  function renderActions(zone, mobile = false) {
    if (!can('zone.edit') && !can('zone.delete')) return null;
    const toggleLabel = zone.status === 'active' ? 'Inactivate' : 'Activate';
    return <fieldset disabled={loading || pending} style={{ border: 0, padding: 0, margin: 0 }} className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      {can('zone.edit') && <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`Edit ${zone.name}`} title="Edit" onClick={() => { clearFeedback(); setEditing(zone); }} data-testid={`button-edit-zone-${zone.id}`}>
        <Pencil size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Edit</span>}
      </button>}
      {can('zone.edit') && <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`${toggleLabel} ${zone.name}`} title={toggleLabel} onClick={() => requestAction(zone, toggleLabel.toLowerCase())} data-testid={`button-toggle-zone-${zone.id}`}>
        <CirclePower size={mobile ? 14 : 17} aria-hidden="true" />{mobile && <span>{toggleLabel}</span>}
      </button>}
      {can('zone.delete') && <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${zone.name}`} title="Delete" onClick={() => requestAction(zone, 'delete')} data-testid={`button-delete-zone-${zone.id}`}>
        <Trash2 size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Delete</span>}
      </button>}
    </fieldset>;
  }

  const columns = [
    { key: 'serial', label: 'Sr No', render: (_zone, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Zone name', render: (zone) => <span className="admin-table__name" data-testid={`text-zone-name-${zone.id}`}>{zone.name}</span> },
    { key: 'status', label: 'Status', render: (zone) => <StatusBadge status={zone.status} id={zone.id} /> },
    { key: 'created', label: 'Created details', render: (zone) => details(zone.createdBy, zone.createdAt) },
    { key: 'updated', label: 'Updated details', render: (zone) => details(zone.updatedBy, zone.updatedAt) },
    ...(can('zone.edit') || can('zone.delete') ? [{ key: 'actions', label: 'Actions', render: (zone) => renderActions(zone) }] : []),
  ];

  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';

  return (
    <AdminLayout title="Zone Master">
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Geography</p><h1>Zone Master</h1></div>
          {(can('zone.import') || can('zone.export') || can('zone.add')) && <div className="admin-mr-head-actions">{can('zone.import') && <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/zone')} data-testid="button-import-zones"><Upload size={16} aria-hidden="true" /> Import data</button>}
          {can('zone.export') && <DropdownMenu.Root open={exportMenuOpen} onOpenChange={(open) => { if (!open || !exportBusy.current) setExportMenuOpen(open); }}>
            <DropdownMenu.Trigger asChild>
              {/* Keep the pending trigger focusable for Radix's close-focus return.
                  The controlled menu and synchronous busy guard block reopening/downloads. */}
              <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || loading} aria-disabled={exporting || undefined} data-testid="button-export-zones"><Download size={16} aria-hidden="true" />{exporting ? 'Exporting…' : 'Export data'}</button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="admin-dropdown__menu admin-zone-export__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={6} collisionPadding={12} style={{ maxWidth: 'calc(100vw - 24px)' }} aria-label="Zone export format">
                <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('csv')}>CSV</DropdownMenu.Item>
                <DropdownMenu.Item className="admin-dropdown__item" disabled={exporting} onSelect={() => void exportVisible('xlsx')}>Excel (.xlsx)</DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>}
         {can('zone.add') && <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); setEditing('new'); }} data-testid="button-add-zone"><Plus size={16} aria-hidden="true" /> Add zone</button>}</div>}
      </div>
      {feedback && <div className="admin-feedback" role="status" data-testid="status-zone-feedback">{feedback}</div>}
      {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-zone-action-error">{actionError}</div>}
      <section className="admin-panel" aria-label="Zone list">
        <div className="admin-toolbar">
          <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={retry}>Refresh records</button>
          <div className="admin-toolbar__fields">
            <label className="admin-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search zones by name</span>
              <input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search by zone name" data-testid="input-search-zones" />
            </label>
            <div className="admin-filter">
              <label htmlFor="zone-filter">Status</label>
              <select id="zone-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-zones">
                <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>
        {loading ? <p className="admin-empty" role="status">Loading shared zones…</p> : error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><MapPinned size={21} /></span><strong>Zones could not be loaded</strong><p>{error}</p><button className="admin-button" style={{ marginTop: 16 }} onClick={retry} type="button" data-testid="button-retry-zones">Try again</button></div> : (
          <>
            {zones.length ? (cardView ? (
              <div className="admin-zone-cards" role="list" aria-label="Zone records">
                {pagination.pageRows.map((zone, index) => (
                  <article className="admin-zone-card" role="listitem" key={zone.id} data-testid={`card-zone-${zone.id}`}>
                    <div className="admin-zone-card__heading">
                      <div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{pagination.startIndex + index + 1}</span><h2 data-testid={`text-zone-name-${zone.id}`}>{zone.name}</h2></div>
                      <StatusBadge status={zone.status} id={zone.id} />
                    </div>
                    <dl className="admin-zone-card__meta">
                      <div><dt>Created</dt><dd>{details(zone.createdBy, zone.createdAt)}</dd></div>
                      <div><dt>Updated</dt><dd>{details(zone.updatedBy, zone.updatedAt)}</dd></div>
                    </dl>
                    {renderActions(zone, true)}
                  </article>
                ))}
              </div>
            ) : <DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(zone) => zone.id} />) : (
              <div className="admin-empty" data-testid="status-zones-empty">
                <span className="admin-empty__icon"><MapPinned size={21} aria-hidden="true" /></span>
                <strong>{total ? 'No matching zones' : 'No zones yet'}</strong>
                <p>{total ? 'Try a different name or status filter.' : 'Add your first zone to get started.'}</p>
              </div>
            )}
            <TablePagination {...pagination} filtered={filtered} total={total} label={total === 1 ? 'zone' : 'zones'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-zone-count" />
          </>
        )}
      </section>
      {editing && <ZoneForm zone={editing === 'new' ? null : editing} canSave={can(editing === 'new' ? 'zone.add' : 'zone.edit')} onSave={save} onClose={() => setEditing(null)} />}
      {confirming && <ConfirmationDialog pending={pending} blocked={blocked || !can(confirming.type === 'delete' ? 'zone.delete' : 'zone.edit')} title={`${actionName} zone?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.zone.name}”?${confirming.type === 'delete' ? ' It will disappear from normal lists and exports. Server deletion history is retained.' : ''}`} actionLabel={`${actionName} zone`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => { setConfirming(null); retry(); }} error={actionError} />}
    </AdminLayout>
  );
}