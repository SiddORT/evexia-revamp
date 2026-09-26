import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Pencil, Plus, Search, Trash2, MapPinned, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import ZoneForm from '../../components/admin/ZoneForm.jsx';
import MasterImportDialog from '../../components/admin/MasterImportDialog.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import useZones from '../../hooks/useZones.js';

const dateFormatter = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function details(by, at) {
  const parsed = new Date(at);
  return <span className="admin-table__details"><strong>{by}</strong><small>{Number.isNaN(parsed.getTime()) ? '—' : dateFormatter.format(parsed)}</small></span>;
}

export default function ZoneMaster() {
  const [, navigate] = useLocation();
  const { zones, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus, importRows } = useZones();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [importing, setImporting] = useState(false);
  const [cardView, setCardView] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const syncView = () => setCardView(media.matches);
    syncView();
    media.addEventListener('change', syncView);
    return () => media.removeEventListener('change', syncView);
  }, []);
  const visibleZones = useMemo(() => zones.filter((zone) =>
    zone.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) &&
    (filter === 'all' || zone.status === filter)), [zones, search, filter]);
  const pagination = useTablePagination(visibleZones);

  function save(values) {
    const result = editing === 'new' ? add(values) : edit(editing.id, values);
    if (result.success) setEditing(null);
    return result;
  }

  function confirmAction() {
    const { zone, type } = confirming;
    const result = type === 'delete' ? remove(zone.id) : changeStatus(zone.id, type === 'activate' ? 'active' : 'inactive');
    if (result.success) { setConfirming(null); setActionError(''); }
    else setActionError(result.error);
  }

  function requestAction(zone, type) {
    clearFeedback();
    setActionError('');
    setConfirming({ zone, type });
  }

  function renderActions(zone, mobile = false) {
    const toggleLabel = zone.status === 'active' ? 'Inactivate' : 'Activate';
    return <div className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`Edit ${zone.name}`} title="Edit" onClick={() => { clearFeedback(); setEditing(zone); }} data-testid={`button-edit-zone-${zone.id}`}>
        <Pencil size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Edit</span>}
      </button>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`${toggleLabel} ${zone.name}`} title={toggleLabel} onClick={() => requestAction(zone, toggleLabel.toLowerCase())} data-testid={`button-toggle-zone-${zone.id}`}>
        <CirclePower size={mobile ? 14 : 17} aria-hidden="true" />{mobile && <span>{toggleLabel}</span>}
      </button>
      <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${zone.name}`} title="Delete" onClick={() => requestAction(zone, 'delete')} data-testid={`button-delete-zone-${zone.id}`}>
        <Trash2 size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Delete</span>}
      </button>
    </div>;
  }

  const columns = [
    { key: 'serial', label: 'Sr No', render: (_zone, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Zone name', render: (zone) => <span className="admin-table__name" data-testid={`text-zone-name-${zone.id}`}>{zone.name}</span> },
    { key: 'status', label: 'Status', render: (zone) => <StatusBadge status={zone.status} id={zone.id} /> },
    { key: 'created', label: 'Created details', render: (zone) => details(zone.createdBy, zone.createdAt) },
    { key: 'updated', label: 'Updated details', render: (zone) => details(zone.updatedBy, zone.updatedAt) },
    { key: 'actions', label: 'Actions', render: (zone) => renderActions(zone) },
  ];

  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';

  return (
    <AdminLayout title="Zone Master">
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Geography</p><h1>Zone Master</h1><p className="admin-page-head__description">Manage the zones used across your EVEXIA workspace.</p></div>
         <div className="admin-mr-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/zone')} data-testid="button-import-zone-excel"><Upload size={16} aria-hidden="true" /> Import Excel</button>
         <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error)} onClick={() => { clearFeedback(); setImporting(true); }} data-testid="button-import-zones">Import CSV</button>
         <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); setEditing('new'); }} data-testid="button-add-zone"><Plus size={16} aria-hidden="true" /> Add zone</button></div>
      </div>
      {feedback && <div className="admin-feedback" role="status" data-testid="status-zone-feedback">{feedback}</div>}
      <section className="admin-panel" aria-label="Zone list">
        <div className="admin-toolbar">
          <div className="admin-toolbar__fields">
            <label className="admin-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search zones by name</span>
              <input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search by zone name" data-testid="input-search-zones" />
            </label>
            <div className="admin-filter">
              <label htmlFor="zone-filter">Status</label>
              <select id="zone-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-zones">
                <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </div>
        {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><MapPinned size={21} /></span><strong>Zones could not be loaded</strong><p>{error}</p><button className="admin-button" style={{ marginTop: 16 }} onClick={retry} type="button" data-testid="button-retry-zones">Try again</button></div> : (
          <>
            {visibleZones.length ? (cardView ? (
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
                <strong>{zones.length ? 'No matching zones' : 'No zones yet'}</strong>
                <p>{zones.length ? 'Try a different name or status filter.' : 'Add your first zone to get started.'}</p>
              </div>
            )}
            <TablePagination {...pagination} filtered={visibleZones.length} total={zones.length} label={zones.length === 1 ? 'zone' : 'zones'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-zone-count" />
          </>
        )}
      </section>
      {editing && <ZoneForm zone={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
      {confirming && <ConfirmationDialog title={`${actionName} zone?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.zone.name}”?${confirming.type === 'delete' ? ' This cannot be undone.' : ''}`} actionLabel={`${actionName} zone`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => setConfirming(null)} error={actionError} />}
      {importing && <MasterImportDialog kind="zone" onImport={importRows} onClose={() => setImporting(false)} />}
    </AdminLayout>
  );
}