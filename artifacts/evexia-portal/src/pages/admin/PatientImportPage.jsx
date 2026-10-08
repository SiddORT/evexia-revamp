import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Download, FileSpreadsheet, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { downloadPatientFile, importPatients, reviewPatients, samplePatients } from '../../services/serverPatients.js';
import '../../excel-import.css';
import '../../patient.css';

export default function PatientImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const sequence = useRef(0);
  const picker = useRef(null);
  const alive = useRef(true);
  const controller = useRef(null);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) {
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
    controller.current = new AbortController();
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
      if (commit) {
        const result = await importPatients(file, digest);
        guard();
        if (!active()) return;
        setMessage(`${result.imported} patients imported. All records saved to the shared server directory.`);
        setFile(null); setUncertain(false);
        if (picker.current) picker.current.value = '';
      } else {
        const result = await reviewPatients(file, controller.current.signal);
        guard();
        if (!active()) return;
        setReview({ ...result, filename: file.name });
        if (uncertain) setMessage('Current duplicates checked without writes. Inspect Patient Master before retrying the earlier batch.');
        setUncertain(false);
      }
    } catch (cause) {
      try { guard(); } catch { return; }
      if (active()) { setUncertain(Boolean(commit && cause.ambiguous)); setError(`${cause.message || 'Import failed.'}${cause.ambiguous ? ' Result uncertain. Inspect Patient Master and review again; do not blindly retry.' : ' Nothing saved by this review. Review again before confirming.'}`); }
    } finally { if (active()) { busy.current = false; setPending(''); } }
  }
  async function sample(format) {
    if (busy.current || getSession().status !== 'authenticated') return;
    busy.current = 'sample'; setPending('sample'); setError('');
    const current = ++sequence.current;
    const guard = reportingIdentityGuard();
    controller.current = new AbortController();
    try {
      const blob = await samplePatients(format, controller.current.signal);
      guard();
      if (alive.current && current === sequence.current) downloadPatientFile(blob, format, true);
    } catch (cause) { try { guard(); } catch { return; } if (alive.current) setError(`Sample download failed. ${cause.message}`); }
    finally { if (alive.current && current === sequence.current) { busy.current = false; setPending(''); } }
  }
  const rows = review?.rows || [];
  const valid = rows.filter((row) => !row.errors.length);
  const invalid = rows.filter((row) => row.errors.length);
  return <AdminLayout title="Import Patient data"><div className="excel-import excel-import--patient">
    <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/patients')}><ArrowLeft size={16} /> Back to Patient Master</button>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Patient data</h1><p className="admin-page-head__description">Review CSV or Excel without saving. Explicit confirmation creates a fully valid batch, all-or-nothing.</p></div><span className="excel-import__mock">Shared server records</span></div>
    <MasterImportTabs kind="patient" />
    <div className="excel-import__steps">
      <section className="excel-import__card" aria-labelledby="patient-sample-title"><span className="excel-import__number">01</span><div className="excel-import__icon"><FileSpreadsheet size={23} /></div><h2 id="patient-sample-title">Download sample</h2>
        <p>Keep the full column order and one worksheet. Use text cells for identifiers, phone numbers, DOB and postcodes.</p>
        <div className="excel-import__columns"><strong>Business columns</strong><span>Patient ID · Patient Name · Gender · Phone No. · Email ID · Date of Birth · Doctor ID · Doctor Registration Number · Instructions Language · Status · Address Line 1 · Address Line 2 · Landmark · Pincode · City · State · Country · Dial Country</span></div>
        <p>Legacy 17-column CSVs default national phone numbers to India. Male/Female/Other values are accepted case-insensitively on import. Blank Patient IDs generate PAT-codes. Doctor Registration Number must uniquely identify a server Doctor; local Doctor IDs are not live references. No relationships are created automatically. Optional readable export/audit columns never restore historical attribution.</p>
        <div className="excel-import__sample-actions"><button className="admin-button admin-button--secondary" type="button" disabled={Boolean(pending)} onClick={() => sample('csv')} data-testid="button-sample-patient-csv">Download CSV sample</button>
          <button className="admin-button admin-button--secondary" type="button" disabled={Boolean(pending)} onClick={() => sample('xlsx')} data-testid="button-sample-patient-xlsx"><Download size={16} /> Download Excel sample</button></div>
      </section>
      <section className="excel-import__card" aria-labelledby="patient-upload-title" aria-busy={Boolean(pending)}><span className="excel-import__number">02</span><div className="excel-import__icon"><Upload size={23} /></div><h2 id="patient-upload-title">Upload &amp; review</h2><p>CSV or genuine .xlsx, up to 2 MiB and 1,000 records. Create-only: every row must be valid; no upserts or partial imports.</p>
        <label className="excel-import__picker"><FileSpreadsheet size={19} /><span>{file ? file.name : 'Choose CSV or Excel file'}</span><input ref={picker} aria-label="Patient CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending === 'commit'} onChange={(event) => replaceFile(event.target.files?.[0] || null)} data-testid="input-patient-import" /></label>
        <button className="admin-button" type="button" disabled={!file || Boolean(pending)} onClick={() => run(false)} data-testid="button-review-patient-import">{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : uncertain ? 'Check current conflicts (no writes)' : 'Upload & review'}</button>
      </section>
    </div>
    {pending === 'sample' && <p role="status">Preparing sample…</p>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {message && <div className="admin-feedback" role="status" data-testid="status-patient-import">{message}</div>}
    {review && <section className="excel-import__report" aria-labelledby="patient-report-title" aria-live="polite" data-testid="patient-excel-report">
      <div className="excel-import__report-head"><div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="patient-report-title">{review.filename}</h2><p>No records saved by review. {review.valid ? 'Confirm explicitly to create this batch.' : 'Correct every invalid row and review again.'}</p></div><div className="excel-import__totals"><span className="excel-import__valid">{valid.length} valid</span><span className="excel-import__invalid">{invalid.length} invalid</span></div></div>
      <div className="excel-import__results"><div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details className="excel-import__row" key={row.row}><summary>Row {row.row} · {row.name} <span>Valid</span></summary><p>Patient ID: {row.code || 'Generated on creation'}</p></details>) : <p>No valid rows.</p>}</div>
        <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details open className="excel-import__row excel-import__row--invalid" key={row.row}><summary>Row {row.row} · {row.name || '(unnamed)'} <span>{row.errors.length} errors</span></summary><ul>{row.errors.map((text, index) => <li key={index}>{text}</li>)}</ul></details>) : <p>No errors found. Nothing saved until confirmation.</p>}</div></div>
      <button className="admin-button" type="button" disabled={!review.valid || Boolean(pending) || uncertain} onClick={() => run(true)} data-testid="button-confirm-patient-import">Confirm import of {rows.length} patients</button>
    </section>}
  </div></AdminLayout>;
}
