import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { reviewAllergens, importAllergens, sampleAllergens, downloadAllergenFile } from '../../services/serverAllergens.js';
const ALLERGEN_COLUMNS = [['name', 'Product Name'], ['category_name', 'Category'], ['selling_price', 'Selling Price'], ['gst', 'GST'], ['storage_location_name', 'Storage Location'], ['concentration', 'Concentration'], ['threshold_limit', 'Threshold limit'], ['status', 'Status'], ['mix', 'Mix / No Mix']];
import '../../excel-import.css';

export default function AllergenImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [samplePending, setSamplePending] = useState('');
  const [uncertain, setUncertain] = useState(false);
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
        setUncertain(false);
        if (picker.current) picker.current.value = '';
      }
    });
    return () => { alive.current = false; sequence.current++; sampleController.current?.abort(); unsubscribe(); };
  }, []);

  function replaceFile(next) {
    if (busy.current === 'commit' || uncertain) return;
    sequence.current++;
    sampleController.current?.abort();
    busy.current = false;
    setPending('');
    setFile(next);
    setReview(null);
    setError('');
    setMessage('');
  }

  async function run(commit, reconcile = false) {
    if (!file || busy.current || (uncertain && !reconcile) || getSession().status !== 'authenticated' || (commit && !review?.valid)) return;
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
        const result = await importAllergens(file, digest);
        guard();
        if (!active()) return;
        setMessage(`${result.imported} allergen products imported into shared server records.`);
        setFile(null);
        if (picker.current) picker.current.value = '';
      } else {
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        const result = await reviewAllergens(file);
        guard();
        if (active()) {
          setReview({ ...result, filename: file.name });
          setUncertain(false);
          if (reconcile) setMessage(result.valid ? 'Current server checks found no conflicts. Review the file before explicitly confirming a new attempt.' : 'Current server checks found errors or existing records. Do not repeat the import. Inspect the shared list; your prior batch may already be saved.');
        }
      }
    } catch (cause) {
      if (active()) {
        setUncertain(Boolean(commit && cause.ambiguous));
        setError(`${cause.message || 'Allergen import failed.'}${cause.ambiguous ? ' Inspect shared records before any new attempt.' : ''}`);
      }
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
      const blob = await sampleAllergens(format, controller.signal);
      guard();
      downloadAllergenFile(blob, format, true);
    } catch (cause) {
      if (active()) setError(`Sample download failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Retry this download.'}`);
    } finally {
      sampleBusy.current = false;
      if (alive.current) setSamplePending('');
    }
  }

  const valid = review?.rows.filter((row) => !row.errors.length) || [];
  const invalid = review?.rows.filter((row) => row.errors.length) || [];
  const rowValues = (row) => <dl>{ALLERGEN_COLUMNS.map(([field, label]) => <div key={field}><dt>{label}</dt><dd>{row[field] ?? '—'}</dd></div>)}</dl>;
  return <AdminLayout title="Import Allergen data">
    <div className="excel-import excel-import--allergen">
      <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/allergens')}><ArrowLeft size={16} aria-hidden="true" /> Back to Allergen Master</button>
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Allergen data</h1>
          <p className="admin-page-head__description">Download a sample, choose CSV or Excel and review each row. Review saves nothing; explicit confirmation creates shared server records only, all-or-nothing.</p>
        </div>
        <span className="excel-import__mock">Shared server records</span>
      </div>
      <MasterImportTabs kind="allergen" />
      <div className="excel-import__steps">
        <section className="excel-import__card" aria-labelledby="excel-sample-title" aria-busy={Boolean(samplePending)}>
          <span className="excel-import__number">01</span>
          <div className="excel-import__icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
          <h2 id="excel-sample-title">Download sample Excel</h2>
          <p>Use the sample headers and exactly one worksheet. UTF-8 CSV and genuine .xlsx workbooks are supported.</p>
          <div className="excel-import__columns"><strong>Expected columns (exact order)</strong><span>{ALLERGEN_COLUMNS.map(([, label]) => label).join(' · ')}</span>
            <strong>Current backup schema (CSV or Excel)</strong><span>The same nine columns, followed by Created By · Created At · Updated By · Updated At</span>
          </div>
          <p>Incoming audit values are ignored. The authenticated importer becomes the creator; existing records are never updated. GST is 0 to 100; selling price and threshold are optional exact decimals.</p>
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
          <p>Choose CSV or .xlsx, up to 2 MiB and 1,000 records. All rows must be valid. Product names must be unique among non-deleted products. Category and Storage Location must match one active shared record. Mix imports as Mix (true) or No Mix (false); a legacy HSN column is ignored. Create-only: no upserts or partial imports.</p>
          <p>No ID, version or deletion columns, .xls, .xlsm, formulas, macros, external links or encrypted archives.</p>
          <label className="excel-import__picker">
            <FileSpreadsheet size={19} aria-hidden="true" /><span>{file ? file.name : 'Choose CSV or Excel file'}</span>
            <input ref={picker} aria-label="Allergen CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending === 'commit' || uncertain} onChange={(event) => replaceFile(event.target.files?.[0] || null)} data-testid="input-allergen-import" />
          </label>
          <button type="button" className="admin-button" disabled={Boolean(pending) || !file || uncertain} onClick={() => run(false)}>{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : 'Upload & review'}</button>
        </section>
      </div>
      <p className="admin-page-head__description">Local browser allergen data is never migrated or mirrored. Exports allow 5,000 matches; files above 1,000 rows must be split before import. A new login requires fresh review.</p>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
      {uncertain && <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run(false, true)}>Check current server conflicts (no writes)</button>}
      {message && <div className="admin-feedback" role="status">{message}</div>}
      {review && <section className="excel-import__report" aria-labelledby="excel-report-title" aria-live="polite" data-testid="allergen-excel-report">
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
        <button type="button" className="admin-button" disabled={Boolean(pending) || !review.valid || uncertain} onClick={() => run(true)} data-testid="button-confirm-allergen-import">Confirm import of {review.rows.length} allergen products</button>
      </section>}
    </div>
  </AdminLayout>;
}
