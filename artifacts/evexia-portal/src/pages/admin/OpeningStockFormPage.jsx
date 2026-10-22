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
import { commitOpening, journaled, listItemReferences, locationLabel, money, valueMoney, newId, pendingOpening, previewOpening, validQuantity, validRate } from '../../services/openingStock.js';
import { listReference } from '../../services/serverInventory.js';
import '../../mr.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';

const BASE = '/admin/masters/opening-stock';
const UNALLOCATED = { value: 'unallocated', label: 'Unallocated (no physical location)' };
const MAX_ROWS = 50;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blankRow = () => ({ rowId: newId(), item: null, quantity: '', unitRate: '', location: UNALLOCATED });
const validDay = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v && !v.startsWith('0000');
};

export default function OpeningStockFormPage() {
  const [, navigate] = useLocation();
  const { date: displayDate } = useAdminDateFormatters();
  const [draft, setDraft] = useState(() => ({ sourceId: newId(), recordedDate: today(), rows: [blankRow()] }));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [tick, setTick] = useState(0);
  const [done, setDone] = useState(false);
  const keyRef = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (done) navigate(BASE); }, [done, navigate]);
  useEffect(() => {
    const read = () => { try { setBlocked(Boolean(pendingOpening())); } catch { setBlocked(true); } };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('evexia-opening-pending', read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener('evexia-opening-pending', read); };
  }, [tick]);
  const locked = Boolean(busy) || Boolean(review) || blocked;
  const reset = () => { keyRef.current = null; setReview(null); };
  const patchRow = (i, p) => { reset(); setDraft((d) => ({ ...d, rows: d.rows.map((r, j) => j === i ? { ...r, ...p } : r) })); setErrors((e) => ({ ...e, [`${i}`]: undefined })); };

  function validate() {
    const e = {};
    if (!validDay(draft.recordedDate)) e.date = 'Enter a valid recorded date.';
    if (!draft.rows.length || draft.rows.length > MAX_ROWS) e.rows = `Enter 1–${MAX_ROWS} manual rows.`;
    draft.rows.forEach((r, i) => {
      const m = [];
      if (!r.item) m.push('Select an allergen or product.');
      else if (!validQuantity(r.quantity, r.item.itemKind)) m.push(r.item.itemKind === 'combo' ? 'Quantity must be a whole number from 1 to 1000000.' : 'Quantity must be positive, up to 1000000 with at most 3 decimals.');
      if (!validRate(r.unitRate)) m.push('Unit rate must be a number up to 999999999999.99 with at most 6 decimals (rounded half-up to 2).');
      if (m.length) e[i] = m.join(' ');
    });
    return e;
  }
  const body = () => ({ mode: 'manual', recordedDate: draft.recordedDate, rows: draft.rows.map((r) => ({
    sourceId: draft.sourceId, rowId: r.rowId, itemKind: r.item.itemKind, itemId: r.item.itemId,
    quantity: r.quantity.trim(), unitRate: r.unitRate.trim(), locationId: r.location.value === 'unallocated' ? null : r.location.value })) });

  function showFieldErrors(error) {
    const next = {};
    for (const [field, message] of Object.entries(error.fields || {})) {
      const row = /^rows\.(\d+)\.(?:quantity|unitRate|itemId|itemKind|locationId|sourceId|rowId)$/.exec(field);
      if (row && draft.rows[Number(row[1])]) next[row[1]] = message;
      else if (field === 'recordedDate') next.date = message;
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
      const b = body(); const r = await previewOpening(b);
      if (mounted.current) setReview({ body: b, rows: r.rows, token: r.reviewToken, summary: r.summary });
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
      await journaled(key, () => commitOpening({ ...review.body, idempotencyKey: key, reviewToken: review.token }));
      keyRef.current = null; recordLocalAction('opening_stock', 'created'); setDone(true);
    } catch (err) {
      if (!mounted.current) return;
      showFieldErrors(err);
      if (err.uncertain) { setBlocked(true); setTick((t) => t + 1); setMessage(`${err.message || 'The save outcome is unknown.'} Check the save outcome before saving again. Your draft and identities are preserved.`); }
      else { keyRef.current = null; setMessage(`${err.message || 'Nothing was saved.'} Your draft is preserved.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  const err = (k) => errors[k] && <p id={`os-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
  const dirty = !done && (Boolean(review) || draft.rows.length > 1 || draft.recordedDate !== today() || draft.rows.some((r) => r.item || r.quantity || r.unitRate || r.location.value !== 'unallocated'));
  const leaveGuard = useProductDraftNavigation({ dirty, busy: Boolean(busy), uncertain: blocked, message: 'Discard this unsaved opening stock entry and leave? Nothing has been committed.' });
  const leave = () => leaveGuard(BASE);
  return <AdminLayout title="Add opening stock"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Opening Stock / New</p><h1>Add opening stock</h1><p className="admin-page-head__description">Record stock that existed before the system. Review the canonical values before committing.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={leave} disabled={busy === 'save'}><ArrowLeft size={16} /> All opening stock</button></div></div>
    <OpeningPendingBanner refreshSignal={tick} onResolved={(r) => { keyRef.current = null; if (r.state === 'committed') { setDone(true); return; } setReview(null); setMessage('The earlier save was not committed. Your draft is preserved; review it again to save.'); setTick((t) => t + 1); }} />
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    <section className="admin-panel" aria-label="New opening stock"><form onSubmit={submitReview} noValidate>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="ms-form-body">
        <div className="ms-fields"><div className="ms-field"><label htmlFor="os-date">Recorded date <span className="mr-form__required">*</span></label>
          <input id="os-date" type="date" className="mr-form__control" value={draft.recordedDate} onChange={(e) => { reset(); setDraft((d) => ({ ...d, recordedDate: e.target.value })); setErrors((x) => ({ ...x, date: undefined })); }} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'os-date-error' : undefined} data-testid="input-opening-date" />{err('date')}</div></div>
        {err('rows')}
        {draft.rows.map((r, i) => <div key={r.rowId} className="ms-fields" data-testid={`row-opening-${i}`} style={{ borderTop: '1px solid var(--admin-border, #ddd)', paddingTop: 12 }}>
          <div className="ms-field"><label htmlFor={`os-item-${i}`}>Allergen or product <span className="mr-form__required">*</span></label>
            <ReferenceSelect id={`os-item-${i}`} label="Item" kind="items" fetchPage={listItemReferences} value={r.item ? r.item.value : ''} selected={r.item} placeholder="Select item" invalid={Boolean(errors[i])} showResultHint={false}
              onChange={(_v, o) => patchRow(i, { item: o ? { value: o.value, label: o.label, itemKind: o.itemKind, itemId: o.itemId, unit: o.unit } : null })} />
            {r.item && <span className="mr-form__hint">{r.item.itemKind === 'combo' ? 'Product, whole units only' : 'Allergen, up to 3 decimals'}{r.item.unit ? ` · ${r.item.unit}` : ''}</span>}</div>
          <div className="ms-field"><label htmlFor={`os-qty-${i}`}>Quantity <span className="mr-form__required">*</span></label><input id={`os-qty-${i}`} className="mr-form__control" inputMode="decimal" autoComplete="off" value={r.quantity} onChange={(e) => patchRow(i, { quantity: e.target.value })} aria-invalid={Boolean(errors[i])} aria-describedby={errors[i] ? `os-${i}-error` : undefined} data-testid={`input-opening-qty-${i}`} /></div>
          <div className="ms-field"><InfoDisclosure id={`os-rate-${r.rowId}-help`} title="Unit rate" text="Entered cost per unit, not MRP or selling price. This can also be a weighted-average cost per unit." testId={`button-opening-rate-info-${i}`}><label htmlFor={`os-rate-${i}`}>Unit rate <span className="mr-form__required">*</span></label></InfoDisclosure><input id={`os-rate-${i}`} className="mr-form__control" inputMode="decimal" autoComplete="off" value={r.unitRate} onChange={(e) => patchRow(i, { unitRate: e.target.value })} aria-invalid={Boolean(errors[i])} aria-describedby={errors[i] ? `os-${i}-error` : undefined} data-testid={`input-opening-rate-${i}`} /></div>
          <div className="ms-field"><label htmlFor={`os-loc-${i}`}>Storage location</label>
            <ReferenceSelect id={`os-loc-${i}`} label="Storage location" kind="locations" fetchPage={listReference} pinned={[UNALLOCATED]} value={r.location.value} selected={r.location} placeholder="Unallocated" showResultHint={false}
              onChange={(_v, o) => patchRow(i, { location: o ? { value: o.value, label: o.label } : UNALLOCATED })} /></div>
          {err(i)}
          {draft.rows.length > 1 && <div><button type="button" className="admin-button admin-button--secondary" onClick={() => { reset(); setDraft((d) => ({ ...d, rows: d.rows.filter((_x, j) => j !== i) })); }} data-testid={`button-remove-opening-${i}`}><Trash2 size={16} /> Remove</button></div>}
        </div>)}
        <div><button type="button" className="admin-button admin-button--secondary" disabled={draft.rows.length >= MAX_ROWS} onClick={() => { reset(); setDraft((d) => ({ ...d, rows: [...d.rows, blankRow()] })); }} data-testid="button-add-opening-row"><Plus size={16} /> Add item</button></div>
      </div></fieldset>
      {review && <div className="ms-form-body" data-testid="panel-opening-review"><h2 className="ms-section-title">Review before committing</h2>
        <p>Recorded {displayDate(review.body.recordedDate)}. Values below are canonical as returned by the server.</p>
        <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">Unit rate</th><th scope="col">Opening value</th><th scope="col">Location</th></tr></thead>
          <tbody>{review.rows.map((r) => <tr key={r.rowId}><td>{r.productName}<span className="stock-sub">{r.itemKind === 'combo' ? 'Product' : 'Allergen'}</span></td><td className="inv-mono">{r.quantity} {r.unit}</td><td className="inv-mono">{money(r.unitRate)}</td><td className="inv-mono">{valueMoney(r.openingValue)}</td><td>{locationLabel(r.location)}</td></tr>)}</tbody></table></div>
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
