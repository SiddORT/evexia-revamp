import { downloadBlob } from '../../services/downloads.js';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { getSession, reportingIdentityGuard } from '../../auth/adminSession.js';
import { reviewZones, importZones } from '../../services/serverZones.js';
import { sampleExcel } from '../../services/mockExcelImport.js';
import '../../excel-import.css';

export default function ZoneImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const sequence = useRef(0);
  const picker = useRef(null);
  useEffect(() => () => { sequence.current++; }, []);

  function replaceFile(next) {
    sequence.current++;
    busy.current = false;
    setPending('');
    setFile(next);
    setReview(null);
    setError('');
    setMessage('');
  }

  async function run(commit) {
    if (!file || busy.current || (commit && !review?.valid)) return;
    const current = ++sequence.current;
    const owner = getSession().user?.id;
    const guard = reportingIdentityGuard();
    const active = () => current === sequence.current && owner && getSession().user?.id === owner;
    busy.current = true;
    setPending(commit ? 'commit' : 'review');
    setError('');
    setMessage('');
    const digest = review?.digest;
    setReview(null); // Each attempt consumes the review, including failed commits.
    try {
      if (commit) {
        const result = await importZones(file, digest);
        guard();
        if (!active()) return;
        setMessage(`${result.imported} zones imported into shared server records.`);
        setFile(null);
        if (picker.current) picker.current.value = '';
      } else {
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        const result = await reviewZones(file);
        guard();
        if (active()) setReview({ ...result, filename: file.name });
      }
    } catch (cause) {
      if (active()) setError(`${cause.message || 'Zone import failed.'}${commit ? ' Review the file again before confirming another import; inspect shared records first if the save outcome is uncertain.' : ''}`);
    } finally {
      if (active()) { busy.current = false; setPending(''); }
    }
  }

  async function sample(format) {
    setError('');
    try {
      const blob = format === 'csv' ? new Blob(['\uFEFFZone Name,Status\r\nSample Zone,Active\r\n'], { type: 'text/csv;charset=utf-8' }) : sampleExcel('zone');
      await downloadBlob(blob, `evexia-zone-sample.${format}`, { source: 'zone', kind: 'sample', format: format.toUpperCase() });
    } catch (cause) { setError(cause.message || 'Could not download the Zone sample.'); }
  }

  const valid = review?.rows.filter((row) => !row.errors.length) || [];
  const invalid = review?.rows.filter((row) => row.errors.length) || [];
  return <AdminLayout title="Import Zone data">
    <div className="excel-import">
      <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/zones')}><ArrowLeft size={16} aria-hidden="true" /> Back to Zone Master</button>
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Zone data</h1>
          <p className="admin-page-head__description">Download a sample, choose CSV or Excel and review each row. Review saves nothing; explicit confirmation creates shared server records only, all-or-nothing.</p>
        </div>
        <span className="excel-import__mock">Shared server records</span>
      </div>
      <MasterImportTabs kind="zone" />
      <div className="excel-import__steps">
        <section className="excel-import__card" aria-labelledby="excel-sample-title">
          <span className="excel-import__number">01</span>
          <div className="excel-import__icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
          <h2 id="excel-sample-title">Download sample Excel</h2>
          <p>Use the sample headers and first worksheet. UTF-8 CSV and genuine .xlsx workbooks are supported.</p>
          <div className="excel-import__columns"><strong>Expected columns</strong><span>Zone Name · Status</span>
            <strong>Compatible backup schema (CSV or Excel)</strong><span>Zone Name · Status · Created By · Created At · Updated By · Updated At</span>
          </div>
          <div className="excel-import__sample-actions">
            <button type="button" className="admin-button admin-button--secondary" onClick={() => sample('csv')}>Download CSV sample</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => sample('xlsx')}><Download size={16} aria-hidden="true" /> Download Excel sample</button>
          </div>
        </section>
        <section className="excel-import__card" aria-labelledby="excel-upload-title" aria-busy={Boolean(pending)}>
          <span className="excel-import__number">02</span>
          <div className="excel-import__icon"><Upload size={23} aria-hidden="true" /></div>
          <h2 id="excel-upload-title">Upload &amp; review</h2>
          <p>Choose CSV or .xlsx, up to 2 MiB and 1,000 records. All rows must be valid. Non-deleted names, including inactive zones, must be unique. No upserts or partial imports.</p>
          <label className="excel-import__picker">
            <FileSpreadsheet size={19} aria-hidden="true" /><span>{file ? file.name : 'Choose CSV or Excel file'}</span>
            <input ref={picker} aria-label="Zone CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending === 'commit'} onChange={(event) => replaceFile(event.target.files?.[0] || null)} />
          </label>
          <button type="button" className="admin-button" disabled={Boolean(pending) || !file} onClick={() => run(false)}>{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : 'Upload & review'}</button>
        </section>
      </div>
      <p className="admin-page-head__description">Browser data clearing does not remove shared zones. No local records are migrated or mirrored. MR, Doctor, Patient and Sales Target demo assignments retain their separate browser-local zones.</p>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
      {message && <div className="admin-feedback" role="status">{message}</div>}
      {review && <section className="excel-import__report" aria-labelledby="excel-report-title" aria-live="polite" data-testid="zone-excel-report">
        <div className="excel-import__report-head">
          <div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="excel-report-title">{review.filename}</h2>
            <p>{review.valid ? 'All rows valid. Confirm to save.' : 'Nothing can be imported until all errors are corrected.'} No rows have been saved by this review.</p>
          </div>
          <div className="excel-import__totals"><span className="excel-import__valid"><CheckCircle2 size={17} aria-hidden="true" /> {valid.length} valid</span><span className="excel-import__invalid"><XCircle size={17} aria-hidden="true" /> {invalid.length} invalid</span></div>
        </div>
        <div className="excel-import__results">
          <div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details key={row.row} className="excel-import__row"><summary>Row {row.row} · {row.name} <span>Valid</span></summary><dl><div><dt>Zone Name</dt><dd>{row.name}</dd></div><div><dt>Status</dt><dd>{row.status}</dd></div></dl></details>) : <p>No valid rows in this upload.</p>}</div>
          <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details key={row.row} open className="excel-import__row excel-import__row--invalid"><summary>Row {row.row} · {row.name || '(unnamed)'} <span>{row.errors.length} error{row.errors.length === 1 ? '' : 's'}</span></summary><ul>{row.errors.map((text, index) => <li key={index}>{text}</li>)}</ul></details>) : <p>No errors found. Confirm explicitly to import this batch.</p>}</div>
        </div>
        <button type="button" className="admin-button" disabled={Boolean(pending) || !review.valid} onClick={() => run(true)}>Confirm import of {review.rows.length} zones</button>
      </section>}
    </div>
  </AdminLayout>;
}
