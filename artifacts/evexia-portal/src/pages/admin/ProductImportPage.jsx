import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Download, FileSpreadsheet, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import ProductPendingBanner from '../../components/admin/ProductPendingBanner.jsx';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import { downloadProductFile, importProducts, journaled, newKey, pendingProduct, reviewProducts, sampleProducts } from '../../services/productMaster.js';
import '../../excel-import.css';

export default function ProductImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [blocked, setBlocked] = useState(true);
  const busy = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const controller = useRef(null);
  const picker = useRef(null);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const sync = () => {
      try { setBlocked(Boolean(pendingProduct())); } catch (cause) { setBlocked(true); setError(cause.message); }
    };
    sync();
    const unsubscribe = subscribeSession(() => {
      // Transient renewal retains the file; another identity cannot inherit it.
      if (getSession().user?.id && getSession().user.id !== owner) {
        sequence.current++; controller.current?.abort(); busy.current = false;
        setFile(null); setReview(null); setError(''); setMessage(''); setPending(''); setBlocked(true);
        if (picker.current) picker.current.value = '';
      }
    });
    window.addEventListener('storage', sync);
    window.addEventListener('evexia-product-pending', sync);
    return () => { alive.current = false; sequence.current++; controller.current?.abort(); unsubscribe(); window.removeEventListener('storage', sync); window.removeEventListener('evexia-product-pending', sync); };
  }, []);
  function replaceFile(next) {
    sequence.current++; controller.current?.abort(); busy.current = false;
    setFile(next); setReview(null); setError(''); setMessage(''); setPending('');
  }
  async function run(operation, format) {
    if (busy.current || getSession().status !== 'authenticated') return;
    if (operation !== 'sample' && (!file || blocked || (operation === 'commit' && !review?.valid))) return;
    busy.current = true;
    const current = ++sequence.current;
    const guard = reportingIdentityGuard();
    const active = () => alive.current && current === sequence.current;
    const digest = review?.digest;
    setPending(operation); setError(''); setMessage('');
    controller.current = new AbortController();
    try {
      if (operation === 'sample') {
        const blob = await sampleProducts(format, controller.current.signal);
        guard(); if (active()) downloadProductFile(blob, format, true);
      } else if (operation === 'review') {
        setReview(null);
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        const result = await reviewProducts(file, controller.current.signal);
        guard(); if (active()) setReview({ ...result, filename: file.name });
      } else {
        const key = newKey();
        const result = await journaled(key, () => importProducts(file, digest, key));
        guard();
        if (active()) {
          setMessage(`${result.imported} products imported with ${result.memberRows} recipe member rows. No stock was created.`);
          setFile(null); setReview(null);
          if (picker.current) picker.current.value = '';
        }
      }
    } catch (cause) {
      try { guard(); } catch { return; }
      if (active()) {
        setError(cause.message);
        if (operation === 'commit') {
          setReview(null);
          try { setBlocked(Boolean(pendingProduct())); } catch { setBlocked(true); }
        }
      }
    } finally { if (active()) { busy.current = false; setPending(''); } }
  }
  function resolved(result) {
    setBlocked(false); setReview(null);
    if (result.state === 'committed' && result.result?.kind === 'product_import') {
      setMessage(`${result.result.imported} products imported with ${result.result.memberRows} recipe member rows.`);
      setFile(null); if (picker.current) picker.current.value = '';
    } else setMessage('Earlier request checked. Review your retained file again before a new confirmation.');
  }
  return <AdminLayout title="Import Product Master"><div className="excel-import">
    <button type="button" className="excel-import__back" disabled={pending === 'commit'} onClick={() => navigate('/admin/masters/products')}><ArrowLeft size={16} aria-hidden="true" /> Back to Product Master</button>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Data import</p><h1>Import Product data</h1><p className="admin-page-head__description">Review catalogue recipes, then explicitly confirm one all-or-nothing create-only import. Review saves nothing.</p></div></div>
    <MasterImportTabs kind="product" />
    <ProductPendingBanner onResolved={resolved} />
    <div className="excel-import__steps">
      <section className="excel-import__card" aria-labelledby="product-sample-title">
        <span className="excel-import__number">01</span><FileSpreadsheet size={23} aria-hidden="true" />
        <h2 id="product-sample-title">Download a recipe sample</h2>
        <p>UTF-8 CSV or genuine single-sheet Excel (.xlsx). One row per member; repeat Product Name, MRP, Selling Price and Status for each member of the same recipe.</p>
        <div className="excel-import__columns"><strong>Sample columns</strong><span>Product Name · MRP · Selling Price · Status · Allergen ID · Allergen Name · Quantity</span><strong>Compatible export</strong><span>The same seven columns plus Recipe Format = EVEXIA recipe v1. Keep that marker to decode portable text escaping.</span></div>
        <p>Replace sample UUIDs with saved active Allergen IDs. Allergen Name is informational, never matched by name. Files transfer only to databases with the same allergen identities; existing product names cause create-only conflicts.</p>
        <div className="excel-import__sample-actions">
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run('sample', 'csv')}>Download CSV sample</button>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={() => run('sample', 'xlsx')}><Download size={16} aria-hidden="true" /> Download Excel sample</button>
        </div>
      </section>
      <section className="excel-import__card" aria-labelledby="product-upload-title" aria-busy={Boolean(pending)}>
        <span className="excel-import__number">02</span><Upload size={23} aria-hidden="true" />
        <h2 id="product-upload-title">Upload &amp; review</h2>
        <p>Up to 2 MiB, 500 products and 1,000 total member rows; 2–100 distinct active allergens per product. Grouping uses whitespace-normalized, case-insensitive product names. Do not combine separate recipes under the same name. Duplicate members and inconsistent repeated fields are rejected.</p>
        <p>MRP and selling price are independent combo-level prices, never component totals. Non-negative prices accept up to 12 integer and 6 fractional digits and save half-up to two places; selling price cannot exceed MRP. Keep exact decimals as text in Excel. Quantities are positive, at most 1,000,000 and exactly representable to three decimal places in procurement quantity units per whole combo, not packs.</p>
        <p>No .xls, formulas, macros, external links, stock, assemblies, lots or uploaded historical activity. Export includes all search/status matches, not just the page, or rejects above 500 products / 1,000 member rows. Shared catalogue scans are bounded to 2,000 products.</p>
        <label className="excel-import__picker"><FileSpreadsheet size={19} aria-hidden="true" /><span>{file?.name || 'Choose CSV or Excel file'}</span><input ref={picker} aria-label="Product recipe CSV or Excel file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending === 'commit' || blocked} onChange={(e) => replaceFile(e.target.files?.[0] || null)} /></label>
        <button type="button" className="admin-button" disabled={!file || Boolean(pending) || blocked} onClick={() => run('review')}>{pending === 'review' ? 'Reviewing…' : 'Upload & review'}</button>
      </section>
    </div>
    {pending && <p role="status">{pending === 'commit' ? 'Importing recipes…' : 'Processing…'}</p>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {message && <div className="admin-feedback" role="status">{message}</div>}
    {review && <section className="excel-import__report" aria-labelledby="product-review-title">
      <div className="excel-import__report-head"><div><h2 id="product-review-title">{review.filename}</h2><p>{review.products} products · {review.memberRows} member rows. {review.valid ? 'All rows valid. Confirm explicitly to save.' : 'Correct every error and review again; nothing has been saved.'}</p></div></div>
      <div className="excel-import__results"><div>
        {review.rows.map((row) => <details key={row.row} className={`excel-import__row${row.errors.length ? ' excel-import__row--invalid' : ''}`}>
          <summary>Row {row.row} · {row.name || '(unnamed)'} · {row.errors.length ? `${row.errors.length} errors` : 'Valid'}</summary>
          <dl>{[['mrp', 'MRP'], ['sellingPrice', 'Selling price'], ['status', 'Status'], ['allergenId', 'Authoritative Allergen ID'], ['allergenName', 'File allergen name (informational)'], ['quantity', 'Required quantity per combo']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{row[key] || '—'}</dd></div>)}</dl>
          {row.errors.length > 0 && <ul>{row.errors.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
        </details>)}
      </div></div>
      <button type="button" className="admin-button" disabled={!review.valid || Boolean(pending) || blocked} onClick={() => run('commit')}>Confirm all-or-nothing import of {review.products} products ({review.memberRows} member rows)</button>
    </section>}
  </div></AdminLayout>;
}
