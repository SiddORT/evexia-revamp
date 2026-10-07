import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { downloadDoctorFile, importDoctors, reviewDoctors, sampleDoctors } from '../../services/serverDoctors.js';
import '../../excel-import.css';

const COLUMNS = 'Doctor Name · Phone · Dial Code · Dial Country · Alternate Phone · Email · Contact Requirement · Date of Joining · Registration Number · Qualification · Clinic Name · Assigned MR · Zone · Invoice Type · GST Number · Drug Licence Number · Order Discount · Days Limit · Payment Limit · Status · Verification · Address Line 1 · Address Line 2 · Landmark · Pincode · Country · State · City';

export default function DoctorImportPage() {
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
  const controller = useRef(null);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      const session = getSession();
      if (session.user?.id !== owner || !['authenticated', 'renewing', 'renewal-error'].includes(session.status)) {
        sequence.current++; controller.current?.abort(); busy.current = false;
        setPending(''); setReview(null); setFile(null); setError(''); setMessage(''); setUncertain(false);
        if (picker.current) picker.current.value = '';
      }
    });
    return () => { alive.current = false; sequence.current++; controller.current?.abort(); unsubscribe(); };
  }, []);
  function replaceFile(next) {
    if (busy.current === 'commit') return;
    sequence.current++; controller.current?.abort(); busy.current = false;
    setPending(''); setFile(next); setReview(null); setError(''); setMessage('');
  }
  async function run(commit) {
    if (!file || busy.current || getSession().status !== 'authenticated' || (commit && (!review?.valid || uncertain))) return;
    const current = ++sequence.current;
    const guard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current;
    busy.current = commit ? 'commit' : 'review'; setPending(busy.current); setError(''); setMessage('');
    const digest = review?.digest;
    setReview(null);
    const request = new AbortController();
    controller.current = request;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
      if (commit) {
        const result = await importDoctors(file, digest);
        guard();
        if (!active()) return;
        setMessage(`${result.imported} doctors imported. All records saved to the shared server directory.`);
        setFile(null); setUncertain(false);
        if (picker.current) picker.current.value = '';
      } else {
        const result = await reviewDoctors(file, request.signal);
        guard();
        if (!active()) return;
        setReview({ ...result, filename: file.name });
        if (uncertain) setMessage('Current conflicts have been checked without saving. Inspect Doctor Master before confirming any retry of the earlier batch.');
        setUncertain(false);
      }
    } catch (cause) {
      try { guard(); } catch { return; }
      if (active()) { setUncertain(Boolean(commit && cause.ambiguous)); setError(`${cause.message || 'Import failed.'}${cause.ambiguous ? ' The result is uncertain. Inspect Doctor Master and review again; do not blindly retry.' : ''}`); }
    } finally { if (active()) { busy.current = false; setPending(''); } }
  }
  async function sample(format) {
    if (sampleBusy.current || getSession().status !== 'authenticated') return;
    sampleBusy.current = true; setSamplePending(format); setError('');
    const guard = reportingIdentityGuard();
    const request = new AbortController();
    controller.current = request;
    try {
      const blob = await sampleDoctors(format, request.signal);
      guard();
      if (alive.current) downloadDoctorFile(blob, format, true);
    } catch (cause) { try { guard(); } catch { return; } if (alive.current) setError(`Sample download failed. ${cause.message}`); }
    finally { sampleBusy.current = false; if (alive.current) setSamplePending(''); }
  }
  const rows = review?.rows || [];
  const valid = rows.filter((row) => !row.errors.length);
  const invalid = rows.filter((row) => row.errors.length);
  return <AdminLayout title="Import Doctor data"><div className="excel-import">
    <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/doctors')}><ArrowLeft size={16} /> Back to Doctor Master</button>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Doctor data</h1><p className="admin-page-head__description">Review CSV or Excel without saving. Explicit confirmation creates the fully valid batch, all-or-nothing.</p></div><span className="excel-import__mock">Shared server records</span></div>
    <MasterImportTabs kind="doctor" />
    <div className="excel-import__steps">
      <section className="excel-import__card" aria-labelledby="excel-sample-title" aria-busy={Boolean(samplePending)}><span className="excel-import__number">01</span><div className="excel-import__icon"><FileSpreadsheet size={23} /></div><h2 id="excel-sample-title">Download sample</h2>
        <p>Keep the full column order and one worksheet. Identifiers, postcodes and exact monetary values should be text cells.</p>
        <div className="excel-import__columns"><strong>Columns</strong><span>{COLUMNS}</span><strong>Earlier full CSV backups</strong><span>Without Contact Requirement, contacts default to optional. Blank commercial settings default to zero; blank verification defaults to unverified. Optional audit columns are ignored.</span></div>
        <p>Assigned MR must resolve to one existing server MR: use user:username, employee:code, server UUID or an exact unique name. Ambiguous/missing references are rejected, never guessed. Zone must match that MR or be blank. Local MR IDs are not migrated. No passwords, accounts or payment ledger are created.</p>
        <div className="excel-import__sample-actions"><button className="admin-button admin-button--secondary" type="button" disabled={Boolean(samplePending)} onClick={() => sample('csv')} data-testid="button-sample-doctor-csv">Download CSV sample</button>
          <button className="admin-button admin-button--secondary" type="button" disabled={Boolean(samplePending)} onClick={() => sample('xlsx')} data-testid="button-sample-doctor-xlsx"><Download size={16} /> Download Excel sample</button></div>
        {samplePending && <p role="status">Preparing {samplePending === 'xlsx' ? 'Excel' : 'CSV'} sample…</p>}
      </section>
      <section className="excel-import__card" aria-labelledby="excel-upload-title" aria-busy={Boolean(pending)}><span className="excel-import__number">02</span><div className="excel-import__icon"><Upload size={23} /></div><h2 id="excel-upload-title">Upload &amp; review</h2><p>CSV or genuine .xlsx, up to 2 MiB and 1,000 records. Create-only: every row must be valid; no upserts or partial imports.</p>
        <label className="excel-import__picker"><FileSpreadsheet size={19} /><span>{file ? file.name : 'Choose CSV or Excel file'}</span><input ref={picker} aria-label="Doctor CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending === 'commit'} onChange={(event) => replaceFile(event.target.files?.[0] || null)} data-testid="input-doctor-import" /></label>
        <button className="admin-button" type="button" disabled={!file || Boolean(pending)} onClick={() => run(false)} data-testid="button-review-doctor-import">{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : uncertain ? 'Check current conflicts (no writes)' : 'Upload & review'}</button>
      </section>
    </div>
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {message && <div className="admin-feedback" role="status" data-testid="status-doctor-import">{message}</div>}
    {review && <section className="excel-import__report" aria-labelledby="excel-report-title" aria-live="polite" data-testid="doctor-excel-report">
      <div className="excel-import__report-head"><div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="excel-report-title">{review.filename}</h2><p>No records saved by review. {review.valid ? 'Confirm explicitly to create this batch.' : 'Correct every invalid row and review again.'}</p></div><div className="excel-import__totals"><span className="excel-import__valid"><CheckCircle2 size={17} /> {valid.length} valid</span><span className="excel-import__invalid"><XCircle size={17} /> {invalid.length} invalid</span></div></div>
      <div className="excel-import__results"><div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details className="excel-import__row" key={row.row}><summary>Row {row.row} · {row.name} <span>Valid</span></summary><p>Registration: {row.registrationNumber}</p></details>) : <p>No valid rows.</p>}</div>
        <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details open className="excel-import__row excel-import__row--invalid" key={row.row}><summary>Row {row.row} · {row.name || '(unnamed)'} <span>{row.errors.length} errors</span></summary><ul>{row.errors.map((text, index) => <li key={index}>{text}</li>)}</ul></details>) : <p>No errors found. Nothing saved until confirmation.</p>}</div></div>
      <button className="admin-button" type="button" disabled={!review.valid || Boolean(pending) || uncertain} onClick={() => run(true)} data-testid="button-confirm-doctor-import">Confirm import of {rows.length} doctors</button>
    </section>}
  </div></AdminLayout>;
}
