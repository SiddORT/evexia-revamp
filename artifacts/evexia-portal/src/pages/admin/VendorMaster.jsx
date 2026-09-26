import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pencil, Plus, RefreshCw, Search, Upload, UsersRound } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { VENDOR_COLUMNS, loadVendors, validateVendor, createVendor, updateVendor, vendorCSVTemplate, exportVendorCSV, reviewVendorCSV, importVendors } from '../../services/vendors.js';
import '../../vendor.css';

const FIELD_KEYS = VENDOR_COLUMNS.map(([key]) => key);
const EMPTY = Object.fromEntries(FIELD_KEYS.map((key) => [key, '']));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const formatDate = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function downloadCSV(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function audit(by, at) {
  const date = at ? new Date(at) : null;
  return <span className="admin-vendor-audit"><strong>{by || '—'}</strong>{date && !Number.isNaN(date.getTime()) ? <time dateTime={at}>{formatDate.format(date)}</time> : <span>—</span>}</span>;
}

function isSample(record) { return /^sample[-_]/i.test(String(record.id)); }

function VendorForm({ record, records, stale, onSave, onClose }) {
  const [values, setValues] = useState(() => record ? Object.fromEntries(FIELD_KEYS.map((key) => [key, record[key] ?? ''])) : { ...EMPTY });
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState('');
  function change(key, value) {
    const next = { ...values, [key]: value };
    setValues(next);
    setMessage('');
    if (attempted) {
      try { setErrors(validateVendor(next, records, record?.id).errors || {}); }
      catch (cause) { setMessage(cause.message || 'The vendor details could not be checked.'); }
    }
  }
  function save(event) {
    event.preventDefault();
    setAttempted(true);
    setMessage('');
    if (stale) { setMessage('Records changed in another tab. Refresh records before saving.'); return; }
    try {
      const result = validateVendor(values, records, record?.id);
      setErrors(result.errors || {});
      if (Object.keys(result.errors || {}).length) return;
      const outcome = onSave(result.fields || values, record?.id);
      if (!outcome.success) setMessage(outcome.error || 'Vendor could not be saved. Your draft is still here.');
    } catch (cause) { setMessage(cause.message || 'Vendor could not be saved. Your draft is still here.'); }
  }
  return <Dialog title={record ? 'Edit vendor' : 'Add vendor'} eyebrow="Vendor Master" description="All six contact fields are required. Changes are saved to this browser." onClose={onClose} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-vendor">Cancel</button><button type="submit" form="vendor-master-form" className="admin-button" disabled={stale} data-testid="button-save-vendor">{record ? 'Save changes' : 'Add vendor'}</button></>}>
    <form id="vendor-master-form" className="admin-vendor-form" onSubmit={save} noValidate>
      {VENDOR_COLUMNS.map(([key, label]) => {
        const wide = key === 'registeredAddress';
        const Input = wide ? 'textarea' : 'input';
        return <label key={key} className={`admin-vendor-field${wide ? ' admin-vendor-field--wide' : ''}`}>
          <span>{label} <span aria-hidden="true">*</span></span>
          <Input value={values[key]} onChange={(event) => change(key, event.target.value)} aria-required="true" aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `vendor-error-${key}` : undefined} type={key === 'emailId' ? 'email' : key === 'phoneNo' ? 'tel' : 'text'} autoComplete={key === 'emailId' ? 'email' : key === 'phoneNo' ? 'tel' : 'off'} data-testid={`input-vendor-${key}`} />
          {errors[key] && <span id={`vendor-error-${key}`} className="admin-vendor-field__error" role="alert">{errors[key]}</span>}
        </label>;
      })}
      {errors.form && <div className="admin-feedback admin-feedback--error admin-vendor-form__feedback" role="alert">{errors.form}</div>}
      {message && <div className="admin-feedback admin-feedback--error admin-vendor-form__feedback" role="alert" data-testid="status-vendor-save-error">{message}</div>}
      {stale && <div className="admin-feedback admin-feedback--error admin-vendor-form__feedback" role="alert">Records changed in another tab. Cancel and refresh to continue.</div>}
    </form>
  </Dialog>;
}

