import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { reviewHeadquarters, importHeadquarters, sampleHeadquarters, downloadHeadquarterFile, listHeadquarters } from '../../services/serverHeadquarters.js';
import '../../excel-import.css';
import '../../headquarter.css';

export default function HeadquarterImportPage() {
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
        sequence.current++; controller.current?.abort(); busy.current = false; setFile(null); setReview(null);
        setError(''); setMessage(''); setPending(''); setUncertain(false);
        if (picker.current) picker.current.value = '';
      }
    });
    return () => { alive.current = false; sequence.current++; controller.current?.abort(); unsubscribe(); };
  }, []);
  function replaceFile(next) {
    sequence.current++;
    controller.current?.abort();
    busy.current = false;
    setPending('');
    setFile(next);
    setReview(null);
    setError('');
    setMessage('');
    // Replacing bytes must not clear an unresolved commit outcome.
  }
  async function run(operation, format) {
    if (busy.current || getSession().status !== 'authenticated') return;
    if (['review', 'commit'].includes(operation) && (!file || uncertain || (operation === 'commit' && !review?.valid))) return;
    busy.current = true;
    const current = ++sequence.current;
    const guard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current;
    setPending(operation); setError(''); setMessage('');
    controller.current = new AbortController();
    const digest = review?.digest;
    if (operation === 'commit' || operation === 'review') setReview(null);
    try {
      if (operation === 'sample') {
        const blob = await sampleHeadquarters(format, controller.current.signal);
        guard();
        if (active()) downloadHeadquarterFile(blob, format, true);
      } else if (operation === 'reconcile') {
        // A successful authenticated read is mandatory before allowing a fresh
        // review after a lost commit response; never replay the original commit.
        const result = await listHeadquarters({ query: '', status: 'all', limit: 10, offset: 0 }, controller.current.signal);
        guard();
        if (active()) { setUncertain(false); setReview(null); setMessage(`Server has ${result.total} non-deleted headquarters. Inspect the list and compare it with your file before reviewing again. Duplicate names will be rejected.`); }
      } else if (operation === 'review') {
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        const result = await reviewHeadquarters(file);
        guard();
        if (active()) setReview({ ...result, filename: file.name });
      } else {
        const result = await importHeadquarters(file, digest);
        guard();
        if (active()) { setMessage(`${result.imported} headquarters imported into shared server records.`); setFile(null); if (picker.current) picker.current.value = ''; }
      }
    } catch (cause) {
      try { guard(); } catch { return; }
      if (active()) { setError(`${cause.message}${operation === 'commit' ? ' Review the file again before confirming another import; inspect shared records first if the save outcome is uncertain.' : ''}`); if (operation === 'commit') { setReview(null); setUncertain(Boolean(cause.ambiguous)); } }
    } finally { if (active()) { busy.current = false; setPending(''); } }
  }
  const valid = review?.rows.filter((row) => !row.errors.length) || [];
  const invalid = review?.rows.filter((row) => row.errors.length) || [];
  function rowValues(row) {
    return <dl><div><dt>HQ Name</dt><dd>{row.name || '—'}</dd></div><div><dt>State Code</dt><dd>{row.state_code || '—'}</dd></div><div><dt>Status</dt><dd>{row.status || '—'}</dd></div></dl>;
  }
  return <AdminLayout title="Import Headquarter Master">
    <div className="excel-import excel-import--headquarter">
    <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/headquarters')}><ArrowLeft size={16} aria-hidden="true" /> Back to Headquarter Master</button>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Headquarter data</h1><p className="admin-page-head__description">Download a sample, choose CSV or Excel and review each row. Review saves nothing; explicit confirmation creates shared server records only, all-or-nothing.</p></div><span className="excel-import__mock">Shared server records</span></div>
    <MasterImportTabs kind="headquarter" />
    <div className="excel-import__steps">
      <section className="excel-import__card" aria-labelledby="excel-sample-title">
        <span className="excel-import__number">01</span>
        <div className="excel-import__icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
        <h2 id="excel-sample-title">Download sample Excel</h2><p>Keep the headers and column order unchanged. UTF-8 CSV and genuine single-sheet .xlsx workbooks are supported.</p>
        <div className="excel-import__columns"><strong>Expected legacy columns</strong><span>HQ Name · State Code · Status</span><strong>Compatible current backup schema (CSV or Excel)</strong><span>HQ Name · State Code · Status · Created By · Created At · Updated By · Updated At</span></div>
        <p>Imported audit values are ignored; new rows belong to the authenticated importer and current server time. Existing names cannot be overwritten.</p>
        <div className="excel-import__sample-actions">
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run('sample', 'csv')}>Download CSV sample</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run('sample', 'xlsx')}><Download size={16} aria-hidden="true" /> Download Excel sample</button>
        </div>
      </section>
      <section className="excel-import__card" aria-labelledby="excel-upload-title" aria-busy={Boolean(pending)}>
        <span className="excel-import__number">02</span>
        <div className="excel-import__icon"><Upload size={23} aria-hidden="true" /></div>
        <h2 id="excel-upload-title">Upload &amp; review</h2><p>Up to 2 MiB and 1,000 rows. All rows must be valid, with unique non-deleted names, including inactive records. No upserts or partial imports.</p>
        <p>Blank codes generate HQ-name abbreviations; supplied codes are preserved and uppercased. State Code is not a geographic state identifier. No .xls, formulas, macros, external links or ID/version/deletion columns.</p>
        <label className="excel-import__picker"><FileSpreadsheet size={19} aria-hidden="true" /><span>{file?.name || 'Choose CSV or Excel file'}</span><input ref={picker} aria-label="Headquarter CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending === 'commit'} onChange={(event) => replaceFile(event.target.files?.[0] || null)} data-testid="input-headquarter-import" /></label>
        <button type="button" className="admin-button" disabled={!file || Boolean(pending) || uncertain} onClick={() => run('review')}>{pending === 'review' ? 'Reviewing…' : pending === 'commit' ? 'Importing…' : 'Upload & review'}</button>
      </section>
    </div>
    {pending && <p role="status">{pending === 'commit' ? 'Importing…' : 'Processing…'}</p>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {message && <div className="admin-feedback" role="status">{message}</div>}
    {uncertain && <div className="admin-feedback admin-feedback--error" role="alert"><p>The import may have saved. Do not retry it until you inspect authoritative records.</p><button className="admin-button" disabled={Boolean(pending)} onClick={() => run('reconcile')}>Refresh authoritative state</button><button className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/headquarters')}>Inspect shared records</button></div>}
    {review && <section className="excel-import__report" aria-labelledby="excel-report-title" aria-live="polite" data-testid="headquarter-excel-report">
      <div className="excel-import__report-head">
        <div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="excel-report-title">{review.filename}</h2><p>{review.valid ? 'All rows valid. Confirm to save.' : 'Nothing can be imported until all errors are corrected.'} No rows have been saved by this review. Incoming audit values are never restored.</p></div>
        <div className="excel-import__totals"><span className="excel-import__valid"><CheckCircle2 size={17} aria-hidden="true" /> {valid.length} valid</span><span className="excel-import__invalid"><XCircle size={17} aria-hidden="true" /> {invalid.length} invalid</span></div>
      </div>
      <div className="excel-import__results">
        <div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details key={row.row} className="excel-import__row"><summary>Row {row.row} · {row.name} <span>Valid</span></summary>{rowValues(row)}</details>) : <p>No valid rows in this upload.</p>}</div>
        <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details key={row.row} open className="excel-import__row excel-import__row--invalid"><summary>Row {row.row} · {row.name || '(unnamed)'} <span>{row.errors.length} error{row.errors.length === 1 ? '' : 's'}</span></summary>{rowValues(row)}<ul>{row.errors.map((problem, index) => <li key={index}>{problem}</li>)}</ul></details>) : <p>No errors found. Confirm explicitly to import this batch.</p>}</div>
      </div>
      <button type="button" className="admin-button" disabled={!review.valid || Boolean(pending)} onClick={() => run('commit')}>Confirm import of {review.rows.length} headquarters</button>
    </section>}
    <p className="admin-page-head__description">Existing local headquarters and drafts remain untouched. This is an explicit create-only import, never automatic migration or historical audit restoration.</p>
    </div>
  </AdminLayout>;
}
