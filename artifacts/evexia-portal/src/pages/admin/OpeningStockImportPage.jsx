import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Download } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import OpeningPendingBanner from '../../components/admin/OpeningPendingBanner.jsx';
import useProductDraftNavigation from '../../hooks/useProductDraftNavigation.js';
import { recordLocalAction } from '../../services/localActivity.js';
import { listReference } from '../../services/serverInventory.js';
import { commitOpening, downloadSample, journaled, listItemReferences, money, newId, pendingOpening, reviewImport, valueMoney } from '../../services/openingStock.js';
import { downloadServerBlob } from '../../services/downloads.js';
import '../../mr.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';
import '../../openingStock.css';

const BASE = '/admin/masters/opening-stock';
async function loadAll(fetchPage, kind) {
  const all = []; let filtered = 0;
  do {
    const d = await fetchPage(kind, { offset: all.length, limit: 100 });
    all.push(...d.items); filtered = d.filtered;
    if (!d.items.length) break;
  } while (all.length < filtered);
  return all;
}

/** Real paged, searchable active locations so spreadsheet cells can use the exact UUID. */
function LocationGuide() {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ items: [], filtered: 0, loading: true, error: '' });
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState('');
  const seq = useRef(0);
  function run(offset, replace) {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '', items: replace ? [] : s.items }));
    listReference('locations', { query: query.trim(), offset, limit: 25 }).then((d) => {
      if (mine === seq.current) setState((s) => ({ items: replace ? d.items : [...s.items, ...d.items], filtered: d.filtered, loading: false, error: '' }));
    }).catch((e) => { if (mine === seq.current) setState((s) => ({ ...s, loading: false, error: e.message || 'Locations could not be loaded.' })); });
  }
  useEffect(() => { const t = setTimeout(() => run(0, true), query ? 250 : 0); return () => { clearTimeout(t); seq.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tick]);
  async function copy(text, id) {
    try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setCopied(''); }
  }
  return <section aria-label="Storage location guide" data-testid="panel-location-guide"><h2 className="ms-section-title">Storage location guide</h2>
    <p className="mr-form__hint">Paste the location UUID into the location cell. Leave it blank for Unallocated. Only active locations are listed.</p>
    <div className="ms-field"><label htmlFor="os-loc-guide-search">Search locations</label><input id="os-loc-guide-search" type="search" className="mr-form__control" maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="input-location-guide-search" /></div>
    {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
    <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Location</th><th scope="col">UUID</th><th scope="col">Copy</th></tr></thead>
      <tbody>{state.items.map((l) => <tr key={l.id}><td>{l.name}</td><td className="inv-mono">{l.id}</td>
        <td><button type="button" className="admin-button admin-button--secondary" onClick={() => copy(l.id, l.id)} data-testid={`button-copy-location-${l.id}`}>{copied === l.id ? 'Copied' : 'Copy UUID'}</button></td></tr>)}
        {!state.loading && !state.items.length && !state.error && <tr><td colSpan={3}>No active locations match.</td></tr>}</tbody></table></div>
    <div className="inv-more" aria-live="polite">{state.loading && <span>Loading locations…</span>}
      {!state.loading && state.filtered > 0 && <span>Showing {state.items.length} of {state.filtered}.</span>}
      {!state.loading && state.items.length < state.filtered && <button type="button" className="admin-button admin-button--secondary" onClick={() => run(state.items.length, false)}>Load more</button>}</div>
  </section>;
}

const STATE_LABEL = { ready: 'Ready', skipped: 'Skipped (untouched)', already_imported: 'Already imported' };