function VendorImport({ records, stale, onImport, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const invalid = review?.entries.filter((entry) => entry.errors.length) || [];
  const valid = review ? review.entries.length - invalid.length : 0;
  function close() { sequence.current += 1; onClose(); }
  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReview(null);
    setMessage('');
    if (!file) return;
    if (!/\.csv$/i.test(file.name) || !file.size || file.size > 2_000_000) {
      setMessage('Choose a non-empty .csv file smaller than 2 MB.');
      return;
    }
    const current = ++sequence.current;
    setReading(true);
    try {
      const text = await file.text();
      if (current !== sequence.current) return;
      const snapshot = loadVendors();
      if (!same(snapshot, records)) throw new Error('Vendor records changed in another tab. Refresh records before reviewing this file.');
      const entries = reviewVendorCSV(text, snapshot);
      if (current === sequence.current) setReview({ fileName: file.name, entries, snapshot });
    } catch (cause) {
      if (current === sequence.current) setMessage(cause.message || 'Could not review this CSV file.');
    } finally {
      if (current === sequence.current) setReading(false);
    }
  }
  function confirm() {
    if (!review || !valid || invalid.length || reading || stale) return;
    setMessage('');
    try {
      const result = onImport(review.entries, review.snapshot);
      if (result.success) close();
      else setMessage(result.error || 'Import failed. No vendors were saved.');
    } catch (cause) { setMessage(cause.message || 'Import failed. No vendors were saved.'); }
  }
  return <Dialog title="Import vendors" eyebrow="Vendor Master" description="Review every row before adding the whole batch. Invalid rows prevent the entire import." onClose={close} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-vendor-import">Cancel</button><button type="button" className="admin-button" onClick={confirm} disabled={!valid || Boolean(invalid.length) || reading || stale || Boolean(message)} data-testid="button-confirm-vendor-import">Import {valid} {valid === 1 ? 'vendor' : 'vendors'}</button></>}>
    <div className="admin-vendor-import">
      <div className="admin-vendor-import__guide"><strong>CSV columns in this order</strong><p>{VENDOR_COLUMNS.map(([, label]) => label).join(', ')}. All fields are required. IDs and audit details are not imported.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { try { downloadCSV(vendorCSVTemplate(), 'evexia-vendor-template.csv'); setMessage(''); } catch { setMessage('The CSV template could not be downloaded.'); } }} data-testid="button-vendor-import-template"><Download size={16} aria-hidden="true" /> Download template</button>
      <label className="admin-vendor-import__file">Choose a local CSV file (maximum 2 MB)<input type="file" accept=".csv,text/csv" onChange={choose} disabled={stale || reading} data-testid="input-vendor-import" /></label>
      {reading && <p role="status">Reading CSV file…</p>}
      {stale && <div className="admin-feedback admin-feedback--error" role="alert">Vendor records changed in another tab. Close and refresh before importing.</div>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-vendor-import-error">{message}</div>}
      {review && <div aria-live="polite" data-testid="status-vendor-import-review">
        <p><strong>{review.fileName}</strong> — {valid} valid {valid === 1 ? 'row' : 'rows'}, {invalid.length} with errors. {invalid.length ? 'Correct the file and choose it again; nothing was saved.' : review.entries.length ? 'Ready for a single batch import.' : 'There are no vendor rows to import.'}</p>
        <div className="admin-vendor-import__rows" role="list" aria-label="Reviewed vendor rows">
          {review.entries.map((entry, index) => <div key={`${entry.line}-${index}`} role="listitem" className={`admin-vendor-import__row${entry.errors.length ? ' admin-vendor-import__row--error' : ''}`} data-testid={`row-vendor-import-${entry.line}`}>
            <details><summary>Line {entry.line}: {entry.values?.vendorName || entry.fields?.vendorName || '(unnamed)'} — {entry.errors.length ? `${entry.errors.length} ${entry.errors.length === 1 ? 'error' : 'errors'}` : 'Ready to add'}</summary>
              <dl>{VENDOR_COLUMNS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{entry.values?.[key] ?? entry.fields?.[key] ?? '—'}</dd></div>)}</dl>
            </details>
            {entry.errors.length > 0 && <ul>{entry.errors.map((problem, errorIndex) => <li key={errorIndex}>{problem}</li>)}</ul>}
          </div>)}
        </div>
      </div>}
    </div>
  </Dialog>;
}

