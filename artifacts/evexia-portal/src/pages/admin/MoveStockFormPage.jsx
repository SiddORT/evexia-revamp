import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { forgetMove, listReference, milli, newKey, pendingMove, previewMovement, reconcileMovement, rememberMove, saveMovement, sumMilli, validateLines } from '../../services/serverInventory.js';
import '../../mr.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';

const BASE = '/admin/inventory/move-stocks';
const OTHER = '__other';
const OTHER_OPTION = [{ value: OTHER, label: 'Other (enter a name)' }];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const validDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const MAX_LOTS = 100;

export default function MoveStockFormPage() {
  const [, navigate] = useLocation();
  const { date: displayDate } = useAdminDateFormatters();
  const lock = useRef(false);
  const lotSeq = useRef(0);
  const keyRef = useRef(null);
  const mounted = useRef(true);
  const [source, setSource] = useState(null);
  const [destination, setDestination] = useState(null);
  const [date, setDate] = useState(today);
  const [by, setBy] = useState(null);
  const [otherName, setOtherName] = useState('');
  // Selected lots keep their own metadata and exact typed quantity, independent of the refreshed list.
  const [picked, setPicked] = useState({});
  const [lots, setLots] = useState({ items: [], loading: false, error: '', loadedFor: '' });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [uncertainKey, setUncertainKey] = useState(null);
  const sourceId = source?.value || '';

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lotSeq.current++; }; }, []);

  const loadLots = useCallback(async (id) => {
    const mine = ++lotSeq.current;
    if (!id) { setLots({ items: [], loading: false, error: '', loadedFor: '' }); return; }
    setLots((s) => ({ ...s, loading: true, error: '' }));
    try {
      const all = []; let filtered = 0;
      do {
        const d = await listReference('lots', id === 'unallocated' ? { unallocated: true, offset: all.length, limit: 100 } : { source_id: id, offset: all.length, limit: 100 });
        if (mine !== lotSeq.current) return;
        all.push(...d.items); filtered = d.filtered;
        if (!d.items.length) break;
      } while (all.length < filtered);
      setLots({ items: all, loading: false, error: '', loadedFor: id });
    } catch (e) { if (mine === lotSeq.current) setLots((s) => ({ ...s, loading: false, error: e.message || 'Lots could not be loaded.' })); }
  }, []);
  useEffect(() => { loadLots(sourceId); }, [sourceId, loadLots]);

  /** Returns 'committed' | 'not_committed' | 'error'. Caller owns the lock. */
  async function runReconcile(key) {
    try {
      const r = await reconcileMovement(key);
      await forgetMove(key);
      if (!mounted.current) return r.state === 'committed' ? 'committed' : 'not_committed';
      if (r.state === 'committed') { keyRef.current = null; navigate(BASE); return 'committed'; }
      setUncertainKey(null); keyRef.current = null; setReview(null);
      setMessage('The earlier save was not committed and is now closed. Your draft is preserved; review it again to save.');
      return 'not_committed';
    } catch (e) {
      if (mounted.current) { setUncertainKey(key); setMessage(e.message || 'The earlier save outcome could not be checked.'); }
      return 'error';
    }
  }
  async function explicitReconcile(key) {
    if (lock.current) return;
    lock.current = true; setBusy('reconcile'); setMessage('');
    try { await runReconcile(key); } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  useEffect(() => {
    let key = null;
    try { key = pendingMove()?.key || null; } catch (e) { setMessage(e.message); return; }
    if (key) { setUncertainKey(key); keyRef.current = key; explicitReconcile(key); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickedList = Object.values(picked);
  const listed = new Map(lots.items.map((l) => [l.id, l]));
  const fresh = lots.loadedFor === sourceId && !lots.loading && !lots.error;
  const unavailable = fresh ? pickedList.filter((p) => !listed.has(p.lot.id)) : [];
  // Current balances win when the lot is still listed; otherwise the retained metadata is validated as unavailable.
  const selectedLines = pickedList.map((p) => ({ lot: listed.get(p.lot.id) || p.lot, quantity: p.quantity }));
  const totals = {};
  selectedLines.forEach(({ lot, quantity }) => {
    const k = `${lot.productId}|${lot.unit}`;
    (totals[k] ||= { name: lot.productName, productId: lot.productId, unit: lot.unit, vals: [] }).vals.push(quantity);
  });
  const clear = (k) => setErrors((e) => ({ ...e, [k]: undefined }));
  const locked = Boolean(busy) || Boolean(review) || Boolean(uncertainKey);

  function changeSource(_v, option) {
    setSource(option ? { value: option.value, label: option.label } : null); setPicked({}); setReview(null); setErrors({});
    setLots({ items: [], loading: Boolean(option), error: '', loadedFor: '' });
    if (destination?.value === option?.value) setDestination(null);
  }
  function togglePick(l) {
    clear('lines'); clear(l.id);
    if (!(l.id in picked) && Object.keys(picked).length >= MAX_LOTS) {
      setErrors((e) => ({ ...e, lines: `A movement can include at most ${MAX_LOTS} lots.` }));
      return;
    }
    setPicked((p) => {
      if (l.id in p) { const n = { ...p }; delete n[l.id]; return n; }
      if (Object.keys(p).length >= MAX_LOTS) return p;
      return { ...p, [l.id]: { lot: l, quantity: '' } };
    });
  }
  function validate() {
    const e = {};
    if (!source) e.sourceId = 'Select a source location.';
    if (!destination) e.destinationId = 'Select a destination location.';
    if (!validDay(date)) e.date = 'Enter a valid date.';
    if (!by) e.deliveredBy = 'Select staff or Other.';
    else if (by.value === OTHER && (!otherName.trim() || otherName.trim().length > 120)) e.deliveredBy = 'Enter the delivery name (up to 120 characters).';
    if (!selectedLines.length) e.lines = 'Select at least one lot to move.';
    else if (selectedLines.length > MAX_LOTS) e.lines = `A movement can include at most ${MAX_LOTS} lots.`;
    if (!fresh) e.lines = e.lines || 'Wait for current lot balances to load, or refresh them.';
    unavailable.forEach((p) => { e[p.lot.id] = 'This lot is no longer available at the source. Remove it to continue.'; });
    if (unavailable.length) e.lines = 'Remove lots that are no longer available before review.';
    Object.entries(validateLines(selectedLines).errors).forEach(([k, v]) => { if (!e[k]) e[k] = v; });
    selectedLines.forEach(({ lot, quantity }) => { if (lot.itemKind === 'combo' && !e[lot.id] && !/^[1-9]\d*(?:\.0{1,3})?$/.test(quantity.trim())) e[lot.id] = 'Assembled combos move only as positive whole combos.'; });
    return e;
  }
  const buildBody = () => ({ sourceId: source.value === 'unallocated' ? null : source.value, destinationId: destination.value, date,
    deliveryMode: by.value === OTHER ? 'other' : 'staff', staffId: by.value === OTHER ? null : by.value,
    otherName: by.value === OTHER ? otherName.trim() : null,
    lines: selectedLines.map(({ lot, quantity }) => ({ lotId: lot.id, quantity: quantity.trim() })) });

  async function submitReview(ev) {
    ev.preventDefault();
    if (lock.current || locked) return;
    const e = validate(); setErrors(e); setMessage('');
    if (Object.keys(e).length) return;
    lock.current = true; setBusy('preview');
    try {
      const pending = pendingMove();
      if (pending) {
        setUncertainKey(pending.key); keyRef.current = pending.key;
        if (await runReconcile(pending.key) !== 'not_committed') return;
      }
      const body = buildBody();
      const r = await previewMovement(body);
      if (!mounted.current) return;
      setReview({ body, movement: r.movement, token: r.reviewToken });
    } catch (err) { if (mounted.current) { setMessage(err.message || 'The movement could not be reviewed. Your draft is preserved.'); if (/stock|source|available/i.test(err.message || '')) loadLots(sourceId); } }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  async function confirm() {
    if (lock.current || !review || busy || uncertainKey) return;
    lock.current = true; setBusy('save'); setMessage('');
    const key = keyRef.current || (keyRef.current = newKey());
    let journaled = false;
    try {
      await rememberMove(key); journaled = true;
      await saveMovement({ ...review.body, reviewToken: review.token, idempotencyKey: key });
      try { await forgetMove(key); } catch (cause) {
        if (mounted.current) { setUncertainKey(key); setMessage(`The movement was saved, but its retry identity could not be cleared (${cause.message}). Check the save outcome to finish.`); }
        return;
      }
      keyRef.current = null;
      navigate(BASE);
    } catch (err) {
      if (!mounted.current) return;
      if (journaled) {
        // Sent or journaled: stay pending until /requests reconciliation closes or confirms it.
        setUncertainKey(key);
        setMessage(`${err.message || 'The save outcome is unknown.'} Check the save outcome before saving again. Your draft is preserved.`);
      } else { keyRef.current = null; setMessage(`${err.message || 'Nothing was sent.'} Your draft is preserved.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }

  const err = (k) => errors[k] && <p id={`ms-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
  const UNALLOCATED_SOURCE = [{ value: 'unallocated', label: 'Unallocated (opening stock, no location)' }];
  const staffFetch = (kind, params) => listReference(kind, params);
  const hasUnavailable = unavailable.length > 0;

  return <AdminLayout title="Move stock"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Move stocks / New</p><h1>Move stock</h1><p className="admin-page-head__description">Choose a source, a destination and receipt lots to transfer. Allergen quantities allow up to 3 decimals; assembled combos move only in whole numbers.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} data-testid="button-back-move"><ArrowLeft size={16} /> All movements</button></div></div>
    <div className="admin-feedback ms-note" role="note" data-testid="text-move-guidance">Saved movements are append-only and cannot be edited or deleted. You review the exact result before it is committed.</div>
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    {uncertainKey && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>A previous save has an unchecked outcome. New saves are blocked until it is checked.</p>
      <button type="button" className="admin-button" disabled={Boolean(busy)} onClick={() => explicitReconcile(uncertainKey)}>{busy === 'reconcile' ? 'Checking…' : 'Check save outcome'}</button></div>}
    <section className="admin-panel" aria-label="New stock movement">
      <form onSubmit={submitReview} noValidate>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="ms-form-body">
          <div className="ms-fields">
            <div className="ms-field"><label htmlFor="ms-source">Source location <span className="mr-form__required">*</span></label>
              <ReferenceSelect id="ms-source" label="Source location" kind="locations" fetchPage={staffFetch} pinned={UNALLOCATED_SOURCE} value={sourceId} selected={source} onChange={changeSource} disabled={locked} placeholder="Select source" invalid={Boolean(errors.sourceId)} describedBy={errors.sourceId ? 'ms-sourceId-error' : undefined} />{err('sourceId')}</div>
            <div className="ms-field"><label htmlFor="ms-dest">Destination location <span className="mr-form__required">*</span></label>
              <ReferenceSelect id="ms-dest" label="Destination location" kind="locations" fetchPage={staffFetch} value={destination?.value || ''} selected={destination} exclude={sourceId === 'unallocated' ? '' : sourceId} disabled={locked} onChange={(_v, o) => { setDestination(o ? { value: o.value, label: o.label } : null); clear('destinationId'); }} placeholder="Select destination" invalid={Boolean(errors.destinationId)} describedBy={errors.destinationId ? 'ms-destinationId-error' : undefined} />{err('destinationId')}</div>
            <div className="ms-field"><label htmlFor="ms-date">Date <span className="mr-form__required">*</span></label>
              <input id="ms-date" type="date" className="mr-form__control" value={date} onChange={(e) => { setDate(e.target.value); clear('date'); }} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'ms-date-error' : undefined} data-testid="input-move-date" />{err('date')}</div>
            <div className="ms-field"><label htmlFor="ms-by">Delivered by <span className="mr-form__required">*</span></label>
              <div className="ms-delivery-row">
                <ReferenceSelect id="ms-by" label="Delivered by" kind="staff" fetchPage={staffFetch} pinned={OTHER_OPTION} value={by?.value || ''} selected={by} disabled={locked} onChange={(_v, o) => { setBy(o ? { value: o.value, label: o.label } : null); clear('deliveredBy'); }} placeholder="Select active staff or Other" invalid={Boolean(errors.deliveredBy)} describedBy={errors.deliveredBy ? 'ms-deliveredBy-error' : 'ms-by-hint'} />
                {by?.value === OTHER && <div><input id="ms-other" className="mr-form__control" aria-label="Delivery name" placeholder="Name of person delivering" value={otherName} maxLength={120} onChange={(e) => { setOtherName(e.target.value); clear('deliveredBy'); }} aria-invalid={Boolean(errors.deliveredBy)} data-testid="input-move-delivered-by" /></div>}
              </div>
              {errors.deliveredBy ? err('deliveredBy') : <p id="ms-by-hint" className="mr-form__hint">Recorded delivery name only. It is not proof of who saved the movement; the server records the actor separately.</p>}</div>
          </div>
          <fieldset className="ms-products" aria-describedby={errors.lines ? 'ms-lines-error' : undefined}>
            <legend className="ms-legend">Lots to move <span className="mr-form__required">*</span></legend>
            {sourceId && <div className="inv-more"><button type="button" className="admin-button admin-button--secondary" disabled={lots.loading} onClick={() => loadLots(sourceId)} data-testid="button-refresh-lots">{lots.loading ? 'Refreshing…' : 'Refresh balances'}</button><span>{pickedList.length} of {MAX_LOTS} lots selected. Selections and typed quantities are kept on refresh.</span></div>}
            {lots.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{lots.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => loadLots(sourceId)}>Retry</button></div>}
            {hasUnavailable && <div className="admin-feedback admin-feedback--error" role="alert">{unavailable.length} selected lot{unavailable.length === 1 ? ' is' : 's are'} no longer available at this source. Remove {unavailable.length === 1 ? 'it' : 'them'} to continue.</div>}
            {!sourceId ? <div className="admin-empty" role="status"><strong>Select a source location</strong><p>Available receipt, opening and assembly lots at that source will be listed. Select Unallocated to allocate opening stock.</p></div>
              : lots.loading && !lots.items.length && !pickedList.length ? <div className="admin-empty" role="status"><strong>Loading lots…</strong></div>
              : !lots.items.length && !pickedList.length && !lots.error ? <div className="admin-empty" role="status" data-testid="text-move-empty-source"><strong>No stock at this source</strong><p>Choose another source that holds stock, or confirm inventory is initialized.</p></div>
              : <div className="admin-table-scroll ms-stock-table" role="region" aria-label="Source lots" tabIndex={0} aria-busy={lots.loading}><table className="admin-table"><thead><tr><th scope="col">Select</th><th scope="col">Product / batch</th><th scope="col">Available (unit)</th><th scope="col">Quantity to move</th></tr></thead><tbody>{[...unavailable.map((p) => ({ lot: p.lot, gone: true })), ...lots.items.map((lot) => ({ lot, gone: false }))].map(({ lot: l, gone }) => { const on = l.id in picked; return <tr key={l.id}>
                <td><input type="checkbox" id={`ms-p-${l.id}`} checked={on} onChange={() => togglePick(l)} aria-label={`Select ${l.name}`} data-testid={`checkbox-move-lot-${l.id}`} /></td>
                <td><label htmlFor={`ms-p-${l.id}`} className="ms-product__name">{l.productName}</label><span className="stock-sub">{l.itemKind === 'combo' ? 'Assembled combo, whole combos only · ' : ''}{l.batchNo ? `Batch ${l.batchNo}` : 'Batch unavailable'} · {l.receiptNumber || (l.itemKind === 'combo' ? 'Assembled' : 'Receipt unavailable')} · exp {l.expiryDate ? displayDate(l.expiryDate) : 'unavailable'}{l.itemKind === 'combo' ? ` · assembly ${l.assemblyId || 'link unavailable'}${l.recipe ? ` · recipe v${l.recipe.version}` : ''}${l.mrp != null ? ` · MRP ${l.mrp}, selling ${l.sellingPrice}` : ''}` : ''}</span>{gone && <span className="mr-form__error">No longer available at this source</span>}</td>
                <td className="inv-mono" data-testid={`text-move-available-${l.id}`}>{gone ? 'Unavailable' : `${l.available} ${l.unit}`}</td>
                <td>{on ? <div className="ms-qty"><label htmlFor={`ms-q-${l.id}`}>Quantity ({l.unit}{l.itemKind === 'combo' ? ', whole number' : ''})</label>
                  <input id={`ms-q-${l.id}`} className="mr-form__control" type="text" inputMode={l.itemKind === 'combo' ? 'numeric' : 'decimal'} autoComplete="off" value={picked[l.id].quantity} onChange={(e) => { const v = e.target.value; setPicked((p) => (l.id in p ? { ...p, [l.id]: { ...p[l.id], quantity: v } } : p)); clear(l.id); clear('lines'); }} aria-invalid={Boolean(errors[l.id])} aria-describedby={errors[l.id] ? `ms-q-${l.id}-error` : undefined} data-testid={`input-move-qty-${l.id}`} />
                  {errors[l.id] && <p id={`ms-q-${l.id}-error`} className="mr-form__error" role="alert">{errors[l.id]}</p>}</div> : <span className="mr-form__hint">Select lot first</span>}</td>
              </tr>; })}</tbody></table></div>}
            {errors.lines && <p id="ms-lines-error" className="mr-form__error" role="alert">{errors.lines}</p>}
          </fieldset>
          {selectedLines.length > 0 && <div><h2 className="ms-section-title">Summary: {selectedLines.length} {selectedLines.length === 1 ? 'lot' : 'lots'}</h2>
            <ul className="ms-totals" data-testid="text-move-totals">{Object.entries(totals).map(([k, t]) => <li key={k}>{t.name} <span className="stock-sub">{t.productId}</span>: {t.vals.every((v) => milli(v) !== null) ? sumMilli(t.vals) : 'enter quantities'} {t.unit}</li>)}</ul></div>}
        </div>
        </fieldset>
        {review && <div className="ms-form-body" data-testid="panel-move-review"><h2 className="ms-section-title">Review before saving</h2>
          <p>{review.movement.source?.name || 'Unallocated'} to {review.movement.destination.name} on {displayDate(review.movement.date)}. Delivered by {review.movement.deliveredBy}.</p>
          <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Product / batch</th><th scope="col">Quantity (unit)</th><th scope="col">Source before / after</th><th scope="col">Destination before / after</th></tr></thead>
            <tbody>{review.movement.lines.map((l) => <tr key={l.lotId}><td>{l.productName}<span className="stock-sub">{l.productId} · {l.batchNo} · {l.receiptNumber}</span></td><td className="inv-mono">{l.quantity} {l.unit}</td><td className="inv-mono">{l.sourceBefore} to {l.sourceAfter}</td><td className="inv-mono">{l.destinationBefore} to {l.destinationAfter}</td></tr>)}</tbody></table></div></div>}
        <div className="ms-footer"><span>{review ? 'Nothing is saved until you confirm.' : 'Saves to the server after review.'}</span><div className="ms-head-actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} disabled={busy === 'save'} data-testid="button-cancel-move">Cancel</button>
          {review ? <>
            <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busy) || Boolean(uncertainKey)} onClick={() => setReview(null)}>Back to edit</button>
            <button type="button" className="admin-button" disabled={Boolean(busy) || Boolean(uncertainKey)} onClick={confirm} data-testid="button-save-move">{busy === 'save' ? 'Saving…' : 'Confirm and move stock'}</button></>
            : <button type="submit" className="admin-button" disabled={locked} data-testid="button-save-move">{busy === 'preview' ? 'Reviewing…' : 'Review movement'}</button>}</div></div>
      </form>
    </section>
  </div></AdminLayout>;
}
