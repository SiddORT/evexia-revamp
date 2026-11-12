import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import InfoDisclosure from '../../components/admin/InfoDisclosure.jsx';
import OpeningPendingBanner from '../../components/admin/OpeningPendingBanner.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import useProductDraftNavigation from '../../hooks/useProductDraftNavigation.js';
import { recordLocalAction } from '../../services/localActivity.js';
import { commitOpening, commitOpeningEdit, getOpening, previewOpeningEdit, journaled, listItemReferences, locationLabel, money, valueMoney, newId, pendingOpening, previewOpening, validQuantity, validRate } from '../../services/openingStock.js';
import { listReference } from '../../services/serverInventory.js';
const openingLocationReferences = (kind, params, signal) => listReference(kind, { ...params, purpose: 'opening_stock' }, signal);
import '../../mr.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';
import '../../openingStock.css';

const BASE = '/admin/masters/opening-stock';
const UNALLOCATED = { value: 'unallocated', label: 'Unallocated (no physical location)' };
const MAX_ROWS = 50;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blankRow = () => ({ rowId: newId(), item: null, quantity: '', unitRate: '', expiryDate: '', location: UNALLOCATED });
const validDay = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v && !v.startsWith('0000');
};

export default function OpeningStockFormPage({ params }) {
  const editId = params?.id;
  const editing = Boolean(editId);
  const [, navigate] = useLocation();
  const { date: displayDate } = useAdminDateFormatters();
  const [draft, setDraft] = useState(() => ({ sourceId: newId(), recordedDate: today(), rows: [blankRow()] }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [tick, setTick] = useState(0);
  const [locationRevision, setLocationRevision] = useState(0);
  const [done, setDone] = useState(false);
  const [original, setOriginal] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loadTick, setLoadTick] = useState(0);
  const initialDraft = useRef(null);
  const keyRef = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!editId) return;
    const controller = new AbortController();
    setOriginal(null); setLoadError('');
    getOpening(editId, controller.signal).then((saved) => {
      if (controller.signal.aborted) return;
      const loaded = { sourceId: saved.sourceId, recordedDate: saved.recordedDate, rows: [{
        rowId: saved.rowId,
        item: { value: `${saved.itemKind}:${saved.itemId}`, label: saved.productName, itemId: saved.itemId, itemKind: saved.itemKind, unit: saved.unit },
        quantity: saved.quantity, unitRate: saved.unitRate, expiryDate: saved.expiryDate || '',
        location: saved.locationId ? { value: saved.locationId, label: saved.location.name } : UNALLOCATED,
      }] };
      initialDraft.current = JSON.stringify(loaded);
      setDraft(loaded); setOriginal(saved);
    }).catch((e) => { if (!controller.signal.aborted) setLoadError(e.message || 'Opening stock could not be loaded.'); });
    return () => controller.abort();
  }, [editId, loadTick]);
  useEffect(() => {
    // The master can change in another tab while this draft remains mounted.
    const refresh = () => { if (document.visibilityState === 'visible') setLocationRevision((r) => r + 1); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => { if (done) navigate(BASE); }, [done, navigate]);
  useEffect(() => {
    const read = () => { try { setBlocked(Boolean(pendingOpening())); } catch { setBlocked(true); } };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('evexia-opening-pending', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('evexia-opening-pending', read); };
  }, [tick]);
  const locked = Boolean(busy) || Boolean(review) || blocked || (editing && !original);
  const reset = () => { keyRef.current = null; setReview(null); };
  const patchRow = (i, p) => { reset(); setDraft((d) => ({ ...d, rows: d.rows.map((r, j) => j === i ? { ...r, ...p } : r) })); setErrors((e) => ({ ...e, [`${i}`]: undefined })); };

  function validate() {
    const e = {};
    if (!validDay(draft.recordedDate)) e.date = 'Enter a valid recorded date.';
    if (!draft.rows.length || draft.rows.length > MAX_ROWS) e.rows = `Enter 1–${MAX_ROWS} manual rows.`;
    draft.rows.forEach((r, i) => {
      const m = [];
      if (!r.item) m.push('Select an allergen or product.');
      else if (!validQuantity(r.quantity, r.item.itemKind)) m.push(r.item.itemKind === 'combo' ? 'Quantity must be a whole number from 1 to 1000000.' : 'Enter a positive quantity up to 1000000; up to six source decimals round half-up to two places, at least 0.01.');
      if (r.unitRate.trim() && !validRate(r.unitRate)) m.push('Unit rate must be a number up to 999999999999.99 with at most 6 decimals (rounded half-up to 2).');
      if (r.expiryDate && !validDay(r.expiryDate)) m.push('Enter a real expiry date or leave blank for unknown.');
      if (m.length) e[i] = m.join(' ');
    });
    return e;
  }
  const body = () => ({ mode: 'manual', recordedDate: draft.recordedDate, rows: draft.rows.map((r) => ({
    sourceId: draft.sourceId, rowId: r.rowId, itemKind: r.item.itemKind, itemId: r.item.itemId,
    quantity: r.quantity.trim(), unitRate: r.unitRate.trim() || '0.00', expiryDate: r.expiryDate || null, locationId: r.location.value === 'unallocated' ? null : r.location.value })) });
  const editBody = () => {
    const b = body();
    const { sourceId: _source, rowId: _row, ...fields } = b.rows[0];
    return { ...fields, recordedDate: b.recordedDate, expectedVersion: original.version || 1 };
  };

  function showFieldErrors(error) {
    const next = {};
    for (const [field, message] of Object.entries(error.fields || {})) {
      const row = /^rows\.(\d+)\.(?:quantity|unitRate|expiryDate|itemId|itemKind|locationId|sourceId|rowId)$/.exec(field);
      if (row && draft.rows[Number(row[1])]) next[row[1]] = message;
      else if (field === 'recordedDate') next.date = message;
      else if (editing) next[0] = message;
      else if (field === 'rows') next.rows = message;
    }
    setErrors((current) => ({ ...current, ...next }));
  }

  async function submitReview(ev) {
    ev.preventDefault();
    if (lock.current || locked) return;
    const e = validate(); setErrors(e); setMessage('');
    if (Object.keys(e).length) return;
    lock.current = true; setBusy('preview');
    try {
      const b = editing ? editBody() : body();
      const r = editing ? await previewOpeningEdit(editId, b) : await previewOpening(b);
      if (mounted.current) setReview({ body: b, rows: editing ? [r.after] : r.rows, before: r.before, effect: r.inventoryEffect, token: r.reviewToken, summary: r.summary });
    } catch (err) {
      if (mounted.current) {
        showFieldErrors(err);
        setMessage(`${err.message || 'The opening stock could not be reviewed.'} Your draft is preserved.`);
      }
    }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  async function confirm() {
    if (lock.current || !review || busy || blocked) return;
    lock.current = true; setBusy('save'); setMessage('');
    const key = keyRef.current || (keyRef.current = newId());
    try {
      const command = { ...review.body, idempotencyKey: key, reviewToken: review.token };
      await journaled(key, () => editing ? commitOpeningEdit(editId, command) : commitOpening(command),
        editing ? { intent: 'edit', recordId: editId } : { intent: 'create' });
      keyRef.current = null; recordLocalAction('opening_stock', editing ? 'edited' : 'created'); setDone(true);
    } catch (err) {
      if (!mounted.current) return;
      showFieldErrors(err);
      if (err.uncertain) { setBlocked(true); setTick((t) => t + 1); setMessage(`${err.message || 'The save outcome is unknown.'} Check the save outcome before saving again. Your draft and identities are preserved.`); }
      else { keyRef.current = null; setMessage(`${err.message || 'Nothing was saved.'} Your draft is preserved.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  const err = (k) => errors[k] && <p id={`os-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
  const dirty = !done && (editing ? Boolean(original && (review || JSON.stringify(draft) !== initialDraft.current)) : (Boolean(review) || draft.rows.length > 1 || draft.recordedDate !== today() || draft.rows.some((r) => r.item || r.quantity || r.unitRate || r.expiryDate || r.location.value !== 'unallocated')));
  const leaveGuard = useProductDraftNavigation({ dirty, busy: Boolean(busy), uncertain: blocked, message: 'Discard this unsaved opening stock entry and leave? Nothing has been committed.' });
  const leave = () => leaveGuard(BASE);
  return <AdminLayout title={editing ? 'Edit opening stock' : 'Add opening stock'}><div className="move-stocks-page opening-stock-form">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Opening Stock / {editing ? 'Edit' : 'New'}</p><h1>{editing ? 'Edit opening stock' : 'Add opening stock'}</h1><p className="admin-page-head__description">{editing ? 'Correct an unused opening with an audited revision. Original values, creator and timestamps remain available.' : 'Record stock that existed before the system. Review the canonical values before committing.'}</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={leave} disabled={busy === 'save'}><ArrowLeft size={16} /> All opening stock</button></div></div>
    <OpeningPendingBanner refreshSignal={tick} onResolved={(r) => {
      const own = r.key === keyRef.current || (editing ? r.intent === 'edit' && r.recordId === editId : r.intent === 'create');
      keyRef.current = null;
      if (own && r.state === 'committed') { setDone(true); return; }
      setReview(null); setMessage(own ? 'The earlier save was not committed. Your draft is preserved; review it again to save.' : 'The other save outcome was checked. Your draft is preserved; review it again.');
      setTick((t) => t + 1);
    }} />
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    {editing && !original && <div className="inv-banner" role={loadError ? 'alert' : 'status'}>{loadError || 'Loading saved opening stock…'}{loadError && <button type="button" className="admin-button" onClick={() => setLoadTick((t) => t + 1)}>Retry loading</button>}</div>}
    <section className="admin-panel opening-stock-form__panel" aria-label={editing ? 'Edit saved opening stock' : 'New opening stock'}><form onSubmit={submitReview} noValidate>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="ms-form-body">
        <div className="ms-fields"><div className="ms-field opening-stock-form__date"><label htmlFor="os-date">Recorded date <span className="mr-form__required">*</span></label>
          <input id="os-date" type="date" className="mr-form__control" value={draft.recordedDate} onChange={(e) => { reset(); setDraft((d) => ({ ...d, recordedDate: e.target.value })); setErrors((x) => ({ ...x, date: undefined })); }} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'os-date-error' : undefined} data-testid="input-opening-date" />{err('date')}</div></div>
        {err('rows')}
        <p className="mr-form__hint" id="os-expiry-help">Expiry is optional; blank means unknown. Allergen stock with unknown expiry, expiry today or a past expiry cannot be moved or used. Expiry is evaluated in Asia/Kolkata. Corrections are blocked after downstream activity, even when the original balance was restored.</p>
        {draft.rows.map((r, i) => <div key={r.rowId} className="opening-stock-form__row" data-testid={`row-opening-${i}`}>
          <div className={`opening-stock-form__controls${draft.rows.length > 1 ? ' opening-stock-form__controls--removable' : ''}`}>
          <div className="ms-field"><label htmlFor={`os-item-${i}`}>Allergen or product <span className="mr-form__required">*</span></label>
            <ReferenceSelect id={`os-item-${i}`} label="Item" kind="items" fetchPage={listItemReferences} value={r.item ? r.item.value : ''} selected={r.item} placeholder="Select item" invalid={Boolean(errors[i])} showResultHint={false} conciseItemLabels
              onChange={(_v, o) => patchRow(i, { item: o ? { value: o.value, label: o.label, itemKind: o.itemKind, itemId: o.itemId, unit: o.unit } : null })} /></div>
          <div className="ms-field"><label htmlFor={`os-qty-${i}`}>Quantity ({r.item?.itemKind === 'combo' ? 'units' : 'ml'}) <span className="mr-form__required">*</span></label><input id={`os-qty-${i}`} className="mr-form__control" inputMode="decimal" autoComplete="off" value={r.quantity} onChange={(e) => patchRow(i, { quantity: e.target.value })} aria-invalid={Boolean(errors[i])} aria-describedby={errors[i] ? `os-${i}-error` : undefined} data-testid={`input-opening-qty-${i}`} /></div>
           <div className="ms-field"><InfoDisclosure id={`os-rate-${r.rowId}-help`} title="Unit rate" text="Entered cost per unit, not MRP or selling price. This can also be a weighted-average cost per unit." testId={`button-opening-rate-info-${i}`}><label htmlFor={`os-rate-${i}`}>Unit rate</label></InfoDisclosure><input id={`os-rate-${i}`} className="mr-form__control" inputMode="decimal" autoComplete="off" value={r.unitRate} onChange={(e) => patchRow(i, { unitRate: e.target.value })} aria-invalid={Boolean(errors[i])} aria-describedby={errors[i] ? `os-${i}-error` : undefined} data-testid={`input-opening-rate-${i}`} /></div>
          <div className="ms-field"><label htmlFor={`os-loc-${i}`}>Storage location</label>
            <ReferenceSelect id={`os-loc-${i}`} label="Storage location" kind="locations" fetchPage={openingLocationReferences} refreshKey={locationRevision} pinned={[UNALLOCATED]} value={r.location.value} selected={r.location} placeholder="Unallocated" showResultHint={false}
              onChange={(_v, o) => patchRow(i, { location: o ? { value: o.value, label: o.label } : UNALLOCATED })} /></div>
          <div className="ms-field"><label htmlFor={`os-expiry-${i}`}>Expiry date</label><input id={`os-expiry-${i}`} type="date" className="mr-form__control" value={r.expiryDate} onChange={(e) => patchRow(i, { expiryDate: e.target.value })} aria-invalid={Boolean(errors[i])} aria-describedby={`os-expiry-help${errors[i] ? ` os-${i}-error` : ''}`} data-testid={`input-opening-expiry-${i}`} /></div>
          {draft.rows.length > 1 && <button type="button" className="admin-button admin-button--secondary opening-stock-form__remove" aria-label={`Remove opening stock row ${i + 1}`} onClick={() => { reset(); setDraft((d) => ({ ...d, rows: d.rows.filter((_x, j) => j !== i) })); }} data-testid={`button-remove-opening-${i}`}><Trash2 size={16} aria-hidden="true" /></button>}
          </div>
          {err(i)}
        </div>)}
        {!editing && <div><button type="button" className="admin-button admin-button--secondary" disabled={draft.rows.length >= MAX_ROWS} onClick={() => { reset(); setDraft((d) => ({ ...d, rows: [...d.rows, blankRow()] })); }} data-testid="button-add-opening-row"><Plus size={16} /> Add item</button></div>}
      </div></fieldset>
      {review && <div className="ms-form-body" data-testid="panel-opening-review"><h2 className="ms-section-title">Review before committing</h2>
        <p>Recorded {displayDate(review.body.recordedDate)}. Values below are canonical as returned by the server.</p>
        {review.before && <><h3>Before correction · revision {review.before.version}</h3>
          <dl className="opening-stock-detail__fields">
            <div><dt>Item / type</dt><dd>{review.before.productName} · {review.before.itemKind}</dd></div>
            <div><dt>Quantity</dt><dd>{review.before.quantity} {review.before.unit}</dd></div>
            <div><dt>Unit rate</dt><dd>{money(review.before.unitRate)}</dd></div>
            <div><dt>Opening value</dt><dd>{valueMoney(review.before.openingValue)}</dd></div>
            <div><dt>Location</dt><dd>{locationLabel(review.before.location)}</dd></div>
            <div><dt>Recorded date</dt><dd>{displayDate(review.before.recordedDate)}</dd></div>
            <div><dt>Expiry</dt><dd>{review.before.expiryDate ? displayDate(review.before.expiryDate) : 'Unknown / unavailable'}</dd></div>
          </dl><h3>After correction</h3><p>{review.effect}</p></>}
        <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Item</th><th scope="col">Quantity (ml)</th><th scope="col">Unit rate</th><th scope="col">Opening value</th><th scope="col">Location</th><th scope="col">Expiry</th></tr></thead>
          <tbody>{review.rows.map((r) => <tr key={r.rowId}><td>{r.productName}<span className="stock-sub">{r.itemKind === 'combo' ? 'Product' : 'Allergen'}</span></td><td className="inv-mono">{r.quantity} {r.unit}</td><td className="inv-mono">{money(r.unitRate)}</td><td className="inv-mono">{valueMoney(r.openingValue)}</td><td>{locationLabel(r.location)}</td><td>{r.expiryDate ? displayDate(r.expiryDate) : 'Unknown / unavailable'}</td></tr>)}</tbody></table></div>
        {review.summary && <p className="mr-form__hint">{review.summary.records} record{review.summary.records === 1 ? '' : 's'}. {review.summary.scope}</p>}</div>}
      <div className="ms-footer"><span>{review ? 'Nothing is saved until you confirm.' : 'Reviewed on the server before commit.'}</span><div className="ms-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={leave} disabled={busy === 'save'}>Cancel</button>
        {review ? <>
          <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busy) || blocked} onClick={reset}>Back to edit</button>
          <button type="button" className="admin-button" disabled={Boolean(busy) || blocked} onClick={confirm} data-testid="button-confirm-opening">{busy === 'save' ? 'Saving…' : 'Confirm and save'}</button></>
          : <button type="submit" className="admin-button" disabled={locked} data-testid="button-review-opening">{busy === 'preview' ? 'Reviewing…' : 'Review opening stock'}</button>}</div></div>
    </form></section>
  </div></AdminLayout>;
}
