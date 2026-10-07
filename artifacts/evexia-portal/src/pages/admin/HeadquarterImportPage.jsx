import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { reviewHeadquarters, importHeadquarters, sampleHeadquarters, downloadHeadquarterFile, listHeadquarters } from '../../services/serverHeadquarters.js';
import '../../excel-import.css';

export default function HeadquarterImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [format, setFormat] = useState('csv');
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
        sequence.current++; controller.current?.abort(); setFile(null); setReview(null);
        setError(''); setMessage(''); setPending(''); setUncertain(false);
        if (picker.current) picker.current.value = '';
      }
    });
    return () => { alive.current = false; sequence.current++; controller.current?.abort(); unsubscribe(); };
  }, []);
  async function run(operation) {
    if (busy.current || getSession().status !== 'authenticated') return;
    if (['review', 'commit'].includes(operation) && (!file || uncertain || (operation === 'commit' && !review?.valid))) return;
    busy.current = true;
    const current = ++sequence.current;
    const guard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current;
    setPending(operation); setError(''); setMessage('');
    controller.current = new AbortController();
    const digest = review?.digest;
    if (operation === 'commit') setReview(null);
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
        if (active()) setReview(result);
      } else {
        const result = await importHeadquarters(file, digest);
        guard();
        if (active()) { setMessage(`${result.imported} headquarters imported into shared server records.`); setFile(null); if (picker.current) picker.current.value = ''; }
      }
    } catch (cause) {
      try { guard(); } catch { return; }
      if (active()) { setError(cause.message); if (operation === 'commit') { setReview(null); setUncertain(Boolean(cause.ambiguous)); } }
    } finally { busy.current = false; if (active()) setPending(''); }
  }
  const invalid = review?.rows.filter((row) => row.errors.length).length || 0;
  return <AdminLayout title="Import Headquarter Master">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Import</p><h1>Import Headquarter Master</h1><p className="admin-page-head__description">CSV or genuine Excel (.xlsx), reviewed on the server before explicit confirmation. Nothing is saved during review.</p></div><button className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/headquarters')}><ArrowLeft size={16} /> Back to headquarters</button></div>
    <MasterImportTabs kind="headquarter" />
    <div className="excel-import__steps">
      <section className="excel-import__card"><h2>Download a sample</h2><p>Exact legacy columns: HQ Name, State Code, Status. Current exports add Created By, Created At, Updated By, Updated At in that order. Imported audit values are ignored; new rows belong to the authenticated importer and current server time.</p>
        <label>Sample format<select className="admin-select" aria-label="Headquarter sample format" value={format} disabled={Boolean(pending)} onChange={(event) => setFormat(event.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></select></label>
        <button className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run('sample')}><Download size={16} /> Download sample</button>
      </section>
      <section className="excel-import__card"><h2>Upload and review</h2><p>Up to 2 MiB and 1,000 rows. Blank codes generate HQ-name abbreviations; supplied codes are preserved and uppercased. No .xls, formulas, macros, external links or ID/version/deletion columns.</p>
        <label className="excel-import__picker"><span>{file?.name || 'Choose CSV or Excel file'}</span><input ref={picker} type="file" accept=".csv,.xlsx" disabled={Boolean(pending)} onChange={(event) => { sequence.current++; setFile(event.target.files?.[0] || null); setReview(null); setError(''); setMessage(''); }} data-testid="input-headquarter-import" /></label>
        <button className="admin-button" disabled={!file || Boolean(pending) || uncertain} onClick={() => run('review')}><Upload size={16} /> Upload &amp; review</button>
      </section>
    </div>
    {pending && <p role="status">{pending === 'commit' ? 'Importing…' : 'Processing…'}</p>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {message && <div className="admin-feedback" role="status">{message}</div>}
    {uncertain && <div className="admin-feedback admin-feedback--error" role="alert"><p>The import may have saved. Do not retry it until you inspect authoritative records.</p><button className="admin-button" disabled={Boolean(pending)} onClick={() => run('reconcile')}>Refresh authoritative state</button><button className="admin-button admin-button--secondary" onClick={() => navigate('/admin/masters/headquarters')}>Inspect shared records</button></div>}
    {review && <section className="admin-panel admin-category-import"><h2>Review rows</h2><p>{review.rows.length - invalid} valid rows, {invalid} with errors. Confirmation creates the whole batch or nothing. Audit values from the file are never restored.</p>
      <div className="admin-category-import__rows" role="list" aria-label="Headquarter import rows">{review.rows.map((row) => <div className={`admin-category-import__row${row.errors.length ? ' admin-category-import__row--error' : ''}`} role="listitem" key={row.row}><details><summary>Row {row.row}: {row.name || '(unnamed)'} — {row.errors.length ? 'Errors' : 'Ready to add'}</summary><dl><div><dt>HQ Name</dt><dd>{row.name}</dd></div><div><dt>State Code</dt><dd>{row.state_code}</dd></div><div><dt>Status</dt><dd>{row.status}</dd></div></dl></details>{row.errors.length > 0 && <ul>{row.errors.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}</div>)}</div>
      <button className="admin-button" disabled={!review.valid || Boolean(pending)} onClick={() => run('commit')}>Confirm import {review.rows.length} headquarters</button>
    </section>}
    <p className="admin-page-head__description">Existing local headquarters and drafts remain untouched. This is an explicit create-only import, never automatic migration or historical audit restoration.</p>
  </AdminLayout>;
}
