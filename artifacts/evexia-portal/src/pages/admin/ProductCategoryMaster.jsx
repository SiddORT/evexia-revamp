import { downloadCSV as loggedCSV } from '../../services/downloads.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Download, FolderOpen, Pencil, Plus, Search, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useProductCategories from '../../hooks/useProductCategories.js';
import useTablePagination from '../../hooks/useTablePagination.js';
import { CATEGORY_COLUMNS, categoryCSVTemplate, exportCategoryCSV, loadCategories, reviewCategoryCSV } from '../../services/productCategories.js';
import { parseCSV } from '../../services/masterImport.js';
import '../../mr.css';
import '../../category.css';

const LIST_PATH = '/admin/masters/product-categories';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function downloadCSV(text, filename) {
  return loggedCSV(text, filename, 'product_category', filename.includes('template') ? 'template' : 'export');
}

function audit(name, value) {
  return <span className="admin-category-audit"><strong>{name || '—'}</strong><time dateTime={value}>{formatAdminTimestamp(value, undefined, true)}</time></span>;
}

function CategoryImportDialog({ records, onImport, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const invalid = review?.entries.filter((entry) => entry.errors.length) || [];
  const valid = review ? review.entries.length - invalid.length : 0;

  function close() { sequence.current += 1; onClose(); }
  async function template() {
    try { await downloadCSV(categoryCSVTemplate(), 'evexia-product-category-template.csv'); }
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
      // Parse first so malformed quoting and oversized files fail before the row review.
      parseCSV(text);
      const snapshot = loadCategories();
      if (!same(snapshot, records)) throw new Error('Saved categories changed in another tab. Refresh records before reviewing this file.');
      const entries = reviewCategoryCSV(text, snapshot);
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
      else setMessage(result.error || 'Import failed. No categories were saved.');
    } catch (cause) { setMessage(cause.message || 'Import failed. No categories were saved.'); }
  }

  return <Dialog title="Import product categories" eyebrow="Product Category Master" description="Review a local CSV before adding its categories. Existing records are never replaced." onClose={close} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-category-import">Cancel</button><button type="button" className="admin-button" disabled={!review || !valid || invalid.length > 0 || reading || Boolean(message)} onClick={confirm} data-testid="button-confirm-category-import">Import {valid} {valid === 1 ? 'category' : 'categories'}</button></>}>
    <div className="admin-category-import">
      <div className="admin-category-import__guide"><strong>CSV columns (exact order)</strong><p>{CATEGORY_COLUMNS.map(([, label]) => label).join(', ')}. Status must be active or inactive. Leave Description blank if not needed. IDs and audit fields are not accepted.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={template} data-testid="button-category-template"><Download size={16} aria-hidden="true" /> Download CSV template</button>
      <label className="admin-category-import__file">Choose a local CSV file<input type="file" accept=".csv,text/csv" onChange={choose} data-testid="input-category-import" /></label>
      {reading && <p role="status">Reading CSV file…</p>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      {review && <div className="admin-category-import__review" aria-live="polite">
        <p><strong>{review.fileName}</strong> — {valid} valid {valid === 1 ? 'row' : 'rows'}, {invalid.length} with errors. {invalid.length ? 'Correct the file and choose it again; nothing was saved.' : 'Review the rows before importing the whole batch.'}</p>
        <div className="admin-category-import__rows" role="list" aria-label="Category CSV rows">
          {review.entries.map((entry) => <div role="listitem" className={`admin-category-import__row${entry.errors.length ? ' admin-category-import__row--error' : ''}`} key={entry.line}>
            {entry.values || entry.fields ? <details><summary>Line {entry.line}: {entry.values?.name || entry.fields?.name || '(unnamed)'} — {entry.errors.length ? `${entry.errors.length} ${entry.errors.length === 1 ? 'error' : 'errors'}` : 'Ready to add'}</summary>
              <dl>{CATEGORY_COLUMNS.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{entry.values?.[field] ?? entry.fields?.[field] ?? '—'}</dd></div>)}</dl>
            </details> : <strong>Line {entry.line}: malformed row</strong>}
            {entry.errors.length > 0 && <ul>{entry.errors.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
          </div>)}
        </div>
      </div>}
    </div>
  </Dialog>;
}

export default function ProductCategoryMaster() {
  useAdminPreferences();
  const [, navigate] = useLocation();
  const { records, error, feedback, retry, clearFeedback, changeStatus, importRows } = useProductCategories();
  const [saveFeedback] = useState(() => {
    const saved = new URLSearchParams(window.location.search).get('saved');
    return saved === 'added' ? 'Product category added successfully.' : saved === 'updated' ? 'Product category updated successfully.' : '';
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
    return (!query || [record.name, record.description, String(record.unitPrice)].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
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
  async function exportVisible() {
    if (error || !visible.length) return;
    try {
      if (!same(loadCategories(), records)) {
        setActionError('Saved categories changed in another tab. Refresh records before exporting.');
        return;
      }
      await downloadCSV(exportCategoryCSV(visible), 'evexia-product-categories.csv');
      setActionError('');
    } catch (cause) { setActionError(cause.message || 'CSV export failed. Please try again.'); }
  }
  function actions(record, compact = false) {
    return <div className={compact ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => { clearFeedback(); navigate(`${LIST_PATH}/${encodeURIComponent(record.id)}`); }} aria-label={`Edit ${record.name}`} title="Edit" data-testid={`button-edit-category-${record.id}`}><Pencil size={16} aria-hidden="true" />{compact && 'Edit'}</button>
      <button type="button" className={compact ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => { clearFeedback(); setActionError(''); setConfirming(record); }} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} ${record.name}`} title={record.status === 'active' ? 'Inactivate' : 'Activate'} data-testid={`button-toggle-category-${record.id}`}><CirclePower size={16} aria-hidden="true" />{compact && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
    </div>;
  }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'name', label: 'Category name', render: (record) => <strong className="admin-category-name">{record.name}</strong> },
    { key: 'description', label: 'Description', render: (record) => <span className="admin-category-description">{record.description || '—'}</span> },
    { key: 'price', label: 'Unit price', render: (record) => <span className="admin-category-price" data-testid={`text-category-price-${record.id}`}>{String(record.unitPrice)}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="category" /> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];

  return <AdminLayout title="Product Category Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Inventory</p><h1>Product Category Master</h1><p className="admin-page-head__description">Maintain category names, descriptions, prices and availability in this browser.</p></div>
      <div className="admin-category-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-categories">Refresh records</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error)} onClick={() => { setActionError(''); setImporting(true); }} data-testid="button-import-categories"><Upload size={16} aria-hidden="true" /> Import data</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || !visible.length} onClick={exportVisible} data-testid="button-export-categories"><Download size={16} aria-hidden="true" /> Export data</button>
        <button type="button" className="admin-button" disabled={Boolean(error)} onClick={() => { clearFeedback(); navigate(`${LIST_PATH}/new`); }} data-testid="button-add-category"><Plus size={16} aria-hidden="true" /> Add category</button>
      </div>
    </div>
    {(feedback || saveFeedback) && <div className="admin-feedback" role="status" data-testid="status-category-feedback">{feedback || saveFeedback}</div>}
    {actionError && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{actionError}</div>}
    <section className="admin-panel" aria-label="Product category list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields">
        <label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search categories</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search category, description or price" data-testid="input-search-categories" /></label>
        <div className="admin-filter"><label htmlFor="category-status-filter">Status</label><select id="category-status-filter" className="admin-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); pagination.resetPage(); }} data-testid="select-filter-category-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>Categories could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={refresh} style={{ marginTop: 16 }} data-testid="button-retry-categories">Refresh records</button></div> : <>
        {visible.length ? <>
          <div className="admin-category-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Product category records" testIdPrefix="category" /></div>
          <div className="admin-category-mobile" role="list" aria-label="Product category records">{pagination.pageRows.map((record, index) => <article className="admin-mr-card" role="listitem" key={record.id} data-testid={`card-category-${record.id}`}>
            <div className="admin-mr-card__head"><div className="admin-mr-card__identity"><span className="admin-mr-card__subtitle">#{pagination.startIndex + index + 1} · Product category</span><h2 className="admin-mr-card__name">{record.name}</h2></div><StatusBadge status={record.status} id={record.id} kind="category" /></div>
            <dl className="admin-mr-card__meta"><div><dt>Description</dt><dd>{record.description || '—'}</dd></div><div><dt>Unit price</dt><dd className="admin-category-price">{String(record.unitPrice)}</dd></div><div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl>
            {actions(record, true)}
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-categories-empty"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching categories' : 'No product categories yet'}</strong><p>{records.length ? 'Try another search or status filter.' : 'Add a category to begin a browser-local product catalog.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={visible.length === 1 ? 'category' : 'categories'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-category-count" />
      </>}
    </section>
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} category?`} description={`Change “${confirming.name}” to ${confirming.status === 'active' ? 'inactive' : 'active'}? Its saved details will remain available in this browser.`} actionLabel={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} category`} onConfirm={toggle} onClose={() => { setConfirming(null); setActionError(''); }} error={actionError} />}
    {importing && <CategoryImportDialog records={records} onImport={importRows} onClose={() => setImporting(false)} />}
  </AdminLayout>;
}