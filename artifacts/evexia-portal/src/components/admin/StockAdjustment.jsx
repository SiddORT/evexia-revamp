import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import './stockAdjustment.css';
import { adjustmentChoices, forgetAdjustment, MAX_MILLI, milli, newKey, pendingAdjustment, previewAdjustment, reconcileAdjustment, rememberAdjustment, saveAdjustment } from '../../services/serverInventory.js';

export default function StockAdjustment({ row, correctionOf = null, onClose, onCommitted }) {
  const [choices, setChoices] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tick, setTick] = useState(0);
  const [direction, setDirection] = useState('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lotKey, setLotKey] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [correctionReference, setCorrectionReference] = useState(correctionOf || '');
  const [errors, setErrors] = useState({});
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [pending, setPending] = useState(null);
  const busyRef = useRef(false);
  const keyRef = useRef(null);
  const frozenRef = useRef(null);

  useEffect(() => {
    const c = new AbortController(); let live = true;
    setLoadError('');
    try { const p = pendingAdjustment(); if (live) { setPending(p); keyRef.current = p?.key || null; } } catch (e) { setLoadError(e.message); return undefined; }
    adjustmentChoices(row.productId, c.signal).then((d) => live && setChoices(d)).catch((e) => { if (live && !c.signal.aborted) setLoadError(e.message || 'Adjustment choices could not be loaded.'); });
    return () => { live = false; c.abort(); };
  }, [row.productId, tick]);

  const lots = (choices?.lots || []).filter((l) => direction === 'reduce');
  const lot = lots.find((l) => `${l.lotId}|${l.locationId || ''}` === lotKey);
  function edit(setter) { return (e) => { setter(e.target.value); setReview(null); setError(''); }; }
  function validate() {
    const er = {}; const q = milli(quantity);
    if (q === null || q <= 0n) er.quantity = 'Enter a positive quantity with up to 3 decimals.';
    else if (q > MAX_MILLI) er.quantity = 'Quantity cannot exceed 1000000.';
    else if (direction === 'reduce' && lot && milli(lot.available) !== null && q > milli(lot.available)) er.quantity = `Quantity exceeds available ${lot.available}.`;
    if (!reason.trim()) er.reason = 'A reason is required.';
    if (direction === 'add' && !locationId) er.location = 'Choose an active location.';
    if (direction === 'reduce' && !lot) er.lot = 'Choose the exact lot and location to reduce.';
    if (correctionReference && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correctionReference.trim())) er.correction = 'Enter a valid adjustment reference UUID or leave blank.';
    setErrors(er); return Object.keys(er).length === 0;
  }
  const body = () => direction === 'add'
    ? { productId: row.productId, direction, quantity: quantity.trim(), reason: reason.trim(), locationId, lotId: null, batchNo: batchNo.trim() || null, expiryDate: expiryDate || null, correctionOf: correctionReference.trim() || null }
    : { productId: row.productId, direction, quantity: quantity.trim(), reason: reason.trim(), locationId: lot.locationId || null, lotId: lot.lotId, batchNo: null, expiryDate: null, correctionOf: correctionReference.trim() || null };
  async function doPreview() {
    if (busyRef.current || !validate()) return;
    busyRef.current = true;
    setBusy(true); setError('');
    try { setReview(await previewAdjustment(body())); } catch (e) { setError(e.message || 'Preview failed.'); }
    busyRef.current = false; setBusy(false);
  }
  async function commit() {
    if (!review || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const key = keyRef.current || newKey();
      const frozen = frozenRef.current || { ...body(), reviewToken: review.reviewToken };
      await rememberAdjustment(key); keyRef.current = key; frozenRef.current = frozen; setPending({ key });
      const res = await saveAdjustment({ ...frozen, idempotencyKey: key });
      await forgetAdjustment(key); keyRef.current = null; setPending(null); frozenRef.current = null;
      setDone(res); onCommitted?.(res);
    } catch (e) {
      setError(e.ambiguous ? `${e.message} Do not start another adjustment. Use Check outcome or Retry the same reviewed adjustment.` : (e.message || 'Save failed.'));
      // Even a rejected retry cannot prove that a delayed earlier request did
      // not commit. Only serialized reconciliation may close a sent identity.
    }
    busyRef.current = false; setBusy(false);
  }
  async function check() {
    const key = keyRef.current; if (!key) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const r = await reconcileAdjustment(key);
      if (r.state === 'committed') { await forgetAdjustment(key); keyRef.current = null; setPending(null); frozenRef.current = null; setDone(r.adjustment); onCommitted?.(r.adjustment); }
      else if (r.state === 'not_committed') { await forgetAdjustment(key); keyRef.current = null; setPending(null); frozenRef.current = null; setReview(null); setMessage('The earlier save was not committed and its identity is cancelled. Review the adjustment again before saving.'); }
      else setError('The outcome could not be determined. Try again.');
    } catch (e) { setError(e.message || 'Outcome check failed.'); }
    busyRef.current = false; setBusy(false);
  }
  const close = () => { if (!busyRef.current) onClose(); };
  const a = done;
  return <Dialog className="stock-adjust" eyebrow="Super Admin only" title="Manual adjustment" onClose={close}
    description={<><span className="sa-product">{row.name} {row.concentration}</span><span className="sa-id">Product ID {row.productId}</span><span className="sa-note">Adjustments are append-only and take effect when committed.{correctionOf ? ' This compensates an earlier adjustment.' : ''}</span></>} footer={done ? <button type="button" className="admin-button" onClick={onClose} data-testid="button-adjust-done">Close</button> : <>
      <button type="button" className="admin-button admin-button--secondary" onClick={close} disabled={busy} data-testid="button-adjust-cancel">Cancel</button>
      {pending && <button type="button" className="admin-button admin-button--secondary" onClick={check} disabled={busy} data-testid="button-adjust-check">Check outcome</button>}
      {pending && review ? <button type="button" className="admin-button" onClick={commit} disabled={busy} data-testid="button-adjust-retry">Retry same adjustment</button>
        : review ? <button type="button" className="admin-button" onClick={commit} disabled={busy || Boolean(pending)} data-testid="button-adjust-commit">Commit adjustment</button>
        : <button type="button" className="admin-button" onClick={doPreview} disabled={busy || !choices || Boolean(pending)} data-testid="button-adjust-preview">Review adjustment</button>}</>}>
    <div className="sa-body" role="region" aria-label="Adjustment content" tabIndex={0}>
    {loadError && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{loadError}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-adjust-load-retry">Retry</button></div>}
    {message && <div className="admin-feedback" role="status" data-testid="status-adjust-message">{message}</div>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-adjust-error">{error}</div>}
    {pending && !done && !review && <div className="admin-feedback" role="alert" data-testid="status-adjust-pending"><p>A previous adjustment save has an unconfirmed outcome. Check it before making another.</p></div>}
    {done ? <div className="admin-feedback" role="status" data-testid="status-adjust-done">Adjustment recorded: {a?.id}. {a?.direction === 'add' ? 'Added' : 'Reduced'} {a?.quantity} {a?.unit || row.unit}. Affected lot/location balance now {a?.after}. Corrections require a new compensating adjustment with this reference and a reason.</div>
    : !choices && !loadError ? <div className="admin-empty" role="status"><strong>Loading adjustment choices…</strong></div>
    : choices && <div className="adjust-form">
      <fieldset className="adjust-field sa-direction" disabled={busy || Boolean(pending)}><legend>Direction <em>(required)</em></legend>
        <label className="sa-radio"><input type="radio" name="adj-dir" checked={direction === 'add'} onChange={() => { setDirection('add'); setReview(null); }} data-testid="radio-adjust-add" /> <span>Add</span></label>
        <label className="sa-radio"><input type="radio" name="adj-dir" checked={direction === 'reduce'} onChange={() => { setDirection('reduce'); setReview(null); }} data-testid="radio-adjust-reduce" /> <span>Reduce</span></label></fieldset>
      {direction === 'reduce' ? <label className="adjust-field"><span className="sa-label">Lot and location <em>(required)</em></span>
        <select className="admin-select" value={lotKey} onChange={edit(setLotKey)} disabled={busy || Boolean(pending)} data-testid="select-adjust-lot"><option value="">Choose lot</option>
          {lots.map((l) => <option key={`${l.lotId}|${l.locationId || ''}`} value={`${l.lotId}|${l.locationId || ''}`}>Lot {l.lotId} · {l.source} · {l.batchNo || 'No batch'} · {l.locationId ? l.locationName : 'Unallocated'} · available {l.available}</option>)}</select>
        {errors.lot && <small className="adjust-error">{errors.lot}</small>}</label>
      : <><label className="adjust-field"><span className="sa-label">Location <em>(required)</em></span>
        <select className="admin-select" value={locationId} onChange={edit(setLocationId)} disabled={busy || Boolean(pending)} data-testid="select-adjust-location"><option value="">Choose location</option>
          {choices.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        {errors.location && <small className="adjust-error">{errors.location}</small>}</label>
        <div className="sa-row">
        <label className="adjust-field"><span className="sa-label">Batch number <em>(optional, new lot only)</em></span><input className="admin-input" maxLength={120} value={batchNo} onChange={edit(setBatchNo)} disabled={busy || Boolean(pending)} data-testid="input-adjust-batch" /></label>
        <label className="adjust-field"><span className="sa-label">Expiry date <em>(optional, new lot only)</em></span><input type="date" className="admin-input" value={expiryDate} onChange={edit(setExpiryDate)} disabled={busy || Boolean(pending)} data-testid="input-adjust-expiry" /></label></div></>}
      <label className="adjust-field"><span className="sa-label">Quantity ({choices.product?.unit || row.unit}) <em>(required)</em></span>
        <input className="admin-input" inputMode="decimal" value={quantity} onChange={edit(setQuantity)} disabled={busy || Boolean(pending)} data-testid="input-adjust-quantity" />
        {errors.quantity && <small className="adjust-error" role="alert">{errors.quantity}</small>}</label>
      <label className="adjust-field"><span className="sa-label">Reason <em>(required)</em></span>
        <textarea className="admin-input" rows={3} maxLength={2000} value={reason} onChange={edit(setReason)} disabled={busy || Boolean(pending)} data-testid="input-adjust-reason" />
        {errors.reason && <small className="adjust-error" role="alert">{errors.reason}</small>}</label>
      <label className="adjust-field"><span className="sa-label">Correction of adjustment <em>(optional UUID)</em></span>
        <input className="admin-input sa-mono" placeholder="Leave blank unless correcting an earlier adjustment" value={correctionReference} onChange={edit(setCorrectionReference)} disabled={busy || Boolean(pending)} data-testid="input-adjust-correction" />
        <small className="sa-hint">Use an earlier adjustment reference only for a compensating correction.</small>
        {correctionReference && <small className="sa-reference">Correction reference: {correctionReference}</small>}
        {errors.correction && <small className="adjust-error" role="alert">{errors.correction}</small>}</label>
      {review && <div className="adjust-review" data-testid="section-adjust-review">
        <div><span>Before</span><strong className="inv-mono">{review.adjustment.before}</strong></div>
        <div><span>Change</span><strong className="inv-mono">{review.adjustment.delta}</strong></div>
        <div><span>After</span><strong className="inv-mono">{review.adjustment.after}</strong></div>
        <p className="mr-form__hint">{review.adjustment.scope} at {review.adjustment.locationName || 'Unallocated'}. This is the affected lot/location balance, not total allergen stock. Review, then commit explicitly.</p></div>}
    </div>}
    </div>
  </Dialog>;
}
