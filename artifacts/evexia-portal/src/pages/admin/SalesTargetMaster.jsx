import { downloadCSV as loggedCSV } from '../../services/downloads.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, Pencil, Plus, RefreshCw, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { loadMRs, MR_STORAGE_KEY } from '../../services/mrs.js';
import { loadZones } from '../../services/zones.js';
import { loadSalesTargets, createSalesTarget, updateSalesTarget, reviewSalesTargetCSV, importSalesTargets, exportSalesTargetCSV, salesTargetCSVTemplate, TARGET_COLUMNS, SALES_TARGET_KEY, validateSalesTarget, sumSalesTargets } from '../../services/salesTargets.js';
import '../../mr.css';
import '../../category.css';
import '../../salesTarget.css';

const money = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const quarterKeys = ['q1', 'q2', 'q3', 'q4'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const amount = (value) => `₹${money.format(Number(value) || 0)}`;
const annual = (record) => quarterKeys.reduce((total, key) => total + (Number(record[key]) || 0), 0);
const linkedMRName = (record, mrById) => mrById.get(String(record.mrId))?.name || `Missing MR (${record.mrId})`;
const linkedZoneName = (record, mrById, zoneById) => {
  const mr = mrById.get(String(record.mrId));
  if (!mr) return 'MR unavailable';
  return zoneById.get(String(mr.zoneId))?.name || `Missing zone (${mr.zoneId})`;
};
const yearLabel = (start, end) => `${start}–${end}`;
const initialYear = () => {
  const date = new Date();
  return date.getFullYear() - (date.getMonth() < 3 ? 1 : 0);
};
const blankValues = () => ({ mrId: '', startYear: String(initialYear()), endYear: String(initialYear() + 1), q1: '0', q2: '0', q3: '0', q4: '0' });

function saveCSV(text, filename) {
  return loggedCSV(text, filename, 'sales_target', filename.includes('template') ? 'template' : 'export');
}

function Audit({ by, at }) {
  useAdminPreferences();
  return <span className="admin-target-audit"><strong>{by || '—'}</strong><time dateTime={at || undefined}>{formatAdminTimestamp(at)}</time></span>;
}

function TargetForm({ record, records, mrs, zones, years, onSave, onClose }) {
  const [values, setValues] = useState(() => record ? Object.fromEntries(['mrId', 'startYear', 'endYear', ...quarterKeys].map((key) => [key, String(record[key] ?? '')])) : blankValues());
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const mr = mrs.find((item) => String(item.id) === String(values.mrId));
  const selectedZone = zones.find((zone) => String(zone.id) === String(mr?.zoneId));
  function change(key, value) {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (key === 'startYear' && value && Number(current.endYear) === Number(current.startYear) + 1) next.endYear = String(Number(value) + 1);
      return next;
    });
    setErrors((current) => ({ ...current, [key]: undefined }));
    setMessage('');
  }
  function submit(event) {
    event.preventDefault();
    const checked = validateSalesTarget(values, records, mrs, record?.id);
    if (Object.keys(checked.errors || {}).length) {
      setErrors(checked.errors);
      setMessage(checked.errors.form || 'Review the highlighted fields before saving.');
      return;
    }
    setSaving(true);
    try {
      onSave(checked.fields || values, record);
    } catch (cause) {
      setMessage(cause.message || 'Target could not be saved. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  }
  const field = (key, label, type = 'text') => <label className="admin-target-field" key={key}>
    {label}
    <input type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? '0.01' : undefined} value={values[key]} onChange={(event) => change(key, event.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `target-error-${key}` : undefined} data-testid={`input-sales-target-${key}`} />
    {errors[key] && <span className="admin-target-form__error" id={`target-error-${key}`}>{errors[key]}</span>}
  </label>;
  return <Dialog className="admin-target-dialog" eyebrow="Sales Target Master" title={record ? 'Edit sales target' : 'Add sales target'} description="Set the quarterly budget for one MR and financial year. Amounts are in Indian rupees." onClose={onClose}>
    <form className="admin-target-form" onSubmit={submit} noValidate>
      <div className="admin-target-form__grid">
        <label className="admin-target-field">Medical representative
          <select value={values.mrId} onChange={(event) => change('mrId', event.target.value)} aria-invalid={Boolean(errors.mrId)} data-testid="select-sales-target-mr"><option value="">Select MR</option>{mrs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {errors.mrId && <span className="admin-target-form__error">{errors.mrId}</span>}
        </label>
        <label className="admin-target-field">Assigned zone
          <input readOnly value={selectedZone?.name || (mr ? 'Zone unavailable' : 'Select an MR first')} data-testid="input-sales-target-zone" />
        </label>
        {['startYear', 'endYear'].map((key) => <label className="admin-target-field" key={key}>{key === 'startYear' ? 'Financial start year' : 'Financial end year'}
          <select value={values[key]} onChange={(event) => change(key, event.target.value)} aria-invalid={Boolean(errors[key])} data-testid={`select-sales-target-${key}`}><option value="">Select year</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>
          {errors[key] && <span className="admin-target-form__error">{errors[key]}</span>}
        </label>)}
      </div>
      <div className="admin-target-form__quarter">{quarterKeys.map((key) => field(key, `${key.toUpperCase()} target`, 'number'))}</div>
      <div className="admin-target-form__total"><span>Annual target</span><strong>{amount(annual(values))}</strong></div>
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-cancel-sales-target">Cancel</button><button type="submit" className="admin-button" disabled={saving} data-testid="button-save-sales-target">{saving ? 'Saving…' : record ? 'Save changes' : 'Add target'}</button></div>
    </form>
  </Dialog>;
}

function TargetImport({ records, mrs, zones, onDone, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const bad = review?.entries.filter((entry) => entry.errors?.length) || [];
  const ready = review ? review.entries.length - bad.length : 0;
  function close() { sequence.current += 1; onClose(); }
  async function selectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReview(null);
    setMessage('');
    if (!file) return;
    const token = ++sequence.current;
    if (!/\.csv$/i.test(file.name) || file.size > 2_000_000) { setMessage('Choose a .csv file smaller than 2 MB.'); return; }
    setReading(true);
    try {
      const text = await file.text();
      if (token !== sequence.current) return;
      if (!same(loadSalesTargets(), records) || !same(loadMRs(), mrs) || !same(loadZones(), zones)) throw new Error('Records changed in another tab. Refresh the page before reviewing this file.');
      const entries = reviewSalesTargetCSV(text, records, mrs);
      setReview({ name: file.name, entries });
    } catch (cause) {
      if (token === sequence.current) setMessage(cause.message || 'The CSV could not be read.');
    } finally { if (token === sequence.current) setReading(false); }
  }
  function confirm() {
    if (!review || bad.length || !ready) return;
    try {
      onDone(review.entries);
      close();
    } catch (cause) { setMessage(cause.message || 'Import failed. No targets were saved.'); }
  }
  return <Dialog className="admin-import-dialog" eyebrow="Sales Target Master" title="Import targets" description="Review every row before importing. Invalid files are never partially saved." onClose={close}
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-target-import">Cancel</button><button type="button" className="admin-button" disabled={reading || !ready || bad.length > 0 || Boolean(message)} onClick={confirm} data-testid="button-confirm-target-import">Import {ready} {ready === 1 ? 'target' : 'targets'}</button></>}>
    <div className="admin-target-import">
       <div className="admin-target-import__guide"><strong>CSV format</strong><p>{TARGET_COLUMNS.map(([, label]) => label).join(', ')}. Use the template for the correct column order. Employee codes must match saved MRs.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={async () => { try { await saveCSV(salesTargetCSVTemplate(), 'evexia-sales-target-template.csv'); setMessage(''); } catch (cause) { setMessage(cause.message || 'Template download failed.'); } }} data-testid="button-target-template"><Download size={16} aria-hidden="true" /> Download template</button>
      <label className="admin-target-import__file">Choose a local CSV file<input type="file" accept=".csv,text/csv" onChange={selectFile} data-testid="input-target-import-file" /></label>
      {reading && <p role="status">Reading and checking CSV rows…</p>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      {review && <div aria-live="polite"><p><strong>{review.name}</strong> · {ready} ready, {bad.length} with errors. {bad.length ? 'Correct the file and choose it again.' : 'Expand rows to review before importing.'}</p>
        <div className="admin-target-import__rows" role="list" aria-label="CSV row review">{review.entries.map((entry, index) => <div role="listitem" className={`admin-target-import__row${entry.errors?.length ? ' admin-target-import__row--error' : ''}`} key={`${entry.line}-${index}`}>
          <details><summary>Line {entry.line ?? index + 2} · {entry.values?.employeeCode || entry.values?.mrName || entry.fields?.mrId || 'Target'} · {entry.errors?.length ? `${entry.errors.length} errors` : 'Ready'}</summary>
            <dl>{TARGET_COLUMNS.map((column, i) => { const key = Array.isArray(column) ? column[0] : column.key || column; const label = Array.isArray(column) ? column[1] : column.label || column; return <div key={`${key}-${i}`}><dt>{label}</dt><dd>{entry.values?.[key] ?? entry.fields?.[key] ?? '—'}</dd></div>; })}</dl>
          </details>
          {entry.errors?.length > 0 && <ul>{entry.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
        </div>)}</div>
      </div>}
    </div>
  </Dialog>;
}

export default function SalesTargetMaster() {
  const [snapshot, setSnapshot] = useState({ records: [], mrs: [], zones: [] });
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [stale, setStale] = useState(false);
  const [draft, setDraft] = useState({ startYear: '', endYear: '', zoneId: '', mrId: '' });
  const [applied, setApplied] = useState({ startYear: '', endYear: '', zoneId: '', mrId: '' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function refresh() {
    // A refreshed snapshot must never make an already open draft appear current.
    setEditing(null);
    setImporting(false);
    try {
      const zones = loadZones();
      const mrs = loadMRs();
      const records = loadSalesTargets();
      if (mounted.current) { setSnapshot({ records, mrs, zones }); setError(''); setActionError(''); setStale(false); setFeedback(''); }
    } catch (cause) { if (mounted.current) { setError(cause.message || 'Target records could not be loaded.'); setFeedback(''); } }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    function onStorage(event) {
      if (event.key === null || event.key === SALES_TARGET_KEY || event.key === MR_STORAGE_KEY || event.key?.includes('zones')) {
        setStale(true);
        setFeedback('');
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const { records, mrs, zones } = snapshot;
  const mrById = useMemo(() => new Map(mrs.map((mr) => [String(mr.id), mr])), [mrs]);
  const zoneById = useMemo(() => new Map(zones.map((zone) => [String(zone.id), zone])), [zones]);
  const years = useMemo(() => {
    const base = initialYear();
    return Array.from(new Set([...Array.from({ length: 12 }, (_, i) => base - 5 + i), ...records.flatMap((record) => [Number(record.startYear), Number(record.endYear)])])).filter(Number.isFinite).sort((a, b) => b - a);
  }, [records]);
  const visible = useMemo(() => records.filter((record) => {
    const mr = mrById.get(String(record.mrId));
    return (!applied.startYear || String(record.startYear) === applied.startYear)
      && (!applied.endYear || String(record.endYear) === applied.endYear)
      && (!applied.zoneId || String(mr?.zoneId) === applied.zoneId)
      && (!applied.mrId || String(record.mrId) === applied.mrId)
      && (!search.trim() || (mr?.name || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  }), [records, mrById, applied, search]);
  const pagination = useTablePagination(visible);
  const totals = useMemo(() => {
    return Object.fromEntries([...quarterKeys, 'total'].map((key) => [key, key === 'total' ? sumSalesTargets(visible) : visible.reduce((n, row) => n + (Number(row[key]) || 0), 0)]));
  }, [visible]);
  function requireFresh() {
    if (stale || !same(loadSalesTargets(), records) || !same(loadMRs(), mrs) || !same(loadZones(), zones)) {
      setStale(true);
      throw new Error('Saved targets, MRs, or zones changed in another tab. Refresh records before continuing.');
    }
  }
  function commit(values, originalRecord) {
    requireFresh();
    if (editing === 'new') createSalesTarget(records, mrs, zones, values);
    else updateSalesTarget(records, mrs, zones, editing.id, values, originalRecord);
    refresh();
    setEditing(null);
    setFeedback(editing === 'new' ? 'Sales target added successfully.' : 'Sales target updated successfully.');
  }
  function importRows(entries) {
    requireFresh();
    importSalesTargets(entries, { records, mrs, zones });
    refresh();
    setFeedback(`${entries.length} ${entries.length === 1 ? 'target' : 'targets'} imported successfully.`);
  }
  async function exportVisible() {
    try {
      requireFresh();
      await saveCSV(exportSalesTargetCSV(visible, mrs), 'evexia-sales-targets.csv');
      setActionError('');
    } catch (cause) { setFeedback(''); setActionError(cause.message || 'Export failed. Please retry.'); }
  }
  const action = (record) => <button type="button" className="admin-icon-button" onClick={() => { setError(''); setEditing(record); }} aria-label={`Edit target for ${mrById.get(String(record.mrId))?.name || 'MR'} ${yearLabel(record.startYear, record.endYear)}`} title="Edit target" data-testid={`button-edit-sales-target-${record.id}`}><Pencil size={16} aria-hidden="true" /></button>;
  const columns = [
    { key: 'serial', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'start', label: 'Financial start year', render: (record) => record.startYear },
    { key: 'end', label: 'Financial end year', render: (record) => record.endYear },
    { key: 'mr', label: 'MR name', render: (record) => <span className="admin-target-name">{linkedMRName(record, mrById)}</span> },
    { key: 'hq', label: 'Headquarter', render: (record) => mrById.get(String(record.mrId))?.hq || 'MR unavailable' },
    { key: 'zone', label: 'Zone', render: (record) => linkedZoneName(record, mrById, zoneById) },
    ...quarterKeys.map((key) => ({ key, label: `${key.toUpperCase()} target`, render: (record) => <span className="admin-target-amount">{amount(record[key])}</span> })),
    { key: 'total', label: 'Annual target', render: (record) => <span className="admin-target-total">{amount(annual(record))}</span> },
    { key: 'created', label: 'Created', render: (record) => <Audit by={record.createdBy} at={record.createdAt} /> },
    { key: 'updated', label: 'Updated', render: (record) => <Audit by={record.updatedBy} at={record.updatedAt} /> },
    { key: 'action', label: 'Action', render: action },
  ];
  return <AdminLayout title="Sales Target Master"><div className="admin-target-page">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Masters / Sales planning</p><h1>Sales Target Master</h1><p className="admin-page-head__description">Quarterly MR budgets, organized by financial year.</p></div>
      <div className="admin-target-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-sales-targets"><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || stale} onClick={() => setImporting(true)} data-testid="button-import-sales-targets"><Upload size={16} aria-hidden="true" /> Import</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error) || stale || !visible.length} onClick={exportVisible} data-testid="button-export-sales-targets"><Download size={16} aria-hidden="true" /> Export</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(error)} onClick={() => setShowSummary(true)} data-testid="button-summary-sales-targets">Summary</button>
        <button type="button" className="admin-button" disabled={Boolean(error) || stale || !mrs.length} onClick={() => { setError(''); setEditing('new'); }} data-testid="button-add-sales-target"><Plus size={16} aria-hidden="true" /> Add target</button>
      </div>
    </div>
    {stale && <div className="admin-feedback admin-target-storage-warning" role="alert"><p>Saved data changed in another tab. Refresh records before editing, importing or exporting.</p><button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-stale-targets">Refresh records</button></div>}
    {feedback && <div className="admin-feedback" role="status" data-testid="status-sales-target-feedback">{feedback}</div>}
    {actionError && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-sales-target-action-error">{actionError}</div>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-sales-target-error">{error}</div>}
    <section className="admin-panel" aria-label="Sales target list">
      <div className="admin-target-toolbar">
        <div className="admin-target-toolbar__fields">
          {[
            ['startYear', 'Start year', 'All start years', years.map((year) => ({ id: String(year), name: year }))],
            ['endYear', 'End year', 'All end years', years.map((year) => ({ id: String(year), name: year }))],
            ['zoneId', 'Zone', 'All zones', zones],
            ['mrId', 'MR', 'All MRs', mrs.filter((mr) => !draft.zoneId || String(mr.zoneId) === draft.zoneId)],
          ].map(([key, label, placeholder, options]) => <label className="admin-target-field" key={key}>{label}<select value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value, ...(key === 'zoneId' ? { mrId: '' } : {}) }))} data-testid={`select-filter-target-${key}`}><option value="">{placeholder}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>)}
          <button type="button" className="admin-button admin-target-apply" onClick={() => { setApplied({ ...draft }); pagination.resetPage(); }} data-testid="button-apply-target-filters">Apply filter</button>
          <label className="admin-target-field admin-target-toolbar__search">Search by name<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search MR name" data-testid="input-search-sales-targets" /></label>
        </div>
        <p className="admin-target-applied">Showing <strong>{visible.length}</strong> {visible.length === 1 ? 'target' : 'targets'}{!same(draft, applied) ? ' · Select Apply filter to update the list' : ' · Summary reflects this filtered set'}</p>
      </div>
      {error && !records.length ? <div className="admin-empty"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>Targets could not be loaded</strong><p>Refresh records to try again. No saved data has been changed.</p><button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-sales-targets">Retry</button></div> : <>
        <div className="admin-target-summary" aria-label="Filtered target totals">{[...quarterKeys, 'total'].map((key) => <div key={key}><span>{key === 'total' ? 'Annual total' : `${key.toUpperCase()} target`}</span><strong data-testid={`text-target-summary-${key}`}>{amount(totals[key])}</strong></div>)}</div>
        {visible.length ? <>
          <div className="admin-target-table"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Sales target records" testIdPrefix="sales-target" /></div>
          <div className="admin-target-mobile" role="list" aria-label="Sales target records">{pagination.pageRows.map((record, index) => <article className="admin-target-card" role="listitem" key={record.id} data-testid={`card-sales-target-${record.id}`}>
            <div className="admin-target-card__head"><div><small>#{pagination.startIndex + index + 1} · FY {yearLabel(record.startYear, record.endYear)}</small><h2>{linkedMRName(record, mrById)}</h2><small>{mrById.get(String(record.mrId))?.hq || 'MR unavailable'} · {linkedZoneName(record, mrById, zoneById)}</small></div>{action(record)}</div>
            <dl className="admin-target-card__values">{quarterKeys.map((key) => <div key={key}><dt>{key.toUpperCase()} target</dt><dd>{amount(record[key])}</dd></div>)}</dl>
            <div className="admin-target-card__foot"><span>Annual target</span><strong className="admin-target-total">{amount(annual(record))}</strong></div>
            <details><summary>Audit details</summary><dl className="admin-target-card__values"><div><dt>Created</dt><dd><Audit by={record.createdBy} at={record.createdAt} /></dd></div><div><dt>Updated</dt><dd><Audit by={record.updatedBy} at={record.updatedAt} /></dd></div></dl></details>
          </article>)}</div>
        </> : <div className="admin-empty" data-testid="status-sales-target-empty"><span className="admin-empty__icon"><FolderOpen size={21} aria-hidden="true" /></span><strong>{records.length ? 'No matching targets' : 'No sales targets yet'}</strong><p>{records.length ? 'Try another financial year, zone, MR or name.' : 'Add a target to begin planning quarterly MR budgets.'}</p>{!records.length && mrs.length > 0 && <button type="button" className="admin-button" disabled={stale} onClick={() => setEditing('new')} data-testid="button-add-first-sales-target"><Plus size={16} aria-hidden="true" /> Add first target</button>}</div>}
        <TablePagination {...pagination} filtered={visible.length} total={records.length} label={visible.length === 1 ? 'target' : 'targets'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-sales-target-count" />
      </>}
    </section>
    {showSummary && <Dialog className="admin-target-summary-dialog" eyebrow="Sales Target Master" title="Target Summary" description={`Quarterly totals for ${visible.length} ${visible.length === 1 ? 'target' : 'targets'} in the current filtered list.`} onClose={() => setShowSummary(false)} footer={<button type="button" className="admin-button admin-button--secondary" onClick={() => setShowSummary(false)} data-testid="button-close-target-summary">Close</button>}><div className="admin-target-summary-dialog__rows"><div className="admin-target-summary-dialog__heading"><span>Type</span><span>Amount (in Rs)</span></div>{[...quarterKeys, 'total'].map((key) => <div key={key}><span>{key === 'total' ? 'Total' : `${key.toUpperCase()} target`}</span><strong>{amount(totals[key])}</strong></div>)}</div></Dialog>}
    {editing && <TargetForm key={editing === 'new' ? 'new' : editing.id} record={editing === 'new' ? null : editing} records={records} mrs={mrs} zones={zones} years={years} onSave={commit} onClose={() => setEditing(null)} />}
    {importing && <TargetImport records={records} mrs={mrs} zones={zones} onDone={importRows} onClose={() => setImporting(false)} />}
  </div></AdminLayout>;
}