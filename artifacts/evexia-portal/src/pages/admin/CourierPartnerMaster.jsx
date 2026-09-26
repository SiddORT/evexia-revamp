import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Download, Pencil, Plus, Search, Trash2, Truck, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import CourierPartnerForm from '../../components/admin/CourierPartnerForm.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useCourierPartners from '../../hooks/useCourierPartners.js';
import useTablePagination from '../../hooks/useTablePagination.js';
import { exportCourierPartnerCSV, loadCourierPartners } from '../../services/courierPartners.js';

const formatter = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function details(by, at) {
  const date = new Date(at);
  return <span className="admin-table__details"><strong>{by}</strong><small>{Number.isNaN(date.getTime()) ? '—' : formatter.format(date)}</small></span>;
}

export default function CourierPartnerMaster() {
  const [, navigate] = useLocation();
  const { records, error, feedback, clearFeedback, retry, add, edit, remove, changeStatus } = useCourierPartners();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [actionError, setActionError] = useState('');
  const [cardView, setCardView] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const sync = () => setCardView(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const visible = useMemo(() => records.filter((record) =>
    record.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    && (filter === 'all' || record.status === filter)), [records, search, filter]);
  const pagination = useTablePagination(visible);

  function save(values) {
    const result = editing === 'new' ? add(values) : edit(editing.id, values);
    if (result.success) setEditing(null);
    return result;
  }
  function requestAction(record, type) {
    clearFeedback();
    setActionError('');
    setConfirming({ record, type });
  }
  function confirmAction() {
    const { record, type } = confirming;
    const result = type === 'delete' ? remove(record.id) : changeStatus(record.id, type === 'activate' ? 'active' : 'inactive');
    if (result.success) { setConfirming(null); setActionError(''); }
    else setActionError(result.error);
  }
  function exportVisible() {
    if (error || !visible.length) return;
    setActionError('');
    try {
      if (JSON.stringify(loadCourierPartners()) !== JSON.stringify(records)) {
        setActionError('Courier partners changed in another tab. Refresh records before exporting.');
        return;
      }
      const url = URL.createObjectURL(new Blob([exportCourierPartnerCSV(visible)], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'evexia-courier-partner-master.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setActionError(cause.message || 'CSV export failed. Refresh records and try again.');
    }
  }
  function actions(record, mobile = false) {
    const toggle = record.status === 'active' ? 'Inactivate' : 'Activate';
    return <div className={mobile ? 'admin-zone-card__actions' : 'admin-table__actions'}>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`Edit ${record.name}`} title="Edit" onClick={() => { clearFeedback(); setEditing(record); }} data-testid={`button-edit-courier-partner-${record.id}`}><Pencil size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Edit</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action' : 'admin-icon-button'} aria-label={`${toggle} ${record.name}`} title={toggle} onClick={() => requestAction(record, toggle.toLowerCase())} data-testid={`button-toggle-courier-partner-${record.id}`}><CirclePower size={mobile ? 14 : 17} aria-hidden="true" />{mobile && <span>{toggle}</span>}</button>
      <button type="button" className={mobile ? 'admin-zone-card__action admin-zone-card__action--danger' : 'admin-icon-button admin-icon-button--danger'} aria-label={`Delete ${record.name}`} title="Delete" onClick={() => requestAction(record, 'delete')} data-testid={`button-delete-courier-partner-${record.id}`}><Trash2 size={mobile ? 14 : 16} aria-hidden="true" />{mobile && <span>Delete</span>}</button>
    </div>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No', render: (_record, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'name', label: 'Courier partner name', render: (record) => <span className="admin-table__name" data-testid={`text-courier-partner-name-${record.id}`}>{record.name}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} /> },
    { key: 'created', label: 'Created details', render: (record) => details(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => details(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  const actionName = confirming?.type === 'delete' ? 'Delete' : confirming?.type === 'activate' ? 'Activate' : 'Inactivate';
  return <AdminLayout title="Courier Partner Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Delivery</p><h1>Courier Partner Master</h1><p className="admin-page-head__description">Manage courier partners in this browser.</p></div>
      <div className="admin-mr-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/import/courier-partner')} data-testid="button-import-courier-partners"><Upload size={16} aria-hidden="true" /> Import data</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-courier-partners"><Download size={16} aria-hidden="true" /> Export data</button>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); setEditing('new'); }} data-testid="button-add-courier-partner"><Plus size={16} aria-hidden="true" /> Add courier partner</button>
      </div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-courier-partner-feedback">{feedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-courier-partner-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Courier partner list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search courier partners by name</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search by courier partner name" data-testid="input-search-courier-partners" /></label>
        <div className="admin-filter"><label htmlFor="courier-partner-filter">Status</label><select id="courier-partner-filter" className="admin-select" value={filter} onChange={(event) => { setFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-courier-partners"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><Truck size={21} /></span><strong>Courier partners could not be loaded</strong><p>{error}</p><button className="admin-button" style={{ marginTop: 16 }} type="button" onClick={retry} data-testid="button-retry-courier-partners">Try again</button></div> : <>
        {visible.length ? (cardView ? <div className="admin-zone-cards" role="list" aria-label="Courier partner records">
          {pagination.pageRows.map((record, index) => <article className="admin-zone-card" role="listitem" key={record.id} data-testid={`card-courier-partner-${record.id}`}>
            <div className="admin-zone-card__heading"><div className="admin-zone-card__title"><span className="admin-zone-card__serial">#{pagination.startIndex + index + 1}</span><h2 data-testid={`text-courier-partner-name-${record.id}`}>{record.name}</h2></div><StatusBadge status={record.status} id={record.id} /></div>
            <dl className="admin-zone-card__meta"><div><dt>Created</dt><dd>{details(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated</dt><dd>{details(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}
        </div> : <DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} />) : <div className="admin-empty" data-testid="status-courier-partners-empty"><span className="admin-empty__icon"><Truck size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching courier partners' : 'No courier partners yet'}</strong><p>{records.length ? 'Try a different name or status filter.' : 'Add your first courier partner to get started.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={records.length === 1 ? 'courier partner' : 'courier partners'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-courier-partner-count" />
      </>}
    </section>
    {editing && <CourierPartnerForm partner={editing === 'new' ? null : editing} onSave={save} onClose={() => setEditing(null)} />}
    {confirming && <ConfirmationDialog title={`${actionName} courier partner?`} description={`Are you sure you want to ${actionName.toLowerCase()} “${confirming.record.name}”?${confirming.type === 'delete' ? ' This cannot be undone.' : ''}`} actionLabel={`${actionName} courier partner`} destructive={confirming.type === 'delete'} onConfirm={confirmAction} onClose={() => setConfirming(null)} error={actionError} />}
  </AdminLayout>;
}