export default function OpeningStockImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [tick, setTick] = useState(0);
  const keyRef = useRef(null);
  const lock = useRef(false);
  const input = useRef(null);
  const [names, setNames] = useState({ items: new Map(), locations: new Map(), error: '' });
  const [result, setResult] = useState(null);
  useEffect(() => {
    const read = () => { try { setBlocked(Boolean(pendingOpening())); } catch { setBlocked(true); } };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('evexia-opening-pending', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('evexia-opening-pending', read); };
  }, []);
  const dirty = Boolean(file || review) && !result;
  const leaveGuard = useProductDraftNavigation({ dirty, busy: Boolean(busy), uncertain: blocked, message: 'Discard this selected file and review and leave? Nothing has been committed.' });

  async function sample(format) {
    setBusy(`sample-${format}`); setMessage('');
    try { const blob = await downloadSample(format); downloadServerBlob(blob, `opening-stock-sample.${format}`); setMessage(`Sample ${format.toUpperCase()} prepared. Use Storage Location ids or names from Storage Location Master; leave location blank for Unallocated.`); }
    catch (e) { setMessage(e.message || 'The sample could not be prepared.'); }
    finally { setBusy(''); }
  }
  async function doReview() {
    if (!file || lock.current || blocked) return;
    lock.current = true; setBusy('review'); setMessage(''); keyRef.current = null;
    try {
      const r = await reviewImport(file); setReview(r); setResult(null);
      try {
        const [items, locs] = await Promise.all([loadAll(listItemReferences, 'items'), loadAll(listReference, 'locations')]);
        setNames({ items: new Map(items.map((i) => [`${i.itemKind}:${i.id}`, i])), locations: new Map(locs.map((l) => [l.id, l.name])), error: '' });
      } catch (e) { setNames({ items: new Map(), locations: new Map(), error: 'Readable item and location names could not be loaded; identifiers are shown instead.' }); }
    }
    catch (e) { setReview(null); setMessage(`${e.message || 'The file could not be reviewed.'} The selected file is kept.`); }
    finally { lock.current = false; setBusy(''); }
  }
  async function commit() {
    if (!review || !review.command || !review.reviewToken || lock.current || blocked || !review.valid) return;
    lock.current = true; setBusy('commit'); setMessage('');
    const key = keyRef.current || (keyRef.current = newId());
    try {
      const done = await journaled(key, () => commitOpening({ ...review.command, idempotencyKey: key, reviewToken: review.reviewToken }));
      keyRef.current = null; setResult({ posted: done.postedCount, already: done.alreadyImportedCount, records: done.records?.length ?? 0 });
      if (done.postedCount > 0) recordLocalAction('opening_stock', 'imported');
      setFile(null); setReview(null); if (input.current) input.current.value = '';
    } catch (e) {
      if (e.uncertain) { setBlocked(true); setTick((t) => t + 1); setMessage(`${e.message || 'The import outcome is unknown.'} Check the save outcome before importing again. The file and review are kept.`); }
      else { keyRef.current = null; setMessage(`${e.message || 'Nothing was imported.'} The file and review are kept.`); }
    } finally { lock.current = false; setBusy(''); }
  }
  return <AdminLayout title="Import opening stock"><div className="move-stocks-page opening-stock-import">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Import</p><h1>Import opening stock</h1><p className="admin-page-head__description">Download the sample catalogue, fill quantity, unit rate and optional location for the rows you need, then review before committing.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => leaveGuard(BASE)}><ArrowLeft size={16} /> All opening stock</button></div></div>
    <MasterImportTabs kind="opening-stock" />
    <OpeningPendingBanner refreshSignal={tick} onResolved={(r) => { keyRef.current = null; setBlocked(false); if (r.state === 'committed') { recordLocalAction('opening_stock', 'imported'); setFile(null); setReview(null); setResult({ posted: r.result?.postedCount ?? 0, already: r.result?.alreadyImportedCount ?? 0, records: r.result?.records?.length ?? 0 }); return; } setMessage('The earlier import was not committed. Your file and review are kept.'); setTick((t) => t + 1); }} />
    {message && <div className="admin-feedback" role="status" data-testid="text-opening-import-message">{message}</div>}
    <section className="admin-panel" aria-label="Opening stock import"><div className="ms-form-body">
      <div className="ms-head-actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busy)} onClick={() => sample('csv')} data-testid="button-sample-csv"><Download size={16} /> Sample CSV</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busy)} onClick={() => sample('xlsx')} data-testid="button-sample-xlsx"><Download size={16} /> Sample XLSX</button>
      </div>
      <p className="mr-form__hint">Untouched catalogue rows are skipped. Partially filled rows show errors. A quantity of zero creates no posting. Rows already imported, including rows from an export, are not posted again.</p>
      <div className="ms-field"><label htmlFor="os-file">Filled file (CSV or XLSX)</label>
        <input id="os-file" ref={input} type="file" className="mr-form__control" accept=".csv,.xlsx" disabled={Boolean(busy)} onChange={(e) => { setFile(e.target.files?.[0] || null); setReview(null); keyRef.current = null; }} data-testid="input-opening-file" /></div>
      <div><button type="button" className="admin-button" disabled={!file || Boolean(busy) || blocked} onClick={doReview} data-testid="button-review-import">{busy === 'review' ? 'Reviewing…' : 'Review file'}</button></div>
      {review && <div data-testid="panel-import-review"><h2 className="ms-section-title">Review</h2>
        <p>{review.validCount} ready, {review.skippedCount} skipped, {review.alreadyImportedCount} already imported, {review.invalidCount} with errors.</p>
        {review.alreadyImportedCount > 0 && <div className="admin-feedback" role="status" data-testid="text-already-imported">{review.alreadyImportedCount} row{review.alreadyImportedCount === 1 ? ' is' : 's are'} already imported and will not be posted again. Confirming records only the rows that are new{review.validCount === 0 ? '; with none new, confirming reconciles without writing any stock' : ''}.</div>}
        {names.error && <p className="mr-form__hint" role="status">{names.error}</p>}
        {review.summary && <><p className="mr-form__hint">{review.summary.records} record{review.summary.records === 1 ? '' : 's'} would be created. {review.summary.scope}</p>
          <div className="inv-scroll"><table className="inv-lines"><caption>Reviewed quantity and opening value by item, unit and original location</caption><thead><tr><th scope="col">Item</th><th scope="col">Location</th><th scope="col">Quantity</th><th scope="col">Opening value</th></tr></thead>
            <tbody>{review.summary.breakdown.map((b) => <tr key={`${b.itemKind}:${b.itemId}:${b.locationId || 'u'}`}><td>{b.productName}</td><td>{b.locationName}</td><td>{b.quantity} {b.unit}</td><td>{valueMoney(b.openingValue)}</td></tr>)}</tbody></table></div></>}
        <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Row</th><th scope="col">State</th><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Unit rate</th><th scope="col">Location</th><th scope="col">Errors</th></tr></thead>
          <tbody>{review.rows.map((r) => <tr key={r.row}><td>{r.row}</td><td>{r.errors?.length ? 'Error' : STATE_LABEL[r.state] || r.state}</td>
            <td>{r.values ? (names.items.get(`${r.values.itemKind}:${r.values.itemId}`)?.name || `${r.values.itemKind === 'combo' ? 'Product' : 'Allergen'} ${r.values.itemId}`) : ''}{r.values && <span className="stock-sub">{r.values.itemKind === 'combo' ? 'Product' : 'Allergen'}{names.items.get(`${r.values.itemKind}:${r.values.itemId}`)?.unit ? ` · ${names.items.get(`${r.values.itemKind}:${r.values.itemId}`).unit}` : ''}</span>}</td><td className="inv-mono">{r.values?.quantity ?? ''}</td><td className="inv-mono">{r.values?.unitRate != null ? money(r.values.unitRate) : ''}</td><td>{r.values ? (r.values.locationId ? (names.locations.get(r.values.locationId) || r.values.locationId) : 'Unallocated') : ''}</td>
            <td>{r.errors?.length ? <span className="mr-form__error" role="alert">{r.errors.join(' ')}</span> : ''}</td></tr>)}</tbody></table></div>
        {!review.valid && <p className="mr-form__error" role="alert">Fix the marked rows in your file and review again. Nothing can be committed until every filled row is valid.</p>}
        <div className="ms-head-actions"><button type="button" className="admin-button" disabled={!review.valid || !review.command || !review.reviewToken || Boolean(busy) || blocked} onClick={commit} data-testid="button-commit-import">{busy === 'commit' ? 'Importing…' : review.validCount === 0 ? 'Confirm and reconcile' : 'Confirm and import'}</button></div>
        {!review.command && <p className="mr-form__hint" role="status">Every row is untouched, so there is nothing to commit. Fill quantity and unit rate for the rows you need.</p>}
      </div>}
    </div></section>
    {result && <div className="admin-feedback" role="status" data-testid="panel-import-result">Import finished: {result.posted} new record{result.posted === 1 ? '' : 's'} posted, {result.already} already imported and not posted again. <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)}>View opening stock</button></div>}
    <section className="admin-panel"><div className="ms-form-body"><LocationGuide /></div></section>
  </div></AdminLayout>;
}
