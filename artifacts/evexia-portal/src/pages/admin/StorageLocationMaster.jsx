import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Download, FolderOpen, Pencil, Plus, Search, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useStorageLocations from '../../hooks/useStorageLocations.js';
import useTablePagination from '../../hooks/useTablePagination.js';
import { STORAGE_LOCATION_COLUMNS, storageLocationCSVTemplate, exportStorageLocationCSV, loadStorageLocations, reviewStorageLocationCSV } from '../../services/storageLocations.js';
import { parseCSV } from '../../services/masterImport.js';
import '../../mr.css';
import '../../category.css';
import '../../storageLocation.css';

const LIST_PATH = '/admin/masters/storage-locations';
const dateFormat = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function downloadCSV(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function audit(name, value) {
  const date = value ? new Date(value) : null;
  return <span className="admin-category-audit"><strong>{name || '—'}</strong>{date && !Number.isNaN(date.getTime()) ? <time dateTime={value}>{dateFormat.format(date)}</time> : <span>—</span>}</span>;
}

function StorageLocationImportDialog({ records, onImport, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const invalid = review?.entries.filter((entry) => entry.errors.length) || [];
  const valid = review ? review.entries.length - invalid.length : 0;

  function close() { sequence.current += 1; onClose(); }
  function template() {
    try { downloadCSV(storageLocationCSVTemplate(), 'evexia-storage-location-template.csv'); }
    catch { setMessage('The CSV template could not be downloaded. Please try again.'); }
  }
  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReview(null);
    setMessage('');
    if (!file) return;
    const current = ++sequence.current;
    if (!/\.csv$/i.test(file.name) || file.size > 2_000_000) {
      setMessage('Choose a .csv file smaller than 2 MB.');
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (current !== sequence.current) return;
      parseCSV(text);
      const snapshot = loadStorageLocations();
      if (!same(snapshot, records)) throw new Error('Saved locations changed in another tab. Refresh records before reviewing this file.');
      const entries = reviewStorageLocationCSV(text, snapshot);
      setReview({ fileName: file.name, entries, snapshot });
    } catch (cause) {
      if (current === sequence.current) setMessage(cause.message || 'Could not read this CSV file.');
    } finally {
      if (current === sequence.current) setReading(false);
    }
  }
  function confirm() {
    if (!review || !review.entries.length || invalid.length) return;
    setMessage('');
    try {
      const result = onImport(review.entries, review.snapshot);
      if (result.success) close();
      else setMessage(result.error || 'Import failed. No locations were saved.');
    } catch (cause) { setMessage(cause.message || 'Import failed. No locations were saved.'); }
  }

  return <Dialog title="Import storage locations" eyebrow="Storage Location Master" description="Review a local CSV before adding its locations. Existing records are never replaced." onClose={close} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-storage-import">Cancel</button><button type="button" className="admin-button" disabled={!review || !valid || invalid.length > 0 || reading || Boolean(message)} onClick={confirm} data-testid="button-confirm-storage-import">Import {valid} {valid === 1 ? 'location' : 'locations'}</button></>}>
    <div className="admin-category-import">
      <div className="admin-category-import__guide"><strong>CSV columns (exact order)</strong><p>{STORAGE_LOCATION_COLUMNS.map(([, label]) => label).join(', ')}. Status must be active or inactive. IDs and audit fields are not accepted.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={template} data-testid="button-storage-template"><Download size={16} aria-hidden="true" /> Download CSV template</button>
      <label className="admin-category-import__file">Choose a local CSV file<input type="file" accept=".csv,text/csv" onChange={choose} data-testid="input-storage-import" /></label>
      {reading && <p role="status">Reading CSV file…</p>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      {review && <div className="admin-category-import__review" aria-live="polite">
        <p><strong>{review.fileName}</strong> — {valid} valid {valid === 1 ? 'row' : 'rows'}, {invalid.length} with errors. {invalid.length ? 'Correct the file and choose it again; nothing was saved.' : 'Review the rows before importing the whole batch.'}</p>
        <div className="admin-category-import__rows" role="list" aria-label="Storage location CSV rows">
          {review.entries.map((entry) => <div role="listitem" className={`admin-category-import__row${entry.errors.length ? ' admin-category-import__row--error' : ''}`} key={entry.line}>
            {entry.values || entry.fields ? <details><summary>Line {entry.line}: {entry.values?.name || entry.fields?.name || '(unnamed)'} — {entry.errors.length ? `${entry.errors.length} ${entry.errors.length === 1 ? 'error' : 'errors'}` : 'Ready to add'}</summary>
              <dl>{STORAGE_LOCATION_COLUMNS.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{entry.values?.[field] ?? entry.fields?.[field] ?? '—'}</dd></div>)}</dl>
            </details> : <strong>Line {entry.line}: malformed row</strong>}
            {entry.errors.length > 0 && <ul>{entry.errors.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
          </div>)}
        </div>
      </div>}
    </div>
  </Dialog>;
}

export default function StorageLocationMaster() {
  const [, navigate] = useLocation();
  const { records, error, feedback, retry, clearFeedback, changeStatus, importRows } = useStorageLocations();
  const [saveFeedback] = useState(() => {
    const saved = new URLSearchParams(window.location.search).get('saved');
    return saved === 'added' ? 'Storage location added successfully.' : saved === 'updated' ? 'Storage location updated successfully.' : '';
  });
  useEffect(() => {
    if (saveFeedback) window.history.replaceState(window.history.state, '', LIST_PATH);
  }, [saveFeedback]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirming, setConfirming] = useState(null);
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const visible = useMemo(() => records.filter((record) => {
    const query = search.trim().toLocaleLowerCase();
    return (!query || [record.name, record.address].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      && (statusFilter === 'all' || record.status === statusFilter);
  }), [records, search, statusFilter]);
  const pagination = useTablePagination(visible);

  function refresh() { retry(); setConfirming(null); setImporting(false); setActionError(''); }
  function toggle() {
    const target = confirming.status === 'active' ? 'inactive' : 'active';
    try {
      const result = changeStatus(confirming.id, target);
      if (result.success) { setConfirming(null); setActionError(''); }
      else setActionError(result.error || 'Status could not be changed. Refresh records and try again.');
    } catch (cause) { setActionError(cause.message || 'Status could not be changed.'); }
  }
  function exportVisible() {
    if (error || !visible.length) return;
    try {
      if (!same(loadStorageLocations(), records)) {
        setActionError('Saved locations changed in another tab. Refresh records before exporting.');
        return;
      }
      downloadCSV(exportStorageLocationCSV(visible), 'evexia-storage-locations.csv');
      setActionError('');
    } catch (cause) { setActionError(cause.message || 'CSV export failed. Please try again.'); }
  }
  function actions(record, compact = false) {
    return <div className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => { clearFeedback(); navigate(`${LIST_PATH}/${encodeURIComponent(record.id)}`); }} aria-label={`Edit ${record.name}`} title="Edit" data-testid={`button-edit-storage-${record.id}`}><Pencil size={16} aria-hidden="true" />{compact && 'Edit'}</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => { clearFeedback(); setActionError(''); setConfirming(record); }} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} data-testid={`button-toggle-storage-${record.id}`}><CirclePower size={16} aria-hidden="true" />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
    </div>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'name', label: 'Storage location', render: (record) => <strong className="admin-category-name">{record.name}</strong> },
    { key: 'address', label: 'Address', render: (record) => <span className="admin-storage-address">{record.address || '—'}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="storage-location" /> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];

  return <AdminLayout title="Storage Location Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Inventory</p><h1>Storage Location Master</h1><p className="admin-page-head__description">Keep your storage locations, addresses and availability in one place.</p></div>
      <div className="admin-category-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-storage-locations">Refresh records</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error)} onClick={() => { setActionError(''); setImporting(true); }} data-testid="button-import-storage-locations"><Upload size={16} aria-hidden="true" /> Import data</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-storage-locations"><Download size={16} aria-hidden="true" /> Export data</button>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate(`${LIST_PATH}/new`); }} data-testid="button-add-storage-location"><Plus size={16} aria-hidden="true" /> Add location</button>
      </div>
    </div>
    {(feedback || saveFeedback) && <div className="admin-feedback" role="status" data-testid="status-storage-feedback">{feedback || saveFeedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Storage location list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search storage locations</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search location or address" data-testid="input-search-storage-locations" /></label>
        <div className="admin-filter"><label htmlFor="storage-status-filter">Status</label><select id="storage-status-filter" className="admin-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-storage-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>Locations could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={refresh} style={{ marginTop: 16 }} data-testid="button-retry-storage-locations">Refresh records</button></div> : <>
        {visible.length ? <>
          <div className="admin-storage-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Storage location records" testIdPrefix="storage-location" /></div>
          <div className="admin-storage-mobile" role="list" aria-label="Storage location records">{pagination.pageRows.map((record, index) => <article className="admin-mr-card" role="listitem" key={record.id} data-testid={`card-storage-${record.id}`}>
            <div className="admin-mr-card__head"><div className="admin-mr-card__identity"><span className="admin-mr-card__subtitle">#{pagination.startIndex + index + 1} · Storage location</span><h2 className="admin-mr-card__name">{record.name}</h2></div><StatusBadge status={record.status} id={record.id} kind="storage-location" /></div>
            <dl className="admin-mr-card__meta"><div><dt>Address</dt><dd className="admin-storage-address">{record.address || '—'}</dd></div><div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-storage-empty"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching locations' : 'No storage locations yet'}</strong><p>{records.length ? 'Try another search or status filter.' : 'Add a location to start keeping your storage directory.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={visible.length === 1 ? 'location' : 'locations'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-storage-count" />
      </>}
    </section>
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} location?`} description={`Change “${confirming.name}” to ${confirming.status === 'active' ? 'inactive' : 'active'}? Its saved details will remain available in this browser.`} actionLabel={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} location`} onConfirm={toggle} onClose={() => { setConfirming(null); setActionError(''); }} error={actionError} />}
    {importing && <StorageLocationImportDialog records={records} onImport={importRows} onClose={() => setImporting(false)} />}
  </AdminLayout>;
}