import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import AllergenSearchableSelect from '../../components/admin/AllergenSearchableSelect.jsx';
import InHousePendingBanner from '../../components/admin/InHousePendingBanner.jsx';
import InHouseStockDialog, { InHouseFacts } from '../../components/admin/InHouseStockDialog.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { isSuperAdminIdentity } from '../../auth/capabilities.js';
import useProductDraftNavigation from '../../hooks/useProductDraftNavigation.js';
import { commitInHouseStock, journaled, listAllergenReferences, listLocationReferences, newId, PENDING_EVENT, pendingInHouse, previewInHouseStock, RESERVE_NOTE, validDay, validQuantity } from '../../services/inHouseStock.js';
import InHouseAccessDenied from './InHouseAccessDenied.jsx';
import { ALLERGEN_CONCENTRATIONS } from '../../services/allergenConcentrations.js';
import { expiryYearsFromToday } from '../../services/calendarExpiry.js';
import '../../mr.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';
import '../../openingStock.css';
import '../../allergen.css';

const BASE = '/admin/inventory/in-house-stock';
const BLANK = { allergen: null, concentration: '', quantity: '', expiryDate: '', location: null, batch: '', notes: '', actualUnitCost: '', costProvenance: '' };
const FIELD_KEYS = ['allergenId', 'concentration', 'quantity', 'unit', 'expiryDate', 'locationId', 'batch', 'notes', 'actualUnitCost', 'costProvenance'];

export default function InHouseStockFormPage() {
  const { user } = useAdminSession();
  return isSuperAdminIdentity(user) ? <InHouseStockForm /> : <InHouseAccessDenied />;
}

