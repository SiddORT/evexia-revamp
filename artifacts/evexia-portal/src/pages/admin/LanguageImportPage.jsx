import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { reviewLanguages, importLanguages, sampleLanguages, downloadLanguageFile } from '../../services/serverLanguages.js';
import '../../excel-import.css';

// In-memory only. Leaving/reopening this route must not make an uncertain
// batch retryable. This is NOT durable reconciliation or proof of non-commit.
let unresolvedImport = null;
subscribeSession(() => {
  const session = getSession();
  if (unresolvedImport && (session.user?.id !== unresolvedImport.owner
      || !['authenticated', 'renewing', 'renewal-error'].includes(session.status))) unresolvedImport = null;
});

export default function LanguageImportPage() {
  const { user } = useAdminSession();
  if (user?.identity_kind !== 'super_admin' || !user.permissions.includes('admin.access')) {
    return <AccessDenied title="Import Language" heading="Language import is not available"
      testId="status-language-import-denied" message="Language Master is restricted to the protected Super Admin." />;
  }
  return <LanguageImportWorkspace key={user.id} />;
}

function LanguageImportWorkspace() {
  const [, navigate] = useLocation();
  const previous = unresolvedImport?.owner === getSession().user?.id ? unresolvedImport : null;
  const [file, setFile] = useState(previous?.file || null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [samplePending, setSamplePending] = useState('');
  const [uncertain, setUncertain] = useState(Boolean(previous));
  const busy = useRef(false);
  const sampleBusy = useRef(false);
  const sequence = useRef(0);
  const picker = useRef(null);
  const report = useRef(null);
  const notice = useRef(null);
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
  useEffect(() => {
    if (review) report.current?.focus();
    else if (error || message || uncertain) notice.current?.focus();
  }, [review, error, message, uncertain]);

  function replaceFile(next) {
    if (busy.current === 'commit' || uncertain) return;
    sequence.current++;
    busy.current = false;
    setPending('');
    setFile(next);
    setReview(null);
    setError('');
    setMessage('');
  }

  async function run(commit, checkOnly = false) {
    if (!file || busy.current || (uncertain && !checkOnly) || getSession().status !== 'authenticated'
        || (commit && (!review?.valid || uncertain))) return;
    const current = ++sequence.current;
    const owner = getSession().user?.id;
    const guard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current && owner && getSession().user?.id === owner;
    const reviewed = review;
    busy.current = commit ? 'commit' : 'review';
    setPending(busy.current);
    setError('');
    setMessage('');
    setReview(null); // Every confirmation attempt consumes its review.
    const attempt = commit ? { owner, file } : null;
    if (commit) {
      // Block reopening this route while the request is in flight too.
      unresolvedImport = attempt;
    }
    try {
      if (commit) {
        const result = await importLanguages(file, reviewed.digest, reviewed.rows.length);
        try { guard(); } catch (cause) { cause.ambiguous = true; throw cause; }
        if (unresolvedImport === attempt) unresolvedImport = null;
        if (!active()) return;
        setMessage(`${result.imported} languages imported into shared server records. Return to Language Master to see the refreshed directory and each language’s create history.`);
        setFile(null);
        setUncertain(false);
        if (picker.current) picker.current.value = '';
      } else {
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        const result = await reviewLanguages(file);
        guard();
        if (!active()) return;
        // A conflict-free read is never proof that a delayed commit failed.
        setReview({ ...result, filename: file.name, checkOnly: uncertain || checkOnly });
        if (checkOnly) setMessage('Read-only conflict check completed. This does not resolve the prior outcome and cannot enable another import.');
      }
    } catch (cause) {
      if (commit && !cause.ambiguous && unresolvedImport === attempt) unresolvedImport = null;
      if (active()) {
        if (commit && cause.ambiguous) setUncertain(true);
        setError(`${cause.message || 'Language import failed.'}${commit && cause.ambiguous ? ' Do not repeat this batch; it may already be saved.' : ''}`);
      }
    } finally {
      if (active()) { busy.current = false; setPending(''); }
    }
  }

  async function sample(format) {
    if (sampleBusy.current || getSession().status !== 'authenticated') return;
    sampleBusy.current = true;
    const owner = getSession().user?.id;
    const identityGuard = reportingIdentityGuard();
    const controller = new AbortController();
    sampleController.current = controller;
    const active = () => alive.current && owner && getSession().user?.id === owner && !controller.signal.aborted;
    setSamplePending(format);
    setError('');
    try {
      const blob = await sampleLanguages(format, controller.signal);
      identityGuard();
      if (!active()) return;
      downloadLanguageFile(blob, format, true);
    } catch (cause) {
      if (active()) setError(`Sample download failed (${format === 'xlsx' ? 'Excel' : 'CSV'}). ${cause.message || 'Retry this download.'}`);
    } finally {
      sampleBusy.current = false;
      if (alive.current) setSamplePending('');
    }
  }

  const valid = review?.rows.filter((row) => !row.errors.length) || [];
  const invalid = review?.rows.filter((row) => row.errors.length) || [];
  return <AdminLayout title="Import Language data">
    <div className="excel-import">
      <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/languages')}><ArrowLeft size={16} aria-hidden="true" /> Back to Language Master</button>
      <div className="admin-page-head">
        <div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Language data</h1>
          <p className="admin-page-head__description">Download a sample, choose CSV or Excel and review each row. Review saves nothing; explicit confirmation creates shared server records only, all-or-nothing.</p>
        </div><span className="excel-import__mock">Shared server records</span>
      </div>
      <MasterImportTabs kind="language" />
      <div className="excel-import__steps">
        <section className="excel-import__card" aria-labelledby="language-sample-title" aria-busy={Boolean(samplePending)}>
          <span className="excel-import__number">01</span>
          <div className="excel-import__icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
          <h2 id="language-sample-title">Download sample</h2>
          <p>UTF-8 CSV and genuine .xlsx workbooks with exactly one worksheet are supported.</p>
          <div className="excel-import__columns"><strong>Only column (exact header)</strong><span>Language name</span></div>
          <p>No status, code, locale, ID, version or attribution columns. Unknown or extra columns are rejected.</p>
          <div className="excel-import__sample-actions">
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(samplePending)} onClick={() => sample('csv')}>Download CSV sample</button>
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(samplePending)} onClick={() => sample('xlsx')}><Download size={16} aria-hidden="true" /> Download Excel sample</button>
          </div>
          {samplePending && <p role="status">Preparing {samplePending === 'xlsx' ? 'Excel' : 'CSV'} sample…</p>}
        </section>
        <section className="excel-import__card" aria-labelledby="language-upload-title" aria-busy={Boolean(pending)}>
          <span className="excel-import__number">02</span>
          <div className="excel-import__icon"><Upload size={23} aria-hidden="true" /></div>
          <h2 id="language-upload-title">Upload &amp; review</h2>
          <p>Up to 2 MiB and 1,000 records. Names must contain 1–200 Unicode characters. Duplicate names within the file or current non-deleted catalogue are rejected using the database’s Unicode lowercase comparison.</p>
          <p>Create-only: no overwrites, partial imports or browser-local data. Formulas, macros, external links, embedded objects and encrypted archives are rejected.</p>
          <label className="excel-import__picker">
            <FileSpreadsheet size={19} aria-hidden="true" /><span>{file ? file.name : 'Choose CSV or Excel file'}</span>
            <input ref={picker} aria-label="Language CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending === 'commit' || uncertain} onChange={(event) => replaceFile(event.target.files?.[0] || null)} data-testid="input-language-import" />
          </label>
          <button type="button" className="admin-button" disabled={Boolean(pending) || !file || uncertain} onClick={() => run(false)}>{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : 'Upload & review'}</button>
        </section>
      </div>
      <p className="admin-page-head__description">Portable CSV and Excel files use the same escaping: prefix names starting with =, +, - or @ with one apostrophe; double a literal leading apostrophe. Import removes exactly that escape. Keep exported cell text unchanged, including its apostrophes. Names are trimmed on review. Exports include every name-search match across all pages, up to 1,000 records; larger selections are rejected, never truncated. A new login requires a fresh review.</p>
      <div ref={notice} tabIndex={-1}>
        {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
        {uncertain && <div className="admin-feedback admin-feedback--error" role="alert">
          <strong>Import outcome is not confirmed. Your selected file is preserved.</strong>
          <p>Do not resubmit this batch, even after navigating away, reloading or signing in again. Inspect Language Master and retained create history, and ask an administrator to establish the committed outcome before any new attempt. No durable retry or cancellation receipt is available. Missing names or a conflict-free review do not prove that a delayed request failed.</p>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run(false, true)}>Check current server conflicts (no writes)</button>
        </div>}
        {message && <div className="admin-feedback" role="status">{message}</div>}
      </div>
      {review && <section ref={report} tabIndex={-1} className="excel-import__report" aria-labelledby="language-report-title" aria-live="polite" data-testid="language-excel-report">
        <div className="excel-import__report-head">
          <div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="language-report-title">{review.filename}</h2>
            <p>{review.checkOnly ? 'Read-only conflict check. Resubmission remains blocked.' : review.valid ? 'All rows valid. Confirm to save.' : 'Correct every error before importing.'} No rows have been saved by this review.</p>
          </div>
          <div className="excel-import__totals"><span className="excel-import__valid"><CheckCircle2 size={17} aria-hidden="true" /> {valid.length} valid</span><span className="excel-import__invalid"><XCircle size={17} aria-hidden="true" /> {invalid.length} invalid</span></div>
        </div>
        <div className="excel-import__results">
          <div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details key={row.row} className="excel-import__row"><summary>Row {row.row} · {row.values.name} <span>Valid</span></summary><dl><div><dt>Language name</dt><dd>{row.values.name}</dd></div></dl></details>) : <p>No valid rows in this upload.</p>}</div>
          <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details key={row.row} open className="excel-import__row excel-import__row--invalid"><summary>Row {row.row} · {row.values.name || '(unnamed)'} <span>{row.errors.length} error{row.errors.length === 1 ? '' : 's'}</span></summary><dl><div><dt>Language name</dt><dd>{row.values.name || '—'}</dd></div></dl><ul>{row.errors.map((text, index) => <li key={index}>{text}</li>)}</ul></details>) : <p>No errors found.</p>}</div>
        </div>
        <button type="button" className="admin-button" disabled={Boolean(pending) || !review.valid || uncertain || review.checkOnly} onClick={() => run(true)} data-testid="button-confirm-language-import">Confirm import of {review.rows.length} languages</button>
      </section>}
    </div>
  </AdminLayout>;
}
