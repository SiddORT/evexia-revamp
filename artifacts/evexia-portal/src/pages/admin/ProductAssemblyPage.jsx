import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import ProductPendingBanner from '../../components/admin/ProductPendingBanner.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { getProduct, journaled, listProducts, newKey, pendingProduct, previewAssembly, saveAssembly } from '../../services/productMaster.js';
import { listReference, milli, formatPrice } from '../../services/serverInventory.js';
import '../../mr.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';
import useProductDraftNavigation from '../../hooks/useProductDraftNavigation.js';

const BASE = '/admin/masters/products';
const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const fmt = (n) => `${n / 1000n}.${String(n % 1000n).padStart(3, '0')}`;
const listProductsRef = (_k, params) => listProducts({ query: params.query, status: 'active', offset: params.offset, limit: params.limit });

export default function ProductAssemblyPage() {
  const [, navigate] = useLocation();
  const { date: displayDate } = useAdminDateFormatters();
  const initial = new URLSearchParams(window.location.search).get('product') || '';
  const [product, setProduct] = useState(null);
  const [location, setLocation] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [picked, setPicked] = useState({});
  const [lots, setLots] = useState({ items: [], loading: false, error: '', for: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [tick, setTick] = useState(0);
  const keyRef = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const seq = useRef(0);
  const productSeq = useRef(0);
  const [productLoading, setProductLoading] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; seq.current++; productSeq.current++; }; }, []);
  useEffect(() => { try { setBlocked(Boolean(pendingProduct())); } catch { setBlocked(true); } }, [tick]);
  useEffect(() => {
    if (!initial) return;
    chooseProduct(initial, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  function chooseProduct(id, label) {
    const mine = ++productSeq.current;
    setProduct(id ? { value: id, label, full: null } : null);
    if (!id) { setProductLoading(false); return; }
    setProductLoading(true);
    getProduct(id).then((p) => { if (mine === productSeq.current && mounted.current) { setProduct({ value: p.id, label: p.name, full: p }); setProductLoading(false); } })
      .catch((e) => { if (mine === productSeq.current && mounted.current) { setProduct(null); setProductLoading(false); setMessage(e.message || 'Product could not be loaded.'); } });
  }

  const locId = location?.value || '';
  const loadLots = useCallback(async (id) => {
    const mine = ++seq.current;
    if (!id) { setLots({ items: [], loading: false, error: '', for: '' }); return; }
    setLots((s) => ({ ...s, loading: true, error: '' }));
    try {
      const all = []; let filtered = 0;
      do {
        const d = await listReference('lots', { source_id: id, offset: all.length, limit: 100 });
        if (mine !== seq.current) return;
        all.push(...d.items); filtered = d.filtered;
        if (!d.items.length) break;
      } while (all.length < filtered);
      setLots({ items: all, loading: false, error: '', for: id });
    } catch (e) { if (mine === seq.current) setLots((s) => ({ ...s, loading: false, error: e.message || 'Lots could not be loaded.' })); }
  }, []);
  useEffect(() => { loadLots(locId); }, [locId, loadLots]);

  const full = product?.full;
  const memberIds = new Set((full?.members || []).map((m) => m.allergenId));
  const fresh = lots.for === locId && !lots.loading && !lots.error;
  const listed = new Map(lots.items.map((l) => [l.id, l]));
  const missing = fresh ? Object.values(picked).filter((p) => !listed.has(p.lot.id)) : [];
  const sources = lots.items.filter((l) => (!l.itemKind || l.itemKind === 'allergen') && (!full || memberIds.has(l.productId)));
  const qtyN = /^[1-9]\d{0,6}$/.test(quantity.trim()) ? Number(quantity.trim()) : null;
  const sums = {};
  Object.values(picked).forEach(({ lot: l0, quantity: q }) => { const lot = listed.get(l0.id) || l0; sums[lot.productId] = (sums[lot.productId] || 0n) + (milli(q) ?? 0n); });
  const reset = () => { keyRef.current = null; setReview(null); };
  const clear = (k) => { reset(); setErrors((e) => ({ ...e, [k]: undefined })); };
  const locked = Boolean(busy) || Boolean(review) || blocked;
  const ready = Boolean(full) && !productLoading && fresh && !missing.length;

  function validate() {
    const e = {};
    if (!product) e.product = 'Select an active product.';
    else if (!full || productLoading) e.product = 'Wait for the product recipe to load.';
    if (!fresh) e.lots = 'Wait for current lot balances to load, or refresh them.';
    if (missing.length) e.lots = 'Remove lots that are no longer available at this location before review.';
    if (!location) e.location = 'Select one storage location.';
    if (qtyN === null || qtyN < 1 || qtyN > 1000000) e.quantity = 'Enter a whole number from 1 to 1000000.';
    if (!batchNo.trim() || batchNo.trim().length > 80) e.batchNo = 'Enter a batch number up to 80 characters.';
    if (!validDay(expiryDate)) e.expiryDate = 'Enter a valid expiry date.';
    if (full && qtyN !== null) full.members.forEach((m) => {
      const need = milli(m.quantity) * BigInt(qtyN); const got = sums[m.allergenId] || 0n;
      if (got !== need) e[`m-${m.allergenId}`] = `Allocate exactly ${fmt(need)} ${m.unit}; selected ${fmt(got)}.`;
    });
    const picks = Object.values(picked).map((p) => ({ lot: listed.get(p.lot.id) || p.lot, quantity: p.quantity, gone: fresh && !listed.has(p.lot.id) }));
    if (picks.length && validDay(expiryDate)) {
      const bad = picks.find(({ lot }) => !lot.expiryDate || expiryDate > lot.expiryDate);
      if (bad) e.expiryDate = bad.lot.expiryDate ? 'Output expiry cannot be after any selected source lot expiry.' : 'A source lot with unavailable expiry cannot be assembled.';
    }
    picks.forEach(({ lot, quantity: q, gone }) => {
      if (gone) { e[lot.id] = 'This lot is no longer available. Remove it to continue.'; return; }
      const n = milli(q), a = milli(lot.available);
      if (n === null || n <= 0n) e[lot.id] = 'Enter a positive quantity with up to 3 decimals.';
      else if (a !== null && n > a) e[lot.id] = `Quantity exceeds available ${lot.available}.`;
    });
    return e;
  }
  const body = () => ({ productId: full.id, expected_version: full.version, locationId: locId, quantity: qtyN,
    allocations: Object.values(picked).map(({ lot, quantity: q }) => ({ lotId: lot.id, quantity: q.trim() })), batchNo: batchNo.trim(), expiryDate });

  async function submitReview(ev) {
    ev.preventDefault();
    if (lock.current || locked) return;
    if (!ready) { setErrors(validate()); setMessage('Wait for the recipe and current lot balances before review.'); return; }
    const e = validate(); setErrors(e); setMessage('');
    if (Object.keys(e).length) return;
    lock.current = true; setBusy('preview');
    try {
      const b = body();
      const r = await previewAssembly(b);
      if (mounted.current) setReview({ body: b, assembly: r.assembly, token: r.reviewToken });
    } catch (err) { if (mounted.current) { setMessage(`${err.message || 'The assembly could not be reviewed.'} Your draft is preserved.`); loadLots(locId); } }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  async function confirm() {
    if (lock.current || !review || busy || blocked) return;
    lock.current = true; setBusy('save'); setMessage('');
    const key = keyRef.current || (keyRef.current = newKey());
    try {
      await journaled(key, () => saveAssembly({ ...review.body, idempotencyKey: key, reviewToken: review.token }));
      keyRef.current = null; navigate(BASE);
    } catch (err) {
      if (!mounted.current) return;
      if (err.uncertain) { setBlocked(true); setTick((t) => t + 1); setMessage(`${err.message || 'The save outcome is unknown.'} Check the save outcome before saving again. Your draft is preserved.`); }
      else { keyRef.current = null; setMessage(`${err.message || 'Nothing was assembled.'} Your draft is preserved.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  const err = (k) => errors[k] && <p id={`pa-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
  const leave = useProductDraftNavigation({ dirty: Boolean(product || location || batchNo || expiryDate || Object.keys(picked).length || review), busy: Boolean(busy), uncertain: blocked });
  const a = review?.assembly;
  return <AdminLayout title="Assemble combos"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Product Master / Assemble</p><h1>Assemble combos</h1><p className="admin-page-head__description">Consume allergen lots at one location to create whole combos. Review the exact totals before committing.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => leave(BASE)}><ArrowLeft size={16} /> All products</button></div></div>
    <div className="admin-feedback ms-note" role="note">Assemblies are append-only. Components are consumed atomically; nothing is posted partially. Source batch and expiry stay visible on the combo lot.</div>
    <ProductPendingBanner refreshSignal={tick} onResolved={(r) => { keyRef.current = null; if (r.state === 'committed') { navigate(BASE); return; } setReview(null); setMessage('The earlier assembly was not committed. Your draft is preserved; review it again to save.'); setTick((t) => t + 1); }} />
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    <section className="admin-panel" aria-label="New assembly"><form onSubmit={submitReview} noValidate>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="ms-form-body">
        <div className="ms-fields">
          <div className="ms-field"><label htmlFor="pa-product">Product <span className="mr-form__required">*</span></label>
            <ReferenceSelect id="pa-product" label="Product" kind="products" fetchPage={listProductsRef} value={product?.value || ''} selected={product} placeholder="Select active product" invalid={Boolean(errors.product)}
              onChange={(_v, o) => { reset(); setPicked({}); setErrors({}); chooseProduct(o ? o.value : '', o ? o.label : ''); }} />{err('product')}</div>
          <div className="ms-field"><label htmlFor="pa-location">Storage location <span className="mr-form__required">*</span></label>
            <ReferenceSelect id="pa-location" label="Storage location" kind="locations" fetchPage={listReference} value={locId} selected={location} placeholder="Select location" invalid={Boolean(errors.location)}
              onChange={(_v, o) => { reset(); setPicked({}); setLocation(o ? { value: o.value, label: o.label } : null); clear('location'); }} />{err('location')}</div>
          <div className="ms-field"><label htmlFor="pa-qty">Whole combos <span className="mr-form__required">*</span></label><input id="pa-qty" className="mr-form__control" inputMode="numeric" value={quantity} onChange={(e) => { setQuantity(e.target.value); clear('quantity'); }} aria-invalid={Boolean(errors.quantity)} data-testid="input-assembly-quantity" />{err('quantity')}</div>
          <div className="ms-field"><label htmlFor="pa-batch">Output batch number <span className="mr-form__required">*</span></label><input id="pa-batch" className="mr-form__control" maxLength={80} value={batchNo} onChange={(e) => { setBatchNo(e.target.value); clear('batchNo'); }} aria-invalid={Boolean(errors.batchNo)} data-testid="input-assembly-batch" />{err('batchNo')}</div>
          <div className="ms-field"><label htmlFor="pa-expiry">Output expiry date <span className="mr-form__required">*</span></label><p className="mr-form__hint">Cannot be after any selected source lot expiry. Sources with unavailable expiry cannot be used.</p><input id="pa-expiry" type="date" className="mr-form__control" value={expiryDate} onChange={(e) => { setExpiryDate(e.target.value); clear('expiryDate'); }} aria-invalid={Boolean(errors.expiryDate)} data-testid="input-assembly-expiry" />{err('expiryDate')}</div>
        </div>
        {full && <div><h2 className="ms-section-title">Required components ({full.name}, recipe v{full.version})</h2>
          <ul className="ms-totals">{full.members.map((m) => { const need = qtyN ? milli(m.quantity) * BigInt(qtyN) : null; return <li key={m.allergenId}>{m.name}: needs {need === null ? 'enter combos' : fmt(need)} {m.unit}; selected {fmt(sums[m.allergenId] || 0n)}{errors[`m-${m.allergenId}`] && <span className="mr-form__error" role="alert"> {errors[`m-${m.allergenId}`]}</span>}</li>; })}</ul></div>}
        <fieldset className="ms-products"><legend className="ms-legend">Component lots <span className="mr-form__required">*</span></legend>
          {(locId || product) && <div className="inv-more">
            {product && <button type="button" className="admin-button admin-button--secondary" disabled={productLoading} onClick={() => { reset(); chooseProduct(product.value, product.label); }}>Refresh recipe (keep draft)</button>}
            {locId && <button type="button" className="admin-button admin-button--secondary" disabled={lots.loading} onClick={() => { reset(); loadLots(locId); }}>{lots.loading ? 'Refreshing…' : 'Refresh balances'}</button>}
          </div>}
          {lots.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{lots.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => loadLots(locId)}>Retry</button></div>}
          {!locId || !full ? <div className="admin-empty" role="status"><strong>Select a product and location</strong><p>Allergen lots with stock at that location will be listed. Combo lots cannot be sources.</p></div>
            : lots.loading && !sources.length ? <div className="admin-empty" role="status"><strong>Loading lots…</strong></div>
            : !sources.length && !missing.length ? <div className="admin-empty" role="status"><strong>No component stock here</strong><p>This location holds none of the recipe allergens.</p></div>
            : <div className="admin-table-scroll ms-stock-table" role="region" aria-label="Component lots" tabIndex={0}><table className="admin-table"><thead><tr><th scope="col">Select</th><th scope="col">Allergen / batch</th><th scope="col">Available</th><th scope="col">Quantity to use</th></tr></thead>
              <tbody>{[...missing.map((p) => ({ lot: p.lot, gone: true })), ...sources.map((lot) => ({ lot, gone: false }))].map(({ lot: l, gone }) => { const on = l.id in picked; return <tr key={l.id}>
                <td><input type="checkbox" id={`pa-p-${l.id}`} checked={on} aria-label={`Select ${l.productName} batch ${l.batchNo}`} onChange={() => { clear('lots'); setPicked((p) => { if (l.id in p) { const n = { ...p }; delete n[l.id]; return n; } return { ...p, [l.id]: { lot: l, quantity: '' } }; }); }} data-testid={`checkbox-assembly-lot-${l.id}`} /></td>
                <td><label htmlFor={`pa-p-${l.id}`} className="ms-product__name">{l.productName}</label><span className="stock-sub">Batch {l.batchNo} · {l.receiptNumber || 'No receipt'} · exp {l.expiryDate ? displayDate(l.expiryDate) : 'Unavailable'}</span></td>
                <td className="inv-mono">{gone ? 'Unavailable' : `${l.available} ${l.unit}`}{gone && <span className="mr-form__error"> No longer available at this location</span>}</td>
                <td>{on ? <div className="ms-qty"><label htmlFor={`pa-q-${l.id}`}>Quantity ({l.unit})</label><input id={`pa-q-${l.id}`} className="mr-form__control" inputMode="decimal" autoComplete="off" value={picked[l.id].quantity} onChange={(e) => { const v = e.target.value; reset(); setPicked((p) => (l.id in p ? { ...p, [l.id]: { ...p[l.id], quantity: v } } : p)); setErrors((x) => ({ ...x, [l.id]: undefined })); }} aria-invalid={Boolean(errors[l.id])} data-testid={`input-assembly-qty-${l.id}`} />{err(l.id)}</div> : <span className="mr-form__hint">Select lot first</span>}</td>
              </tr>; })}</tbody></table></div>}
          {err('lots')}
        </fieldset>
      </div></fieldset>
      {a && <div className="ms-form-body" data-testid="panel-assembly-review"><h2 className="ms-section-title">Review before committing</h2>
        <p>{a.quantity} {a.unit} of {a.productName} (recipe v{a.version}) at {a.location.name}. Batch {a.batchNo}, expiry {displayDate(a.expiryDate)}. MRP {formatPrice(a.mrp)}, selling price {formatPrice(a.sellingPrice)}.</p>
        <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Component lot</th><th scope="col">Consumed</th><th scope="col">Before / after</th></tr></thead>
          <tbody>{a.components.map((c) => <tr key={c.lotId}><td>{c.productName}<span className="stock-sub">Batch {c.batchNo} · {c.receiptNumber || 'No receipt'} · exp {c.expiryDate ? displayDate(c.expiryDate) : 'Unavailable'}</span></td><td className="inv-mono">{c.quantity} {c.unit}</td><td className="inv-mono">{c.before} to {c.after}</td></tr>)}</tbody></table></div></div>}
      <div className="ms-footer"><span>{review ? 'Nothing is saved until you confirm.' : 'Reviewed on the server before commit.'}</span><div className="ms-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => leave(BASE)} disabled={busy === 'save'}>Cancel</button>
        {review ? <>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busy) || blocked} onClick={reset}>Back to edit</button>
          <button type="button" className="admin-button" disabled={Boolean(busy) || blocked} onClick={confirm} data-testid="button-confirm-assembly">{busy === 'save' ? 'Assembling…' : 'Confirm and assemble'}</button></>
          : <button type="submit" className="admin-button" disabled={locked || !ready} data-testid="button-review-assembly">{busy === 'preview' ? 'Reviewing…' : 'Review assembly'}</button>}</div></div>
    </form></section>
  </div></AdminLayout>;
}
