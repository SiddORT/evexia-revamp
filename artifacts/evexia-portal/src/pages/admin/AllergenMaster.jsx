import { downloadCSV as loggedCSV } from '../../services/downloads.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Download, FlaskConical, Pencil, Plus, Search, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useAllergens from '../../hooks/useAllergens.js';
import useTablePagination from '../../hooks/useTablePagination.js';
import { ALLERGEN_COLUMNS, allergenCSVTemplate, exportAllergenCSV, loadAllergens, loadAllergenReferences, referenceLabel, reviewAllergenCSV } from '../../services/allergens.js';
import { parseCSV } from '../../services/masterImport.js';
import '../../mr.css';
import '../../allergen.css';

const LIST_PATH = '/admin/masters/allergens';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function downloadCSV(text, filename) {
  return loggedCSV(text, filename, 'allergen', filename.includes('template') ? 'template' : 'export');
}

function audit(name, value) {
  return <span className="admin-allergen-audit"><strong>{name || '—'}</strong><time dateTime={value}>{formatAdminTimestamp(value, undefined, true)}</time></span>;
}

function AllergenImportDialog({ records, refs, onImport, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const invalid = review?.entries.filter((entry) => entry.errors.length) || [];
  const valid = review ? review.entries.length - invalid.length : 0;

  function close() { sequence.current += 1; onClose(); }
  async function template() {
    try { await downloadCSV(allergenCSVTemplate(), 'evexia-allergen-template.csv'); }
    catch (cause) { setMessage(cause.message || 'The CSV template could not be downloaded. Please try again.'); }
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
      const referenceSnapshot = loadAllergenReferences();
      const snapshot = loadAllergens(referenceSnapshot);
      if (!same(snapshot, records) || !same(referenceSnapshot, refs)) throw new Error('Saved products or reference masters changed in another tab. Refresh records before reviewing this file.');
      const entries = reviewAllergenCSV(text, snapshot, referenceSnapshot);
      setReview({ fileName: file.name, entries, snapshot, referenceSnapshot });
    } catch (cause) {
      if (current === sequence.current) setMessage(cause.message || 'Could not read this CSV file.');
    } finally {
      if (current === sequence.current) setReading(false);
    }
  }
  function confirm() {
    if (!review || !review.entries.length || invalid.length || reading) return;
    setMessage('');
    try {
      const result = onImport(review.entries, review.snapshot, review.referenceSnapshot);
      if (result.success) close();
      else setMessage(result.error || 'Import failed. No products were saved.');
    } catch (cause) { setMessage(cause.message || 'Import failed. No products were saved.'); }
  }

  return <Dialog title="Import allergens" eyebrow="Allergen Master" description="Review a local CSV before adding products. The entire batch is saved only when every row is valid." onClose={close} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-allergen-import">Cancel</button><button type="button" className="admin-button" disabled={!review || !valid || invalid.length > 0 || reading || Boolean(message)} onClick={confirm} data-testid="button-confirm-allergen-import">Import {valid} {valid === 1 ? 'product' : 'products'}</button></>}>
    <div className="admin-allergen-import">
      <div className="admin-allergen-import__guide"><strong>CSV columns (exact order)</strong><p>{ALLERGEN_COLUMNS.map(([, label]) => label).join(', ')}. Category and Storage Location must match active master names. Use active or inactive for Status, and Allergens or No Mix for the final column. Leave optional values blank. IDs and audit details are not imported.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={template} data-testid="button-allergen-template"><Download size={16} aria-hidden="true" /> Download CSV template</button>
      <label className="admin-allergen-import__file">Choose a local CSV file<input type="file" accept=".csv,text/csv" onChange={choose} data-testid="input-allergen-import" /></label>
      {reading && <p role="status">Reading CSV file…</p>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      {review && <div className="admin-allergen-import__review" aria-live="polite">
        <p><strong>{review.fileName}</strong> — {valid} valid {valid === 1 ? 'row' : 'rows'}, {invalid.length} with errors. {invalid.length ? 'Correct the file and choose it again; nothing was saved.' : review.entries.length ? 'Review the rows before importing the whole batch.' : 'The file contains no product rows.'}</p>
        <div className="admin-allergen-import__rows" role="list" aria-label="Allergen CSV rows">
          {review.entries.map((entry) => <div role="listitem" className={`admin-allergen-import__row${entry.errors.length ? ' admin-allergen-import__row--error' : ''}`} key={entry.line}>
            {entry.values || entry.fields ? <details><summary>Line {entry.line}: {entry.values?.name || entry.fields?.name || '(unnamed)'} — {entry.errors.length ? `${entry.errors.length} ${entry.errors.length === 1 ? 'error' : 'errors'}` : 'Ready to add'}</summary>
              <dl>{ALLERGEN_COLUMNS.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{entry.values?.[field] ?? entry.fields?.[field] ?? '—'}</dd></div>)}</dl>
            </details> : <strong>Line {entry.line}: malformed row</strong>}
            {entry.errors.length > 0 && <ul>{entry.errors.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
          </div>)}
        </div>
      </div>}
    </div>
  </Dialog>;
}

export default function AllergenMaster() {
  useAdminPreferences();
  const [, navigate] = useLocation();
  const { records, refs, error, feedback, retry, clearFeedback, changeStatus, importRows } = useAllergens();
  const [saveFeedback] = useState(() => {
    const saved = new URLSearchParams(window.location.search).get('saved');
    return saved === 'added' ? 'Product added successfully.' : saved === 'updated' ? 'Product updated successfully.' : '';
  });
  useEffect(() => {
    if (saveFeedback) window.history.replaceState(window.history.state, '', LIST_PATH);
  }, [saveFeedback]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [confirming, setConfirming] = useState(null);
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const categories = refs?.categories || [];
  const locations = refs?.locations || [];
  const visible = useMemo(() => records.filter((record) => {
    const query = search.trim().toLocaleLowerCase();
    return (!query || [record.name, referenceLabel(categories, record.categoryId, 'category'), referenceLabel(locations, record.storageLocationId, 'storage location'), record.concentration, record.hsnCode, record.sellingPrice].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)))
      && (statusFilter === 'all' || record.status === statusFilter);
  }), [records, categories, locations, search, statusFilter]);
  const pagination = useTablePagination(visible);

  function refresh() { retry(); setConfirming(null); setImporting(false); setActionError(''); }
  function toggle() {
    if (!confirming) return;
    const target = confirming.status === 'active' ? 'inactive' : 'active';
    try {
      const result = changeStatus(confirming.id, target);
      if (result.success) { setConfirming(null); setActionError(''); }
      else setActionError(result.error || 'Status could not be changed. Refresh records and try again.');
    } catch (cause) { setActionError(cause.message || 'Status could not be changed.'); }
  }
  async function exportVisible() {
    if (error || !visible.length) return;
    try {
      const currentRefs = loadAllergenReferences();
      if (!same(currentRefs, refs) || !same(loadAllergens(currentRefs), records)) {
        setActionError('Saved products or reference masters changed in another tab. Refresh records before exporting.');
        return;
      }
      await downloadCSV(exportAllergenCSV(visible, currentRefs), 'evexia-allergens.csv');
      setActionError('');
    } catch (cause) { setActionError(cause.message || 'CSV export failed. Please try again.'); }
  }
  function actions(record, compact = false) {
    return <div className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => { clearFeedback(); navigate(`${LIST_PATH}/${encodeURIComponent(record.id)}`); }} aria-label={`Edit ${record.name}`} title="Edit" data-testid={`button-edit-allergen-${record.id}`}><Pencil size={16} aria-hidden="true" />{compact && 'Edit'}</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => { clearFeedback(); setActionError(''); setConfirming(record); }} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} data-testid={`button-toggle-allergen-${record.id}`}><CirclePower size={16} aria-hidden="true" />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
    </div>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'name', label: 'Product Name', render: (record) => <span><strong className="admin-allergen-name">{record.name}</strong><span className="admin-allergen-secondary">{record.allergens ? 'Allergens' : 'No Mix'}</span></span> },
    { key: 'category', label: 'Category', render: (record) => <span className="admin-allergen-reference">{referenceLabel(categories, record.categoryId, 'category')}</span> },
    { key: 'price', label: 'Selling Price', render: (record) => <span className="admin-allergen-number" data-testid={`text-allergen-price-${record.id}`}>{record.sellingPrice === '' ? '—' : String(record.sellingPrice)}</span> },
    { key: 'location', label: 'Storage Location', render: (record) => <span className="admin-allergen-reference">{referenceLabel(locations, record.storageLocationId, 'storage location')}</span> },
    { key: 'concentration', label: 'Concentration', render: (record) => record.concentration },
    { key: 'hsn', label: 'HSN', render: (record) => record.hsnCode || '—' },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="allergen" /> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];

  return <AdminLayout title="Allergen Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Inventory</p><h1>Allergen Master</h1><p className="admin-page-head__description">Maintain product identity, reference masters, pricing and handling details in this browser.</p></div>
      <div className="admin-allergen-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-allergens">Refresh records</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={async () => {
          try { await downloadCSV(allergenCSVTemplate(), 'evexia-allergen-template.csv'); setActionError(''); }
          catch (cause) { setActionError(cause.message || 'The CSV template could not be downloaded. Please try again.'); }
        }} data-testid="button-download-allergen-template"><Download size={16} aria-hidden="true" /> CSV template</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error)} onClick={() => { setActionError(''); setImporting(true); }} data-testid="button-import-allergens"><Upload size={16} aria-hidden="true" /> Import data</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-allergens"><Download size={16} aria-hidden="true" /> Export data</button>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate(`${LIST_PATH}/new`); }} data-testid="button-add-allergen"><Plus size={16} aria-hidden="true" /> Add product</button>
      </div>
    </div>
    {(feedback || saveFeedback) && <div className="admin-feedback" role="status" data-testid="status-allergen-feedback">{feedback || saveFeedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Allergen list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search products</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search product, category, location or HSN" data-testid="input-search-allergens" /></label>
        <div className="admin-filter"><label htmlFor="allergen-status-filter">Status</label><select id="allergen-status-filter" className="admin-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-allergen-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><FlaskConical size={21} aria-hidden="true" /></span><strong>Products could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={refresh} style={{ marginTop: 16 }} data-testid="button-retry-allergens">Refresh records</button></div> : <>
        {visible.length ? <>
          <div className="admin-allergen-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Allergen records" testIdPrefix="allergen" /></div>
          <div className="admin-allergen-mobile" role="list" aria-label="Allergen records">{pagination.pageRows.map((record, index) => <article className="admin-mr-card" role="listitem" key={record.id} data-testid={`card-allergen-${record.id}`}>
            <div className="admin-mr-card__head"><div className="admin-mr-card__identity"><span className="admin-mr-card__subtitle">#{pagination.startIndex + index + 1} · {record.allergens ? 'Allergens' : 'No Mix'}</span><h2 className="admin-mr-card__name">{record.name}</h2></div><StatusBadge status={record.status} id={record.id} kind="allergen" /></div>
            <dl className="admin-mr-card__meta"><div><dt>Category</dt><dd>{referenceLabel(categories, record.categoryId, 'category')}</dd></div><div><dt>Selling Price</dt><dd className="admin-allergen-number">{record.sellingPrice === '' ? '—' : String(record.sellingPrice)}</dd></div><div><dt>Storage Location</dt><dd>{referenceLabel(locations, record.storageLocationId, 'storage location')}</dd></div><div><dt>Concentration</dt><dd>{record.concentration}</dd></div><div><dt>GST</dt><dd>{record.gst}%</dd></div><div><dt>Threshold limit</dt><dd>{record.thresholdLimit === '' ? '—' : String(record.thresholdLimit)}</dd></div><div><dt>HSN</dt><dd>{record.hsnCode || '—'}</dd></div><div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-allergens-empty"><span className="admin-empty__icon"><FlaskConical size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching products' : 'No products yet'}</strong><p>{records.length ? 'Try another search or status filter.' : 'Add a product to begin your browser-local allergen catalog.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={visible.length === 1 ? 'product' : 'products'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-allergen-count" />
      </>}
    </section>
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} product?`} description={`Change “${confirming.name}” to ${confirming.status === 'active' ? 'inactive' : 'active'}? Its details will remain available in this browser.`} actionLabel={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} product`} onConfirm={toggle} onClose={() => { setConfirming(null); setActionError(''); }} error={actionError} />}
    {importing && <AllergenImportDialog records={records} refs={refs} onImport={importRows} onClose={() => setImporting(false)} />}
  </AdminLayout>;
}