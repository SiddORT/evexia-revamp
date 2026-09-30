import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CirclePower, Download, Landmark, Pencil, Plus, RefreshCw, Search, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { formatAdminTimestamp, useAdminPreferences } from '../../components/admin/adminPreferences.js';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import useTablePagination from '../../hooks/useTablePagination.js';
import { DOCTOR_STORAGE_KEY } from '../../services/doctors.js';
import { OPENING_BALANCE_COLUMNS, OPENING_BALANCE_KEY, exportOpeningBalanceCSV, importOpeningBalances, loadOpeningBalanceSnapshots, openingBalanceCSVTemplate, reviewOpeningBalanceCSV, setOpeningBalanceStatus } from '../../services/openingBalances.js';
import '../../mr.css';
import '../../category.css';
import '../../openingBalance.css';

const PATH = '/admin/masters/opening-balances';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function audit(name, value) {
  return <span className="ob-audit"><strong>{name || '—'}</strong><span>{formatAdminTimestamp(value)}</span></span>;
}
function ImportDialog({ snapshot, verify, onDone, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const bad = review?.entries.filter((row) => row.errors.length) || [];
  function close() { sequence.current++; onClose(); }
  async function select(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReview(null);
    setMessage('');
    if (!file) return;
    if (!/\.csv$/i.test(file.name) || file.size > 2_000_000) { setMessage('Choose a CSV file smaller than 2 MB.'); return; }
    const current = ++sequence.current;
    setReading(true);
    try {
      const text = await file.text();
      if (current !== sequence.current) return;
      verify();
      const entries = await reviewOpeningBalanceCSV(text, snapshot.records, snapshot.doctors);
      if (current !== sequence.current) return;
      verify();
      setReview({ name: file.name, entries });
    } catch (error) {
      if (current === sequence.current) setMessage(error.message || 'This file could not be reviewed.');
    } finally {
      if (current === sequence.current) setReading(false);
    }
  }
  function confirm() {
    if (!review?.entries.length || bad.length) return;
    try {
      verify();
      const records = importOpeningBalances(review.entries, snapshot.records, snapshot.doctors);
      onDone(records);
      close();
    } catch (error) { setMessage(error.message || 'Import failed. No records were saved. Refresh and review again.'); }
  }
  return <Dialog title="Import opening balances" eyebrow="Financial year / CSV" description="Review every line before saving. The batch is all-or-nothing; existing balances are not replaced." className="admin-import-dialog" onClose={close}
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close} data-testid="button-cancel-opening-balance-import">Cancel</button><button type="button" className="admin-button" disabled={!review?.entries.length || bad.length > 0 || reading || Boolean(message)} onClick={confirm} data-testid="button-confirm-opening-balance-import">Import {review?.entries.length || 0} records</button></>}>
    <div className="ob-import">
      <div className="ob-import__guide"><strong>CSV columns, in order</strong><p>{OPENING_BALANCE_COLUMNS.map(([, label]) => label).join(', ')}. Use a doctor from Doctor Master; amounts may be positive, negative or zero. IDs and audit details are assigned on save.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { try { download(openingBalanceCSVTemplate(), 'evexia-opening-balances-template.csv'); setMessage(''); } catch (error) { setMessage(error.message || 'Template download failed.'); } }} data-testid="button-opening-balance-template"><Download size={16} aria-hidden="true" /> Download template</button>
      <label className="ob-import__file">Choose a local CSV<input type="file" accept=".csv,text/csv" onChange={select} data-testid="input-opening-balance-import" /></label>
      {reading && <div role="status">Reviewing file…</div>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      {review && <div aria-live="polite"><p><strong>{review.name}</strong> · {review.entries.length - bad.length} ready · {bad.length} with errors{bad.length ? '. Correct the file and choose it again; nothing was saved.' : '. Confirm to save the entire batch.'}</p>
        <div className="ob-import__rows" role="list" aria-label="CSV review">{review.entries.map((entry, index) => <div role="listitem" key={`${entry.line}-${index}`} className={`ob-import__row${entry.errors.length ? ' ob-import__row--error' : ''}`}>
          <details><summary>Line {entry.line}: {entry.values?.registrationNumber || '(no registration number)'} — {entry.errors.length ? `${entry.errors.length} errors` : 'Ready'}</summary>
            <dl>{OPENING_BALANCE_COLUMNS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{entry.fields?.[key] ?? entry.values?.[key] ?? '—'}</dd></div>)}</dl>
          </details>
          {entry.errors.length > 0 && <ul>{entry.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
        </div>)}</div>
      </div>}
    </div>
  </Dialog>;
}

export default function OpeningBalanceMaster() {
  useAdminPreferences();
  const [, navigate] = useLocation();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('saved');
    return value === 'added' ? 'Opening balance added.' : value === 'updated' ? 'Opening balance updated.' : '';
  });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [confirming, setConfirming] = useState(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).has('saved')) window.history.replaceState(window.history.state, '', PATH); }, []);
  useEffect(() => {
    function onStorage(event) { if (event.key === OPENING_BALANCE_KEY || event.key === DOCTOR_STORAGE_KEY || event.key === null) setStale(true); }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  function refresh() {
    try { setSnapshot(loadOpeningBalanceSnapshots()); setError(''); setStale(false); setConfirming(null); setImporting(false); }
    catch (cause) { setError(cause.message || 'Opening balances could not be loaded.'); setSnapshot(null); setStale(true); }
  }
  useEffect(() => { refresh(); }, []);
  function verify() {
    if (!snapshot || stale) throw new Error('Records changed in another tab. Refresh before continuing.');
    const current = loadOpeningBalanceSnapshots();
    if (!same(current.records, snapshot.records) || !same(current.doctors, snapshot.doctors)) {
      setStale(true);
      throw new Error('Opening balances or doctors changed. Refresh records before continuing.');
    }
    return current;
  }
  const doctors = useMemo(() => new Map((snapshot?.doctors || []).map((doctor) => [doctor.id, doctor])), [snapshot]);
  const records = snapshot?.records || [];
  const visible = useMemo(() => records.filter((record) => {
    const doctor = doctors.get(record.doctorId);
    const needle = search.trim().toLocaleLowerCase();
    return (status === 'all' || status === record.status) && (!needle || [record.startYear, record.endYear, `${record.startYear}-${record.endYear}`, doctor?.name, doctor?.registrationNumber, record.doctorId, record.amount].some((value) => String(value ?? '').toLocaleLowerCase().includes(needle)));
  }), [records, doctors, search, status]);
  const pagination = useTablePagination(visible);
  function changeStatus() {
    if (!confirming) return;
    try {
      verify();
      const next = confirming.status === 'active' ? 'inactive' : 'active';
      const updated = setOpeningBalanceStatus(snapshot.records, snapshot.doctors, confirming.id, next);
      setSnapshot({ ...snapshot, records: updated });
      setConfirming(null);
      setError('');
      setNotice(`Opening balance ${next === 'active' ? 'activated' : 'inactivated'}.`);
    } catch (cause) { setError(cause.message || 'Status could not be changed. Refresh records.'); }
  }
  function exportRows() {
    try {
      verify();
      download(exportOpeningBalanceCSV(visible, snapshot.doctors), 'evexia-opening-balances.csv');
      setError('');
    } catch (cause) { setError(cause.message || 'CSV export failed. Refresh records.'); }
  }
  function actions(record, mobile = false) {
    return <div className={mobile ? 'admin-mr-card__actions' : 'admin-table__actions'}>
      <button type="button" className={mobile ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => navigate(`${PATH}/${encodeURIComponent(record.id)}`)} title="Edit" aria-label={`Edit balance for ${doctors.get(record.doctorId)?.name || record.doctorId}`} data-testid={`button-edit-opening-balance-${record.id}`}><Pencil size={16} aria-hidden="true" />{mobile && 'Edit'}</button>
      <button type="button" className={mobile ? 'admin-mr-card__action' : 'admin-icon-button'} onClick={() => { setConfirming(record); setError(''); }} title={record.status === 'active' ? 'Inactivate' : 'Activate'} aria-label={`${record.status === 'active' ? 'Inactivate' : 'Activate'} balance for ${doctors.get(record.doctorId)?.name || record.doctorId}`} data-testid={`button-toggle-opening-balance-${record.id}`}><CirclePower size={16} aria-hidden="true" />{mobile && (record.status === 'active' ? 'Inactivate' : 'Activate')}</button>
    </div>;
  }
  const columns = [
    { key: 'number', label: 'Sr No.', render: (_, index) => index + 1 },
    { key: 'year', label: 'Financial year', render: (record) => <span className="ob-period"><strong>{record.startYear}–{record.endYear}</strong>{record.id.startsWith('sample-opening-balance-') && <small className="ob-sample">Sample</small>}</span> },
    { key: 'doctor', label: 'Doctor', render: (record) => { const doctor = doctors.get(record.doctorId); return doctor ? <span className="ob-doctor"><strong>{doctor.name}</strong><small>{doctor.registrationNumber || 'No registration number'}</small></span> : <span className="ob-doctor ob-missing">Missing doctor<small>ID: {record.doctorId}</small></span>; } },
    { key: 'amount', label: 'Opening balance', render: (record) => <span className={`ob-number${record.amount < 0 ? ' ob-number--negative' : ''}`} data-testid={`text-opening-balance-amount-${record.id}`}>{money.format(record.amount)}</span> },
    { key: 'status', label: 'Status', render: (record) => <StatusBadge status={record.status} id={record.id} kind="opening-balance" /> },
    { key: 'created', label: 'Created details', render: (record) => audit(record.createdBy, record.createdAt) },
    { key: 'updated', label: 'Updated details', render: (record) => audit(record.updatedBy, record.updatedAt) },
    { key: 'actions', label: 'Actions', render: (record) => actions(record) },
  ];
  return <AdminLayout title="Opening Balance Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Finance</p><h1>Opening Balance Master</h1><p className="admin-page-head__description">Set each doctor’s opening position for a financial year. Signed amounts and changes stay in this browser.</p></div>
      <div className="ob-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-opening-balances"><RefreshCw size={16} aria-hidden="true" /> Refresh records</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={!snapshot || stale} onClick={() => setImporting(true)} data-testid="button-import-opening-balances"><Upload size={16} aria-hidden="true" /> Import data</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={!snapshot || stale || !visible.length} onClick={exportRows} data-testid="button-export-opening-balances"><Download size={16} aria-hidden="true" /> Export data</button>
        <button type="button" className="admin-button" disabled={!snapshot || stale} onClick={() => navigate(`${PATH}/new`)} data-testid="button-add-opening-balance"><Plus size={16} aria-hidden="true" /> Add opening balance</button>
      </div></div>
    {stale && <div className="admin-feedback admin-feedback--error ob-stale" role="alert"><p>Opening balances or doctor records may have changed in another tab. Refresh before editing, importing or exporting.</p><button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-recover-opening-balances">Refresh records</button></div>}
    {notice && <div className="admin-feedback" role="status" data-testid="status-opening-balance-feedback">{notice}</div>}
    {error && !confirming && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {snapshot && <div className="ob-context" aria-label="Balance overview"><div className="ob-context__item"><span>Records</span><strong>{records.length}</strong></div><div className="ob-context__item"><span>Active</span><strong>{records.filter((record) => record.status === 'active').length}</strong></div><span className="ob-context__note">{records.some((record) => record.id.startsWith('sample-opening-balance-')) ? 'Sample balances are illustrative, not real financial data. ' : ''}Browser-local preview · no ledger entries are posted</span></div>}
    <section className="admin-panel" aria-label="Opening balance list">
      <div className="admin-toolbar"><div className="admin-toolbar__fields"><label className="admin-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search opening balances</span><input value={search} onChange={(event) => { setSearch(event.target.value); pagination.resetPage(); }} placeholder="Search year, doctor or amount" data-testid="input-search-opening-balances" /></label>
        <div className="admin-filter"><label htmlFor="ob-status">Status</label><select id="ob-status" className="admin-select" value={status} onChange={(event) => { setStatus(event.target.value); pagination.resetPage(); }} data-testid="select-opening-balance-status"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
      </div></div>
      {!snapshot && !error && <div aria-label="Loading opening balances" role="status">{[0, 1, 2, 3].map((n) => <div key={n} className="ob-skeleton" />)}</div>}
      {!snapshot && error && <div className="admin-empty" role="alert"><span className="admin-empty__icon"><Landmark size={22} /></span><strong>Opening balances could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={refresh} data-testid="button-retry-opening-balances">Try again</button></div>}
      {snapshot && (visible.length ? <><div className="ob-desktop"><DataTable columns={columns} rows={pagination.pageRows} rowOffset={pagination.startIndex} rowKey={(record) => record.id} label="Opening balance records" testIdPrefix="opening-balance" /></div>
        <div className="ob-mobile" role="list" aria-label="Opening balance records">{pagination.pageRows.map((record) => { const doctor = doctors.get(record.doctorId); return <article key={record.id} role="listitem" className="ob-card" data-testid={`card-opening-balance-${record.id}`}><div className="ob-card__head"><div><small className="ob-period">{record.startYear}–{record.endYear}{record.id.startsWith('sample-opening-balance-') && <span className="ob-sample">Sample</span>}</small><h2>{doctor?.name || <span className="ob-missing">Missing doctor · {record.doctorId}</span>}</h2>{doctor && <small>{doctor.registrationNumber}</small>}</div><StatusBadge status={record.status} id={record.id} kind="opening-balance" /></div><dl className="ob-card__details"><div><dt>Opening balance</dt><dd className={`ob-number${record.amount < 0 ? ' ob-number--negative' : ''}`}>{money.format(record.amount)}</dd></div><div><dt>Created details</dt><dd>{audit(record.createdBy, record.createdAt)}</dd></div><div><dt>Updated details</dt><dd>{audit(record.updatedBy, record.updatedAt)}</dd></div></dl>{actions(record, true)}</article>; })}</div></> :
        <div className="admin-empty" data-testid="status-opening-balance-empty"><span className="admin-empty__icon"><Landmark size={22} aria-hidden="true" /></span><strong>{records.length ? 'No matching balances' : 'No opening balances yet'}</strong><p>{records.length ? 'Try another year, doctor or status.' : 'Add a doctor’s financial-year opening balance to start your register.'}</p>{!records.length && <button type="button" className="admin-button" disabled={stale} onClick={() => navigate(`${PATH}/new`)} data-testid="button-add-first-opening-balance">Add opening balance</button>}</div>)}
      {snapshot && <TablePagination {...pagination} filtered={visible.length} total={records.length} label={visible.length === 1 ? 'balance' : 'balances'} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} testId="text-opening-balance-count" />}
    </section>
    {confirming && <ConfirmationDialog title={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} opening balance?`} description={`Set ${doctors.get(confirming.doctorId)?.name || 'this doctor’s balance'} for ${confirming.startYear}–${confirming.endYear} to ${confirming.status === 'active' ? 'inactive' : 'active'}? The saved amount remains in this browser.`} actionLabel={`${confirming.status === 'active' ? 'Inactivate' : 'Activate'} balance`} onConfirm={changeStatus} onClose={() => { setConfirming(null); setError(''); }} error={error} />}
    {importing && snapshot && <ImportDialog snapshot={snapshot} verify={verify} onDone={(updated) => { setSnapshot({ ...snapshot, records: updated }); setNotice(`${updated.length - snapshot.records.length} opening balances imported.`); setError(''); }} onClose={() => setImporting(false)} />}
  </AdminLayout>;
}