export default function VendorMaster() {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(undefined);
  const [importing, setImporting] = useState(false);
  const visible = useMemo(() => records.filter((record) => FIELD_KEYS.some((key) => String(record[key] ?? '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [records, search]);
  const pagination = useTablePagination(visible);

  function refresh() {
    try {
      const loaded = loadVendors();
      setRecords(loaded);
      setError('');
      setStale(false);
      setActionError('');
      setEditing(undefined);
      setImporting(false);
    } catch (cause) {
      setError(cause.message || 'Vendor records could not be loaded.');
      setRecords([]);
      setStale(true);
    }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    function onStorage() {
      try {
        if (!same(loadVendors(), records)) { setStale(true); setFeedback(''); }
      } catch { setStale(true); setFeedback(''); }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [records]);

  function guard(expected = records) {
    if (stale || error) { setStale(true); return false; }
    try {
      if (!same(records, expected) || !same(loadVendors(), expected)) {
        setStale(true);
        setFeedback('');
        setActionError('Vendor records changed in another tab. Refresh records before continuing.');
        return false;
      }
      return true;
    } catch (cause) {
      setStale(true);
      setActionError(cause.message || 'Could not verify saved records. Refresh records before continuing.');
      return false;
    }
  }
  function save(values, id) {
    if (!guard()) return { success: false, error: 'Vendor records changed. Refresh records before saving.' };
    try {
      const next = id ? updateVendor(records, id, values) : createVendor(records, values);
      setRecords(next);
      setEditing(undefined);
      setActionError('');
      setFeedback(id ? 'Vendor updated successfully.' : 'Vendor added successfully.');
      return { success: true };
    } catch (cause) {
      const message = cause.message || 'Vendor could not be saved.';
      if (/chang|snapshot|refresh|conflict/i.test(message)) setStale(true);
      return { success: false, error: message };
    }
  }
  function importRows(entries, expected) {
    if (!guard(expected)) return { success: false, error: 'Vendor records changed. Refresh records before importing.' };
    if (!entries.length || entries.some((entry) => entry.errors.length)) return { success: false, error: 'Every row must be valid before importing.' };
    try {
      const next = importVendors(entries, expected);
      setRecords(next);
      setActionError('');
      setFeedback(`${entries.length} ${entries.length === 1 ? 'vendor' : 'vendors'} imported successfully.`);
      return { success: true };
    } catch (cause) {
      const message = cause.message || 'Import failed. No vendors were saved.';
      if (/chang|snapshot|refresh|conflict/i.test(message)) setStale(true);
      return { success: false, error: message };
    }
  }
  function exportRows() {
    if (!guard() || !visible.length) return;
    try { downloadCSV(exportVendorCSV(visible), 'evexia-vendors.csv'); setActionError(''); }
    catch (cause) { setActionError(cause.message || 'CSV export failed. Please try again.'); }
  }
  function edit(record) { setEditing(record); setActionError(''); setFeedback(''); }
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => <span className="admin-table__serial">{index + 1}</span> },
    { key: 'vendorName', label: 'Vendor Name', render: (record) => <span><strong className="admin-vendor-name" data-testid={`text-vendor-name-${record.id}`}>{record.vendorName}</strong>{isSample(record) && <span className="admin-vendor-sample">Sample</span>}</span> },
    { key: 'gstNo', label: 'GST No.', render: (record) => record.gstNo },
    { key: 'registeredAddress', label: 'Registered Address', render: (record) => <span className="admin-vendor-address">{record.registeredAddress}</span> },
    { key: 'contactPersonName', label: 'Contact Person Name', render: (record) => record.contactPersonName },
    { key: 'emailId', label: 'Email ID', render: (record) => <a className="admin-vendor-link" href={`mailto:${record.emailId}`} data-testid={`link-vendor-email-${record.id}`}>{record.emailId}</a> },
    { key: 'phoneNo', label: 'Phone No.', render: (record) => <a className="admin-vendor-link" href={`tel:${record.phoneNo}`} data-testid={`link-vendor-phone-${record.id}`}>{record.phoneNo}</a> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'edit', label: 'Edit', render: (record) => <button type="button" className="admin-icon-button" onClick={() => edit(record)} disabled={stale} title="Edit vendor" aria-label={`Edit ${record.vendorName}`} data-testid={`button-edit-vendor-${record.id}`}><Pencil size={16} aria-hidden="true" /></button> },
  ];
  return <AdminLayout title="Vendor Master">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Contacts</p><h1>Vendor Master</h1><p className="admin-page-head__description">Keep vendor identities and contact details together in this browser.</p></div>
      <div className="admin-vendor-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-vendors"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => { setImporting(true); setActionError(''); }} disabled={Boolean(error) || stale} data-testid="button-import-vendors"><Upload size={16} aria-hidden="true" /> Import data</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={exportRows} disabled={Boolean(error) || stale || !visible.length} data-testid="button-export-vendors"><Download size={16} aria-hidden="true" /> Export data</button>
        <button type="button" className="admin-button" onClick={() => edit(null)} disabled={Boolean(error) || stale} data-testid="button-add-vendor"><Plus size={16} aria-hidden="true" /> Add vendor</button>
      </div>
    </div>
    {feedback && <div className="admin-feedback" role="status" data-testid="status-vendor-feedback">{feedback}</div>}
    {stale && !error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-vendor-stale">Vendor records changed in another tab. Refresh records to see the latest version before making changes.</div>}
    {actionError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-vendor-action-error">{actionError}</div>}
    <section className="admin-panel" aria-label="Vendor list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search vendors</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search vendor, GST, contact, email or phone" data-testid="input-search-vendors" /></label></div></div>
      {error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>Vendors could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-vendors">Retry loading</button></div> : <>
        {visible.length ? <>
          <div className="admin-vendor-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Vendor records" testIdPrefix="vendor" /></div>
          <div className="admin-vendor-mobile" role="list" aria-label="Vendor records">{pagination.pageRows.map((record, index) => <article className="admin-vendor-card" role="listitem" key={record.id} data-testid={`card-vendor-${record.id}`}>
            <div className="admin-vendor-card__head"><div><small>#{pagination.startIndex + index + 1} · {record.gstNo}</small><h2>{record.vendorName}</h2>{isSample(record) && <span className="admin-vendor-sample">Sample</span>}</div></div>
            <dl className="admin-vendor-card__meta">{VENDOR_COLUMNS.slice(1).map(([key, label]) => <div key={key}><dt>{label}</dt><dd className={key === 'registeredAddress' ? 'admin-vendor-address' : undefined}>{key === 'emailId' ? <a href={`mailto:${record[key]}`} className="admin-vendor-link" data-testid={`link-vendor-mobile-email-${record.id}`}>{record[key]}</a> : key === 'phoneNo' ? <a href={`tel:${record[key]}`} className="admin-vendor-link" data-testid={`link-vendor-mobile-phone-${record.id}`}>{record[key]}</a> : record[key]}</dd></div>)}<div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl>
            <button type="button" className="admin-vendor-card__action" onClick={() => edit(record)} disabled={stale} data-testid={`button-edit-vendor-mobile-${record.id}`}><Pencil size={15} aria-hidden="true" /> Edit vendor</button>
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-vendors-empty"><span className="admin-empty__icon"><UsersRound size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching vendors' : 'No vendors yet'}</strong><p>{records.length ? 'Try a different search term.' : 'Add a vendor or import a CSV to start this browser-local ledger.'}</p></div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={visible.length === 1 ? 'vendor' : 'vendors'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-vendor-count" />
      </>}
    </section>
    {editing !== undefined && <VendorForm key={editing?.id || 'new'} record={editing} records={records} stale={stale} onSave={save} onClose={() => setEditing(undefined)} />}
    {importing && <VendorImport records={records} stale={stale} onImport={importRows} onClose={() => setImporting(false)} />}
  </AdminLayout>;
}