import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import CredentialReveal from '../../components/admin/CredentialReveal.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { reviewMRs, importMRs, sampleMRs, downloadMRFile } from '../../services/serverMRs.js';
import '../../excel-import.css';

const COLUMNS = 'MR Name · Phone No. · User ID · Email ID · HQ · Assigned Zone · Employee Code · Date of Joining · Designation · Reporting Manager · Payment Limit · Doctor Days Limit · Status · Pincode · Address Line 1 · Address Line 2 · Landmark · City · State · Country · Contact Requirement';

export default function MRImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [samplePending, setSamplePending] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const busy = useRef(false);
  const sampleBusy = useRef(false);
  const sequence = useRef(0);
  const picker = useRef(null);
  const alive = useRef(true);
  const controllerRef = useRef(null);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      const session = getSession();
      if (session.user?.id !== owner || !['authenticated', 'renewing', 'renewal-error'].includes(session.status)) {
        sequence.current++; controllerRef.current?.abort(); busy.current = false;
        setPending(''); setReview(null); setFile(null); setError(''); setMessage(''); setUncertain(false); setCredentials(null);
        if (picker.current) picker.current.value = '';
      }
    });
    return () => { alive.current = false; sequence.current++; controllerRef.current?.abort(); unsubscribe(); };
  }, []);

  function replaceFile(next) {
    if (busy.current === 'commit' || uncertain) return;
    sequence.current++; busy.current = false; setPending(''); setFile(next); setReview(null); setError(''); setMessage('');
  }
  async function run(commit, reconcile = false) {
    if (!file || busy.current || (uncertain && !reconcile) || getSession().status !== 'authenticated' || (commit && !review?.valid)) return;
    const current = ++sequence.current;
    const owner = getSession().user?.id;
    const guard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current && owner && getSession().user?.id === owner;
    busy.current = commit ? 'commit' : 'review';
    setPending(busy.current); setError(''); setMessage('');
    const digest = review?.digest;
    setReview(null); // each commit attempt consumes the review
    try {
      if (commit) {
        const result = await importMRs(file, digest);
        guard();
        if (!active()) return;
        setMessage(`${result.imported} MRs imported with login accounts.`);
        setCredentials(result.credentials || []);
        setFile(null);
        if (picker.current) picker.current.value = '';
      } else {
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        const result = await reviewMRs(file);
        guard();
        if (active()) {
          setReview({ ...result, filename: file.name }); setUncertain(false);
          if (reconcile) setMessage(result.valid ? 'Current server checks found no conflicts. Confirm explicitly only if the earlier batch is not already saved.' : 'Current server checks found conflicts. Your earlier batch may already be saved; inspect MR Master before retrying.');
        }
      }
    } catch (cause) {
      if (active()) {
        setUncertain(Boolean(commit && cause.ambiguous));
        setError(`${cause.message || 'MR import failed.'}${cause.ambiguous ? ' Credentials for an uncertain import cannot be recovered; inspect MR Master and use Reset password if needed.' : ''}`);
      }
    } finally { if (active()) { busy.current = false; setPending(''); } }
  }
  async function sample(format) {
    if (sampleBusy.current || getSession().status !== 'authenticated') return;
    sampleBusy.current = true;
    const owner = getSession().user?.id;
    const identityGuard = reportingIdentityGuard();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSamplePending(format); setError('');
    try {
      const blob = await sampleMRs(format, controller.signal);
      identityGuard();
      if (!alive.current || getSession().user?.id !== owner) throw new Error('Sample download cancelled.');
      downloadMRFile(blob, format, true);
    } catch (cause) { if (alive.current) setError(`Sample download failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Retry.'}`); }
    finally { sampleBusy.current = false; if (alive.current) setSamplePending(''); }
  }

  const rows = review?.rows || [];
  const valid = rows.filter((row) => !row.errors.length);
  const invalid = rows.filter((row) => row.errors.length);
  return <AdminLayout title="Import MR data">
    <div className="excel-import excel-import--mr">
      <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/mrs')}><ArrowLeft size={16} aria-hidden="true" /> Back to MR Master</button>
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import MR data</h1>
          <p className="admin-page-head__description">Download a sample, choose CSV or Excel and review each row. Review saves nothing; explicit confirmation creates MR records and login accounts, all-or-nothing.</p></div>
        <span className="excel-import__mock">Shared server records</span>
      </div>
      <MasterImportTabs kind="mr" />
      <div className="excel-import__steps">
        <section className="excel-import__card" aria-labelledby="excel-sample-title" aria-busy={Boolean(samplePending)}>
          <span className="excel-import__number">01</span>
          <div className="excel-import__icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
          <h2 id="excel-sample-title">Download sample</h2>
          <p>Use the sample headers and exactly one worksheet. UTF-8 CSV and genuine .xlsx workbooks are supported.</p>
          <div className="excel-import__columns"><strong>Columns</strong><span>{COLUMNS}</span>
            <strong>Backup schema</strong><span>The same columns, optionally followed by readable audit columns, which are ignored on import. A file without Contact Requirement is treated as required.</span></div>
          <p>Passwords, hashes, identity links, versions and deletion columns are rejected. HQ, zone and manager labels must match exactly one existing record; reporting managers may also be MRs in the same file. Designation must be one active catalogue name or its existing UUID, not free text. Set up catalogue choices before review.</p>
          <div className="excel-import__sample-actions">
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(samplePending)} onClick={() => sample('csv')} data-testid="button-sample-mr-csv">Download CSV sample</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(samplePending)} onClick={() => sample('xlsx')} data-testid="button-sample-mr-xlsx"><Download size={16} aria-hidden="true" /> Download Excel sample</button>
          </div>
          {samplePending && <p role="status">Preparing {samplePending === 'xlsx' ? 'Excel' : 'CSV'} sample…</p>}
        </section>
        <section className="excel-import__card" aria-labelledby="excel-upload-title" aria-busy={Boolean(pending)}>
          <span className="excel-import__number">02</span>
          <div className="excel-import__icon"><Upload size={23} aria-hidden="true" /></div>
          <h2 id="excel-upload-title">Upload &amp; review</h2>
          <p>Choose CSV or .xlsx, up to 2 MiB and 1,000 records. All rows must be valid. Create-only: no upserts or partial imports. Creating accounts can take up to two minutes.</p>
          <label className="excel-import__picker"><FileSpreadsheet size={19} aria-hidden="true" /><span>{file ? file.name : 'Choose CSV or Excel file'}</span>
            <input ref={picker} aria-label="MR CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending === 'commit' || uncertain} onChange={(event) => replaceFile(event.target.files?.[0] || null)} data-testid="input-mr-import" /></label>
          <button type="button" className="admin-button" disabled={Boolean(pending) || !file || uncertain} onClick={() => run(false)} data-testid="button-review-mr-import">{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : 'Upload & review'}</button>
        </section>
      </div>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
      {uncertain && <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run(false, true)}>Check current server conflicts (no writes)</button>}
      {message && <div className="admin-feedback" role="status" data-testid="status-mr-import">{message}</div>}
      {review && <section className="excel-import__report" aria-labelledby="excel-report-title" aria-live="polite" data-testid="mr-excel-report">
        <div className="excel-import__report-head">
          <div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="excel-report-title">{review.filename}</h2>
            <p>{review.valid ? 'All rows valid. Confirm to create these MRs and accounts.' : 'Nothing can be imported until all errors are corrected.'} No rows have been saved by this review.</p></div>
          <div className="excel-import__totals"><span className="excel-import__valid"><CheckCircle2 size={17} aria-hidden="true" /> {valid.length} valid</span><span className="excel-import__invalid"><XCircle size={17} aria-hidden="true" /> {invalid.length} invalid</span></div>
        </div>
        <div className="excel-import__results">
          <div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details key={row.row} className="excel-import__row"><summary>Row {row.row} · {row.name} <span>Valid</span></summary><dl><div><dt>User ID</dt><dd>{row.userId || '—'}</dd></div></dl></details>) : <p>No valid rows in this upload.</p>}</div>
          <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details key={row.row} open className="excel-import__row excel-import__row--invalid"><summary>Row {row.row} · {row.name || '(unnamed)'} <span>{row.errors.length} error{row.errors.length === 1 ? '' : 's'}</span></summary><ul>{row.errors.map((text, index) => <li key={index}>{text}</li>)}</ul></details>) : <p>No errors found. Confirm explicitly to import this batch.</p>}</div>
        </div>
        <button type="button" className="admin-button" disabled={Boolean(pending) || !review.valid || uncertain} onClick={() => run(true)} data-testid="button-confirm-mr-import">Confirm import of {rows.length} MRs</button>
      </section>}
    </div>
    {credentials && <CredentialReveal credentials={credentials} title="Import complete. Copy the login credentials" onClose={() => setCredentials(null)} />}
  </AdminLayout>;
}