function InHouseStockForm() {
  const [, navigate] = useLocation();
  const { date } = useAdminDateFormatters();
  const [draft, setDraft] = useState(() => ({ ...BLANK, expiryDate: expiryYearsFromToday(5) }));
  const baseline = useRef(draft);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [review, setReview] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [tick, setTick] = useState(0);
  const [saved, setSaved] = useState(null);
  const keyRef = useRef(null);
  const reviewButtonRef = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const read = () => { try { setBlocked(Boolean(pendingInHouse())); } catch { setBlocked(true); } };
    read();
    window.addEventListener('storage', read);
    window.addEventListener(PENDING_EVENT, read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener(PENDING_EVENT, read); };
  }, [tick]);
  const locked = Boolean(busy) || Boolean(review) || blocked || Boolean(saved);
  const reset = () => { keyRef.current = null; setReview(null); };
  const dismissReview = () => { if (!lock.current && busy !== 'save') reset(); };
  const set = (k, v) => { reset(); setDraft((d) => ({ ...d, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); };

  function validate() {
    const e = {};
    const c = draft.concentration.trim();
    if (!draft.allergen) e.allergen = 'Select an active allergen.';
    if (!ALLERGEN_CONCENTRATIONS.includes(c)) e.concentration = 'Select a concentration.';
    if (!validQuantity(draft.quantity)) e.quantity = 'Enter a positive quantity up to 1000000; up to six source decimals round half-up to two places, at least 0.01.';
    if (!validDay(draft.expiryDate)) e.expiryDate = 'Enter a valid expiry date.';
    if (!draft.location) e.location = 'Select a storage location.';
    if (draft.batch.trim().length > 100) e.batch = 'Batch must be 100 characters or fewer.';
    if (draft.actualUnitCost.trim() && !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(draft.actualUnitCost.trim())) e.actualUnitCost = 'Enter a plain decimal: up to 9 whole digits and 6 decimals.';
    const prov = draft.costProvenance.trim();
    if (draft.actualUnitCost.trim() && (prov.length < 3 || prov.length > 1000)) e.costProvenance = 'Describe the cost source in 3 to 1000 characters.';
    else if (!draft.actualUnitCost.trim() && prov) e.costProvenance = 'Enter a unit cost, or clear the cost source.';
    if (draft.notes.length > 2000) e.notes = 'Notes must be 2000 characters or fewer.';
    return e;
  }
  const body = () => ({ allergenId: draft.allergen.value, concentration: draft.concentration.trim(), quantity: draft.quantity.trim(),
    expiryDate: draft.expiryDate, locationId: draft.location.value, batch: draft.batch.trim(), notes: draft.notes.trim(),
    actualUnitCost: draft.actualUnitCost.trim() || null, costProvenance: draft.actualUnitCost.trim() ? draft.costProvenance.trim() : null });
  function showFieldErrors(error) {
    const next = {};
    for (const [f, m] of Object.entries(error?.fields || {})) {
      if (!FIELD_KEYS.includes(f)) continue;
      next[f === 'allergenId' ? 'allergen' : f === 'locationId' ? 'location' : f] = m;
    }
    setErrors((cur) => ({ ...cur, ...next }));
  }
  async function submitReview(ev) {
    ev.preventDefault();
    if (lock.current || locked) return;
    const e = validate(); setErrors(e); setMessage('');
    if (Object.keys(e).length) { document.querySelector('[aria-invalid="true"]')?.focus(); return; }
    lock.current = true; setBusy('preview');
    try {
      const b = body(); const r = await previewInHouseStock(b);
      // Freeze the reviewed body and a single request identity for every retry of this review.
      if (mounted.current) { keyRef.current = newId(); setReview({ body: Object.freeze(b), record: r.record, token: r.reviewToken }); }
    } catch (err) {
      if (mounted.current) { showFieldErrors(err); setMessage(`${err.message || 'The entry could not be reviewed.'} Your draft is preserved.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  async function confirm() {
    if (lock.current || !review || busy || blocked) return;
    lock.current = true; setBusy('save'); setMessage('');
    const key = keyRef.current || (keyRef.current = newId());
    try {
      const result = await journaled(key, () => commitInHouseStock({ ...review.body, reviewToken: review.token, idempotencyKey: key }));
      keyRef.current = null;
      if (mounted.current) { setReview(null); setSaved(result); }
    } catch (err) {
      if (!mounted.current) return;
      showFieldErrors(err);
      if (err.uncertain) { setBlocked(true); setTick((t) => t + 1); setMessage(`${err.message || 'The save outcome is unknown.'} Check the save outcome before saving again. Your draft is preserved.`); }
      else { keyRef.current = null; setReview(null); setMessage(`${err.message || 'Nothing was saved.'} Your draft is preserved; review it again to renew and save.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  const dirty = !saved && (Boolean(review) || Object.keys(baseline.current).some((k) => draft[k] !== baseline.current[k]));
  const leaveGuard = useProductDraftNavigation({ dirty, busy: Boolean(busy), uncertain: blocked, message: 'Discard this unsaved in-house stock entry and leave? Nothing has been committed.' });
  const leave = () => leaveGuard(BASE);
  const resolvePending = (r) => {
    keyRef.current = null; setTick((t) => t + 1);
    if (r.state === 'committed') { setMessage(''); setReview(null); if (r.result?.id) setSaved(r.result); else navigate(BASE); return; }
    setReview(null); setMessage('The earlier save was not committed. Your draft is preserved; review it again to save.');
  };
  const desc = (k) => errors[k] ? `ih-${k}-error` : undefined;
  const err = (k) => errors[k] && <p id={`ih-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
  const text = (k, label, max, extra = {}) => <div className="ms-field"><label htmlFor={`ih-${k}`}>{label}{extra.required && <> <span className="mr-form__required">*</span></>}</label>
    <input id={`ih-${k}`} className="mr-form__control" autoComplete="off" maxLength={max} value={draft[k]} onChange={(e) => set(k, e.target.value)} inputMode={extra.inputMode} required={extra.required}
      aria-invalid={Boolean(errors[k])} aria-describedby={desc(k)} data-testid={`input-in-house-${k}`} />{err(k)}</div>;

  return <AdminLayout title="Add in-house stock"><div className="move-stocks-page opening-stock-form">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / In-house stock / New</p><h1>Add in-house stock</h1><p className="admin-page-head__description">{RESERVE_NOTE} Review the canonical values before committing.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={leave} disabled={busy === 'save'} data-testid="button-back-in-house"><ArrowLeft size={16} /> All in-house stock</button></div></div>
    {!review && <InHousePendingBanner refreshSignal={tick} onResolved={resolvePending} />}
    {!review && message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    <section className="admin-panel in-house-stock-form__panel" aria-label="New in-house stock"><form onSubmit={submitReview} noValidate>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="ms-form-body">
        <div className="ms-fields">
          <div className="ms-field"><label htmlFor="ih-allergen">Allergen <span className="mr-form__required">*</span></label>
            <ReferenceSelect id="ih-allergen" label="Allergen" kind="in-house-allergens" fetchPage={listAllergenReferences} value={draft.allergen?.value || ''} selected={draft.allergen} placeholder="Select active allergen" invalid={Boolean(errors.allergen)} describedBy={desc('allergen')} showResultHint={false}
              onChange={(_v, o) => set('allergen', o ? { value: o.value, label: o.label } : null)} />{err('allergen')}</div>
          <div className="ms-field"><label htmlFor="ih-concentration">Concentration <span className="mr-form__required">*</span></label>
            <AllergenSearchableSelect id="ih-concentration" label="Concentration" value={draft.concentration} disabled={locked} placeholder="Select concentration"
              invalid={Boolean(errors.concentration)} describedBy={desc('concentration')} testId="select-in-house-concentration"
              options={ALLERGEN_CONCENTRATIONS.map((value) => ({ value, label: value }))}
              onChange={(value) => set('concentration', value)} />
            {err('concentration')}</div>
          {text('quantity', 'Quantity (ml)', 12, { required: true, inputMode: 'decimal' })}
          <div className="ms-field"><label htmlFor="ih-expiryDate">Expiry date <span className="mr-form__required">*</span></label>
            <input id="ih-expiryDate" type="date" className="mr-form__control" value={draft.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} required aria-invalid={Boolean(errors.expiryDate)} aria-describedby={desc('expiryDate')} data-testid="input-in-house-expiryDate" />
            {err('expiryDate')}</div>
          <div className="ms-field"><label htmlFor="ih-location">Storage location <span className="mr-form__required">*</span></label>
            <ReferenceSelect id="ih-location" label="Storage location" kind="in-house-locations" fetchPage={listLocationReferences} value={draft.location?.value || ''} selected={draft.location} placeholder="Select location" invalid={Boolean(errors.location)} describedBy={desc('location')} showResultHint={false}
              onChange={(_v, o) => set('location', o ? { value: o.value, label: o.label } : null)} />{err('location')}</div>
          {text('batch', 'Batch', 100)}
          {text('actualUnitCost', 'Actual unit cost (INR per ml, optional)', 16, { inputMode: 'decimal' })}
          <div className="ms-field"><label htmlFor="ih-costProvenance">Cost source{draft.actualUnitCost.trim() && <> <span className="mr-form__required">*</span></>}</label>
            <input id="ih-costProvenance" className="mr-form__control" maxLength={1000} autoComplete="off" value={draft.costProvenance} onChange={(e) => set('costProvenance', e.target.value)} placeholder="Manufacturing worksheet reference" aria-invalid={Boolean(errors.costProvenance)} aria-describedby={desc('costProvenance')} data-testid="input-in-house-costProvenance" />{err('costProvenance')}
            <p className="mr-form__hint">Recorded as actual manufacturing cost. Leave both blank if unknown; it is shown as cost unavailable. Selling price is never used as cost.</p></div>
        </div>
        <div className="ms-field"><label htmlFor="ih-notes">Notes</label>
          <textarea id="ih-notes" className="mr-form__control" rows={3} maxLength={2000} value={draft.notes} onChange={(e) => set('notes', e.target.value)} aria-invalid={Boolean(errors.notes)} aria-describedby={desc('notes')} data-testid="input-in-house-notes" />
          {err('notes')}</div>
      </div></fieldset>
      <div className="ms-footer"><span>{blocked ? 'Saving is blocked until the earlier outcome is checked.' : review ? 'Nothing is saved until you confirm.' : 'Reviewed on the server before commit.'}</span><div className="ms-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={leave} disabled={busy === 'save'} data-testid="button-cancel-in-house">Cancel</button>
        <button type="submit" ref={reviewButtonRef} className="admin-button" aria-disabled={locked} data-testid="button-review-in-house">{busy === 'preview' ? 'Reviewing…' : 'Review entry'}</button></div></div>
    </form></section>
    {review && <Dialog className="inhouse-review-dialog" eyebrow="Inventory / In-house stock" title="Review before committing"
      description={`${RESERVE_NOTE} Values below are canonical as returned by the server.`}
      onClose={dismissReview} dismissDisabled={busy === 'save'} returnFocusRef={reviewButtonRef}
      footer={<>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busy)} onClick={dismissReview} data-testid="button-edit-in-house">Back to edit</button>
        <button type="button" className="admin-button" disabled={Boolean(busy) || blocked} onClick={confirm} data-testid="button-confirm-in-house">{busy === 'save' ? 'Saving…' : 'Confirm and save'}</button>
      </>}>
      <div className="inhouse-review-dialog__content" role="region" aria-label="Reviewed stock details" tabIndex={0} data-testid="panel-in-house-review">
        {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
        {busy !== 'save' && <InHousePendingBanner refreshSignal={tick} onResolved={resolvePending} />}
        <InHouseFacts record={review.record} date={date} />
        <p className="mr-form__hint" role="status">{busy === 'save' ? 'Saving…' : blocked ? 'Saving is blocked until the earlier outcome is checked.' : 'Nothing is saved until you confirm.'}</p>
      </div>
    </Dialog>}
    {saved && <InHouseStockDialog id={saved.id} initial={saved.allergenName ? saved : null} onClose={() => navigate(BASE)} />}
  </div></AdminLayout>;
}
