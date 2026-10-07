import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { reviewLocations, importLocations } from '../../services/serverLocations.js';
import { downloadBlob } from '../../services/downloads.js';
import { sampleExcel } from '../../services/mockExcelImport.js';
import '../../excel-import.css';

export default function StorageLocationImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [samplePending, setSamplePending] = useState('');
  const busy = useRef(false);
  const sampleBusy = useRef(false);
  const sequence = useRef(0);
  const picker = useRef(null);
  const alive = useRef(true);
  const sampleController = useRef(null);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      const session = getSession();
      if (session.user?.id !== owner || !['authenticated', 'renewing', 'renewal-error'].includes(session.status)) {
        sequence.current++;
        sampleController.current?.abort();
        busy.current = false;
        setPending('');
        setReview(null);
        setFile(null);
        setError('');
        setMessage('');
        if (picker.current) picker.current.value = '';
      }
    });
    return () => { alive.current = false; sequence.current++; sampleController.current?.abort(); unsubscribe(); };
  }, []);

  function replaceFile(next) {
    if (busy.current === 'commit') return;
    sequence.current++;
    sampleController.current?.abort();
    busy.current = false;
    setPending('');
    setFile(next);
    setReview(null);
    setError('');
    setMessage('');
  }

  async function run(commit) {
    if (!file || busy.current || getSession().status !== 'authenticated' || (commit && !review?.valid)) return;
    const current = ++sequence.current;
    const owner = getSession().user?.id;
    const guard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current && owner && getSession().user?.id === owner;
    busy.current = commit ? 'commit' : 'review';
    setPending(commit ? 'commit' : 'review');
    setError('');
    setMessage('');
    const digest = review?.digest;
    setReview(null); // Every commit attempt consumes the review, including conflicts and lost responses.
    try {
      if (commit) {
        const result = await importLocations(file, digest);
        guard();
        if (!active()) return;
        setMessage(`${result.imported} storage locations imported into shared server records.`);
        setFile(null);
        if (picker.current) picker.current.value = '';
      } else {
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        const result = await reviewLocations(file);
        guard();
        if (active()) setReview({ ...result, filename: file.name });
      }
    } catch (cause) {
      if (active()) setError(`${cause.message || 'Storage Location import failed.'}${commit ? ' Review the file again before confirming another import; inspect shared records first if the save outcome is uncertain.' : ''}`);
    } finally {
      if (active()) { busy.current = false; setPending(''); }
    }
  }

  async function sample(format) {
    if (sampleBusy.current || getSession().status !== 'authenticated') return;
    sampleBusy.current = true;
    const current = sequence.current;
    const owner = getSession().user?.id;
    const identityGuard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current && owner && getSession().user?.id === owner;
    const guard = () => {
      identityGuard();
      if (!active()) throw new Error('Sample download cancelled. Retry from the current screen.');
    };
    const controller = new AbortController();
    sampleController.current = controller;
    setSamplePending(format);
    setError('');
    try {
      const blob = format === 'csv'
        ? new Blob(['\uFEFFStorage Location,Address,Status\r\nExample supply room,Building A Ground floor,active\r\n'], { type: 'text/csv;charset=utf-8' })
        : sampleExcel('storage-location');
      await downloadBlob(blob, `evexia-storage-locations.${format}`,
        { source: 'storage_location', kind: 'template', format: format.toUpperCase() },
        { guard, signal: controller.signal });
    } catch (cause) {
      if (active()) setError(`Sample download failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Retry this download.'}`);
    } finally {
      sampleBusy.current = false;
      if (alive.current) setSamplePending('');
    }
  }

  const valid = review?.rows.filter((row) => !row.errors.length) || [];
  const invalid = review?.rows.filter((row) => row.errors.length) || [];
  const rowValues = (row) => <dl><div><dt>Storage Location</dt><dd>{row.name || '—'}</dd></div><div><dt>Address</dt><dd>{row.address || '—'}</dd></div><div><dt>Status</dt><dd>{row.status || '—'}</dd></div></dl>;
  return <AdminLayout title="Import Storage Location data">
    <div className="excel-import excel-import--storage-location">
      <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/storage-locations')}><ArrowLeft size={16} aria-hidden="true" /> Back to Storage Location Master</button>
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Storage Location data</h1>
          <p className="admin-page-head__description">Download a sample, choose CSV or Excel and review each row. Review saves nothing; explicit confirmation creates shared server records only, all-or-nothing.</p>
        </div>
        <span className="excel-import__mock">Shared server records</span>
      </div>
      <MasterImportTabs kind="storage-location" />
      <div className="excel-import__steps">
        <section className="excel-import__card" aria-labelledby="excel-sample-title" aria-busy={Boolean(samplePending)}>
          <span className="excel-import__number">01</span>
          <div className="excel-import__icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
          <h2 id="excel-sample-title">Download sample Excel</h2>
          <p>Use the sample headers and exactly one worksheet. UTF-8 CSV and genuine .xlsx workbooks are supported.</p>
          <div className="excel-import__columns"><strong>Expected columns</strong><span>Storage Location · Address · Status</span>
            <strong>Compatible backup schema (CSV or Excel)</strong><span>Storage Location · Address · Status · Created By · Created At · Updated By · Updated At</span>
          </div>
          <p>Incoming audit values are ignored. The authenticated importer becomes the creator; existing records are never updated.</p>
          <div className="excel-import__sample-actions">
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(samplePending)} onClick={() => sample('csv')}>Download CSV sample</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(samplePending)} onClick={() => sample('xlsx')}><Download size={16} aria-hidden="true" /> Download Excel sample</button>
          </div>
          {samplePending && <p role="status">Preparing {samplePending === 'xlsx' ? 'Excel' : 'CSV'} sample…</p>}
        </section>
        <section className="excel-import__card" aria-labelledby="excel-upload-title" aria-busy={Boolean(pending)}>
          <span className="excel-import__number">02</span>
          <div className="excel-import__icon"><Upload size={23} aria-hidden="true" /></div>
          <h2 id="excel-upload-title">Upload &amp; review</h2>
          <p>Choose CSV or .xlsx, up to 2 MiB and 1,000 records. All rows must be valid. Non-deleted names, including active and inactive locations, must be unique regardless of case or normalized whitespace. Create-only: no upserts or partial imports.</p>
          <p>No ID, version or deletion columns, .xls, .xlsm, formulas, macros, external links or encrypted archives.</p>
          <label className="excel-import__picker">
            <FileSpreadsheet size={19} aria-hidden="true" /><span>{file ? file.name : 'Choose CSV or Excel file'}</span>
            <input ref={picker} aria-label="Storage Location CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending === 'commit'} onChange={(event) => replaceFile(event.target.files?.[0] || null)} data-testid="input-storage-import" />
          </label>
          <button type="button" className="admin-button" disabled={Boolean(pending) || !file} onClick={() => run(false)}>{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : 'Upload & review'}</button>
        </section>
      </div>
      <p className="admin-page-head__description">Old browser backups remain compatible; no browser records are automatically migrated or mirrored. Allergen, Purchase Order and Purchase Received retain separate browser-local locations and IDs. Exports allow 5,000 name/address/status matches; files above 1,000 rows must be split before import. A new login requires fresh review.</p>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
      {message && <div className="admin-feedback" role="status">{message}</div>}
      {review && <section className="excel-import__report" aria-labelledby="excel-report-title" aria-live="polite" data-testid="storage-location-excel-report">
        <div className="excel-import__report-head">
          <div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="excel-report-title">{review.filename}</h2>
            <p>{review.valid ? 'All rows valid. Confirm to save.' : 'Nothing can be imported until all errors are corrected.'} No rows have been saved by this review.</p>
          </div>
          <div className="excel-import__totals"><span className="excel-import__valid"><CheckCircle2 size={17} aria-hidden="true" /> {valid.length} valid</span><span className="excel-import__invalid"><XCircle size={17} aria-hidden="true" /> {invalid.length} invalid</span></div>
        </div>
        <div className="excel-import__results">
          <div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details key={row.row} className="excel-import__row"><summary>Row {row.row} · {row.name} <span>Valid</span></summary>{rowValues(row)}</details>) : <p>No valid rows in this upload.</p>}</div>
          <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details key={row.row} open className="excel-import__row excel-import__row--invalid"><summary>Row {row.row} · {row.name || '(unnamed)'} <span>{row.errors.length} error{row.errors.length === 1 ? '' : 's'}</span></summary>{rowValues(row)}<ul>{row.errors.map((text, index) => <li key={index}>{text}</li>)}</ul></details>) : <p>No errors found. Confirm explicitly to import this batch.</p>}</div>
        </div>
        <button type="button" className="admin-button" disabled={Boolean(pending) || !review.valid} onClick={() => run(true)} data-testid="button-confirm-storage-import">Confirm import of {review.rows.length} locations</button>
      </section>}
    </div>
  </AdminLayout>;
}
