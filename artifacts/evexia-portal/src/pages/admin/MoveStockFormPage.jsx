import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Settings2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import InfoDisclosure from '../../components/admin/InfoDisclosure.jsx';
import ReserveMovementDialog from '../../components/admin/ReserveMovementDialog.jsx';
import { getInHouseStock } from '../../services/inHouseStock.js';
import { reserveConfiguration } from '../../services/reserveDilution.js';
import { resolveReserveShortcut } from '../../services/reserveShortcut.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { concentrationLabel, isReserveLine, forgetMove, INVENTORY_INITIALIZATION_GUIDANCE, listReference, lotOriginLabel, newKey, pendingMove, previewMovement, reconcileMovement, rememberMove, saveMovement, validateLines } from '../../services/serverInventory.js';
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
  const [initializationBlocked, setInitializationBlocked] = useState(false);
  const [configuration, setConfiguration] = useState(null);
  const configurationTrigger = useRef(null);
  const [prefill, setPrefill] = useState({ loading: false, options: [], message: '' });
  const prefillTarget = useRef(null);
  const reviewButtonRef = useRef(null);
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
      setInitializationBlocked(false);
      setLots({ items: all, loading: false, error: '', loadedFor: id });
    } catch (e) {
      if (mine !== lotSeq.current) return;
      if (e.code === 'inventory_uninitialized') {
        setInitializationBlocked(true);
        setReview(null);
        setLots((s) => ({ ...s, loading: false, error: '', loadedFor: '' }));
      } else setLots((s) => ({ ...s, loading: false, error: e.message || 'Lots could not be loaded.' }));
    }
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

  useEffect(() => {
    let active = true;
    const values = new URLSearchParams(window.location.search).getAll('reserve');
    if (!values.length) return;
    async function resolve() {
      try {
        setPrefill({ loading: true, options: [], message: 'Loading the selected reserve and current source locations…' });
        const resolved = await resolveReserveShortcut(values, {
          getReserve: getInHouseStock, getLocations: (params) => listReference('locations', params),
          pending: pendingMove, isCurrent: () => active,
        });
        if (!active || !resolved) return;
        const { options, reserveId } = resolved;
        setPrefill({ loading: false, options, reserveId, message: options.length > 1 ? 'This reserve has several current source locations. Choose one explicitly below.' : 'Reserve shortcut applied from current server balances. Quantity is editable; choose destination, delivered by and dilution yourself.' });
        if (options.length === 1) {
          prefillTarget.current = { reserveId, sourceId: options[0].value };
          setSource(options[0]);
        }
      } catch (e) {
        if (active) setPrefill({ loading: false, options: [], message: e.message || 'Reserve is missing or inaccessible. No batch was selected.' });
      }
    }
    resolve();
    return () => { active = false; prefillTarget.current = null; };
  }, []);

  useEffect(() => {
    const target = prefillTarget.current;
    if (!target || lots.loading || lots.loadedFor !== target.sourceId) return;
    prefillTarget.current = null;
    try {
      if (pendingMove()) throw new Error('A previous movement needs recovery. No reserve selection was applied.');
      const lot = lots.items.find((l) => l.id === target.reserveId && isReserveLine(l));
      if (!lot) throw new Error('This exact reserve is no longer available at the chosen source. Refresh In-house Stock; no other batch was selected.');
      setPicked({ [lot.id]: { lot, quantity: lot.available, dilute: null, factor: '' } });
    } catch (e) { setPrefill((p) => ({ ...p, message: e.message })); }
  }, [lots]);

  const pickedList = Object.values(picked);
  const listed = new Map(lots.items.map((l) => [l.id, l]));
  const fresh = lots.loadedFor === sourceId && !lots.loading && !lots.error && !initializationBlocked;
  const unavailable = fresh ? pickedList.filter((p) => !listed.has(p.lot.id)) : [];
  // Current balances win when the lot is still listed; otherwise the retained metadata is validated as unavailable.
  const selectedLines = pickedList.map((p) => ({ lot: listed.get(p.lot.id) || p.lot, quantity: p.quantity, dilute: p.dilute, factor: p.factor }));
  const setPick = (id, patch) => setPicked((p) => (id in p ? { ...p, [id]: { ...p[id], ...patch } } : p));
  const clear = (k) => setErrors((e) => ({ ...e, [k]: undefined }));
  const locked = Boolean(busy) || Boolean(review) || Boolean(uncertainKey) || prefill.loading;

  function changeSource(_v, option) {
    prefillTarget.current = null;
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
      return { ...p, [l.id]: { lot: l, quantity: '', dilute: null, factor: '' } };
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
    selectedLines.forEach(({ lot, quantity }) => { if (lot.itemKind === 'combo' && !e[lot.id] && !/^[1-9]\d*(?:\.0{1,6})?$/.test(quantity.trim())) e[lot.id] = 'Assembled combos move only as positive whole combos.'; });
    selectedLines.forEach(({ lot, dilute, factor }) => {
      if (!isReserveLine(lot)) return;
      const validation = reserveConfiguration(lot, { quantity: picked[lot.id].quantity, dilute, factor });
      if (validation.errors.quantity) e[lot.id] = validation.errors.quantity;
      if (validation.errors.dilute) e[`${lot.id}:dilute`] = validation.errors.dilute;
    });
    return e;
  }
  const buildBody = () => ({ sourceId: source.value === 'unallocated' ? null : source.value, destinationId: destination.value, date,
    deliveryMode: by.value === OTHER ? 'other' : 'staff', staffId: by.value === OTHER ? null : by.value,
    otherName: by.value === OTHER ? otherName.trim() : null,
    lines: selectedLines.map(({ lot, quantity, dilute, factor }) => (isReserveLine(lot)
      ? { lotId: lot.id, quantity: quantity.trim(), sourceKind: 'reserve', dilute, dilutionFactor: dilute ? Number(factor) : null }
      : { lotId: lot.id, quantity: quantity.trim(), sourceKind: 'inventory', dilute: null, dilutionFactor: null })) });

  async function submitReview(ev) {
    ev.preventDefault();
    if (lock.current || locked || initializationBlocked) return;
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
    } catch (err) {
      if (mounted.current) {
        if (err.code === 'inventory_uninitialized') { setInitializationBlocked(true); setReview(null); }
        else {
          setMessage(`${err.message || 'The movement could not be reviewed.'} Correct the highlighted choice or quantity; your draft is preserved.`);
          if (/stock|source|available/i.test(err.message || '')) loadLots(sourceId);
        }
      }
    }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  }
  async function confirm() {
    if (lock.current || !review || busy || uncertainKey || initializationBlocked) return;
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
      if (err.code === 'inventory_uninitialized') { setInitializationBlocked(true); setReview(null); }
      if (journaled) {
        // Sent or journaled: stay pending until /requests reconciliation closes or confirms it.
        setUncertainKey(key);
        setMessage(`${err.code === 'inventory_uninitialized' ? 'Inventory initialization is required.' : err.message || 'The save outcome is unknown.'} Check the save outcome before saving again. Your draft is preserved.`);
      } else { keyRef.current = null; setMessage(`${err.message || 'Nothing was sent.'} Your draft is preserved.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(''); }
  }

  const err = (k) => errors[k] && <p id={`ms-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
  const UNALLOCATED_SOURCE = [{ value: 'unallocated', label: 'Unallocated (opening stock, no location)' }];
  const staffFetch = (kind, params) => listReference(kind, params);
  const hasUnavailable = unavailable.length > 0;

  return <AdminLayout title="Move stock"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Move stocks / New</p><h1>Move stock</h1><p className="admin-page-head__description">Choose source batches and a destination. Protected in-house reserves require an explicit dilution choice; No keeps them reserve-only. Quantities save half-up to two places from up to six source decimals; assembled combos remain whole numbers.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} data-testid="button-back-move"><ArrowLeft size={16} /> All movements</button></div></div>
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    {prefill.message && <div className="admin-feedback" role="status">{prefill.message}
      {prefill.options.length > 1 && !sourceId && <div className="ms-field"><label htmlFor="reserve-prefill-source">Current source for this reserve</label>
        <select id="reserve-prefill-source" className="mr-form__control" disabled={locked} value="" onChange={(e) => {
          const option = prefill.options.find((o) => o.value === e.target.value);
          if (!option) return;
          prefillTarget.current = { reserveId: prefill.reserveId, sourceId: option.value }; setSource(option); setPicked({});
        }}><option value="">Choose current source</option>{prefill.options.map((o) => <option key={o.value} value={o.value}>{o.label} · {o.quantity} ml</option>)}</select></div>}
    </div>}
    {initializationBlocked && <div className="admin-feedback admin-feedback--error inv-banner" role="alert">
      <div><strong>Receipt initialization review required</strong><p>{INVENTORY_INITIALIZATION_GUIDANCE}</p><p>Review and saving are blocked. After the operator confirms complete initialization, check the status here to reload balances.</p></div>
      <button type="button" className="admin-button admin-button--secondary" disabled={!sourceId || lots.loading || Boolean(busy)} onClick={() => loadLots(sourceId)}>{lots.loading ? 'Checking…' : 'Check initialization status'}</button>
    </div>}
    {uncertainKey && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>A previous save has an unchecked outcome. New saves are blocked until it is checked.</p>
      <button type="button" className="admin-button" disabled={Boolean(busy)} onClick={() => explicitReconcile(uncertainKey)}>{busy === 'reconcile' ? 'Checking…' : 'Check save outcome'}</button></div>}
    <section className="admin-panel" aria-label="New stock movement">
      <form onSubmit={submitReview} noValidate>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="ms-form-body">
          <div className="ms-fields">
            <div className="ms-field"><label htmlFor="ms-source">Source location <span className="mr-form__required">*</span></label>
              <ReferenceSelect id="ms-source" label="Source location" kind="locations" fetchPage={staffFetch} showResultHint={false} pinned={UNALLOCATED_SOURCE} value={sourceId} selected={source} onChange={changeSource} disabled={locked} placeholder="Select source" invalid={Boolean(errors.sourceId)} describedBy={errors.sourceId ? 'ms-sourceId-error' : undefined} />{err('sourceId')}</div>
            <div className="ms-field"><label htmlFor="ms-dest">Destination location <span className="mr-form__required">*</span></label>
              <ReferenceSelect id="ms-dest" label="Destination location" kind="locations" fetchPage={staffFetch} showResultHint={false} value={destination?.value || ''} selected={destination} exclude={sourceId === 'unallocated' ? '' : sourceId} disabled={locked} onChange={(_v, o) => { setDestination(o ? { value: o.value, label: o.label } : null); clear('destinationId'); }} placeholder="Select destination" invalid={Boolean(errors.destinationId)} describedBy={errors.destinationId ? 'ms-destinationId-error' : undefined} />{err('destinationId')}</div>
            <div className="ms-field"><label htmlFor="ms-date">Date <span className="mr-form__required">*</span></label>
              <input id="ms-date" type="date" className="mr-form__control" value={date} onChange={(e) => { setDate(e.target.value); clear('date'); }} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'ms-date-error' : undefined} data-testid="input-move-date" />{err('date')}</div>
            <div className="ms-field"><InfoDisclosure id="ms-by-info" title="Delivered by" text="Recorded delivery name only. It is not proof of who saved the movement; the server records the actor separately."><label htmlFor="ms-by">Delivered by <span className="mr-form__required">*</span></label></InfoDisclosure>
              <div className="ms-delivery-row">
                <ReferenceSelect id="ms-by" label="Delivered by" kind="staff" fetchPage={staffFetch} pinned={OTHER_OPTION} value={by?.value || ''} selected={by} disabled={locked} onChange={(_v, o) => { setBy(o ? { value: o.value, label: o.label } : null); clear('deliveredBy'); }} placeholder="Select active staff or Other" invalid={Boolean(errors.deliveredBy)} describedBy={errors.deliveredBy ? 'ms-deliveredBy-error' : undefined} />
                {by?.value === OTHER && <div><input id="ms-other" className="mr-form__control" aria-label="Delivery name" placeholder="Name of person delivering" value={otherName} maxLength={120} onChange={(e) => { setOtherName(e.target.value); clear('deliveredBy'); }} aria-invalid={Boolean(errors.deliveredBy)} aria-describedby={errors.deliveredBy ? 'ms-deliveredBy-error' : undefined} data-testid="input-move-delivered-by" /></div>}
              </div>
              {err('deliveredBy')}</div>
          </div>
          <fieldset className="ms-products" aria-describedby={errors.lines ? 'ms-lines-error' : undefined}>
            <legend className="ms-legend">Lots to move <span className="mr-form__required">*</span></legend>
            {sourceId && <div className="inv-more"><button type="button" className="admin-button admin-button--secondary" disabled={lots.loading || initializationBlocked} onClick={() => loadLots(sourceId)} data-testid="button-refresh-lots">{lots.loading ? 'Refreshing…' : 'Refresh balances'}</button><span>{pickedList.length} of {MAX_LOTS} lots selected. Selections and typed quantities are kept on refresh.</span></div>}
            {lots.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{lots.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => loadLots(sourceId)}>Retry</button></div>}
            {hasUnavailable && <div className="admin-feedback admin-feedback--error" role="alert">{unavailable.length} selected lot{unavailable.length === 1 ? ' is' : 's are'} no longer available at this source. Remove {unavailable.length === 1 ? 'it' : 'them'} to continue.</div>}
            {!sourceId ? <div className="admin-empty" role="status"><strong>Select a source location</strong><p>Available receipt, opening and assembly lots at that source will be listed. Select Unallocated to allocate opening stock.</p></div>
              : initializationBlocked && !pickedList.length ? <div className="admin-empty" role="status"><strong>Balances unavailable pending receipt initialization review</strong><p>No partial balances can be used.</p></div>
              : lots.loading && !lots.items.length && !pickedList.length ? <div className="admin-empty" role="status"><strong>Loading lots…</strong></div>
              : !lots.items.length && !pickedList.length && !lots.error ? <div className="admin-empty" role="status" data-testid="text-move-empty-source"><strong>No stock at this source</strong><p>Choose another source that holds stock, or confirm inventory is initialized.</p></div>
              : <div className="admin-table-scroll ms-stock-table" role="region" aria-label="Source lots" tabIndex={0} aria-busy={lots.loading}><table className="admin-table"><thead><tr><th scope="col">Select</th><th scope="col">Product / batch</th><th scope="col">Available (unit)</th><th scope="col">Quantity to move</th></tr></thead><tbody>{[...unavailable.map((p) => ({ lot: p.lot, gone: true })), ...lots.items.map((lot) => ({ lot, gone: false }))].map(({ lot: l, gone }) => { const on = l.id in picked; return <tr key={l.id}>
                <td><input type="checkbox" id={`ms-p-${l.id}`} checked={on} disabled={initializationBlocked} onChange={() => togglePick(l)} aria-label={`Select ${l.name}`} data-testid={`checkbox-move-lot-${l.id}`} /></td>
                <td><label htmlFor={`ms-p-${l.id}`} className="ms-product__name">{l.productName}</label><span className="stock-sub">{l.itemKind === 'combo' ? 'Assembled combo, whole combos only · ' : ''}{l.itemKind !== 'combo' ? `${concentrationLabel(l.concentration)} · ` : ''}{l.batchNo ? `Batch ${l.batchNo}` : 'Batch unavailable'} · {lotOriginLabel(l)} · exp {l.expiryDate ? displayDate(l.expiryDate) : 'unavailable'}{l.itemKind === 'combo' ? ` · assembly ${l.assemblyId || 'link unavailable'}${l.recipe ? ` · recipe v${l.recipe.version}` : ''}${l.mrp != null ? ` · MRP ${l.mrp}, selling ${l.sellingPrice}` : ''}` : ''}</span>{gone && <span className="mr-form__error">No longer available at this source</span>}</td>
                <td className="inv-mono" data-testid={`text-move-available-${l.id}`}>{gone || initializationBlocked ? 'Unavailable' : `${l.available} ${l.unit || 'ml'}`}</td>
                <td>{on && isReserveLine(l) ? <div className="ms-reserve-compact">
                  <div><strong>{picked[l.id].quantity || 'Not configured'} {picked[l.id].quantity ? l.unit || 'ml' : ''}</strong>
                    <span className="stock-sub">{picked[l.id].dilute === true ? `${picked[l.id].factor}-fold dilution` : picked[l.id].dilute === false ? 'No dilution · reserve only' : 'Choose dilution in configuration'}</span>
                    {reserveConfiguration(l, picked[l.id]).output && <span className="stock-sub">Output {reserveConfiguration(l, picked[l.id]).output.quantity} {l.unit || 'ml'} · concentration {reserveConfiguration(l, picked[l.id]).output.concentration}</span>}
                  </div><button type="button" className="admin-icon-button" disabled={gone || locked || initializationBlocked || !fresh} aria-label={`Configure reserve, ${l.productName}, batch ${l.batchNo || 'unavailable'}`}
                    onClick={(e) => { configurationTrigger.current = e.currentTarget; setConfiguration(l); }}><Settings2 size={17} aria-hidden="true" /></button>
                  {err(l.id)}{err(`${l.id}:dilute`)}
                </div> : on ? <div className="ms-qty"><label htmlFor={`ms-q-${l.id}`}>Source input quantity ({l.itemKind === 'combo' ? `${l.unit}, whole number` : l.unit || 'ml'})</label>
                  <input id={`ms-q-${l.id}`} className="mr-form__control" type="text" inputMode={l.itemKind === 'combo' ? 'numeric' : 'decimal'} autoComplete="off" value={picked[l.id].quantity} onChange={(e) => { const v = e.target.value; setPicked((p) => (l.id in p ? { ...p, [l.id]: { ...p[l.id], quantity: v } } : p)); clear(l.id); clear('lines'); }} aria-invalid={Boolean(errors[l.id])} aria-describedby={errors[l.id] ? `ms-q-${l.id}-error` : undefined} data-testid={`input-move-qty-${l.id}`} />
                  {errors[l.id] && <p id={`ms-q-${l.id}-error`} className="mr-form__error" role="alert">{errors[l.id]}</p>}
                  </div> : <span className="mr-form__hint">Select lot first</span>}</td>
              </tr>; })}</tbody></table></div>}
            {errors.lines && <p id="ms-lines-error" className="mr-form__error" role="alert">{errors.lines}</p>}
          </fieldset>
        </div>
        </fieldset>
        <div className="ms-footer"><span>Saves to the server only after you confirm the review.</span><div className="ms-head-actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} disabled={busy === 'save'} data-testid="button-cancel-move">Cancel</button>
          <button type="submit" ref={reviewButtonRef} className="admin-button" disabled={locked || initializationBlocked || Boolean(configuration)} data-testid="button-review-move">{busy === 'preview' ? 'Reviewing…' : 'Review movement'}</button></div></div>
      </form>
    </section>
    {configuration && <ReserveMovementDialog lot={configuration} sourceName={source?.label} applied={picked[configuration.id]} displayDate={displayDate} returnFocusRef={configurationTrigger}
      onClose={() => setConfiguration(null)} onApply={(draft) => {
        setPick(configuration.id, draft); clear(configuration.id); clear(`${configuration.id}:dilute`); clear('lines'); setReview(null); setConfiguration(null);
      }} />}
    {review && <Dialog title="Review stock movement" eyebrow="Move stocks" className="ms-review-dialog" returnFocusRef={reviewButtonRef}
      description="Server-reviewed summary. Nothing is saved until you confirm; changed inputs or balances need a new review."
      dismissDisabled={busy === 'save' || busy === 'reconcile'} onClose={() => { if (!busy && !uncertainKey) setReview(null); }}
      footer={<>
        <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(busy) || Boolean(uncertainKey)} onClick={() => setReview(null)} data-testid="button-back-edit-move">Back to edit</button>
        {uncertainKey ? <button type="button" className="admin-button" disabled={Boolean(busy)} onClick={() => explicitReconcile(uncertainKey)} data-testid="button-reconcile-move">{busy === 'reconcile' ? 'Checking…' : 'Check save outcome'}</button>
          : <button type="button" className="admin-button" disabled={Boolean(busy) || initializationBlocked} onClick={confirm} data-testid="button-save-move">{busy === 'save' ? 'Saving…' : 'Confirm and move stock'}</button>}</>}>
      <div className="ms-review-content" data-testid="panel-move-review" aria-busy={busy === 'save'} role="region" aria-label="Movement review content" tabIndex={0}>
        {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
        {uncertainKey && <p className="admin-feedback admin-feedback--error" role="status">A save outcome is unchecked. Check it before saving again; your draft is preserved.</p>}
        <dl className="movement-locations">
          <div><dt>Source</dt><dd>{review.movement.source?.name || 'Unallocated'}</dd></div>
          <div><dt>Destination</dt><dd>{review.movement.destination?.name}</dd></div>
        </dl>
        <dl className="movement-facts movement-context">
          <div><dt>Movement date</dt><dd>{displayDate(review.movement.date)}</dd></div>
          <div><dt>Delivered by</dt><dd>{review.movement.deliveredBy}</dd></div>
        </dl>
        <section className="movement-items" aria-label="Reviewed lines">
          <h3>Items to move</h3>
          {review.movement.lines.map((l) => { const diluted = Boolean(l.dilutionFactor); return <article className="movement-item" key={l.lotId}>
            <header className="movement-item__header">
              <h4>{l.productName}</h4>
              <p className="movement-item__batch">{l.batchNo ? `Batch ${l.batchNo}` : 'Batch unavailable'}</p>
              <p className="movement-support">{lotOriginLabel(l)}</p>
              <p className="movement-support">Product reference: {l.productId}</p>
            </header>
            <dl className="movement-facts movement-quantities">
              <div><dt>Consumed quantity</dt><dd>{l.quantity} {l.unit || 'ml'}</dd></div>
              <div><dt>Output quantity</dt><dd>{diluted ? l.resultingQuantity ?? 'unavailable' : l.resultingQuantity ?? l.quantity} {l.unit || 'ml'}</dd></div>
              {l.sourceKind === 'reserve' && <div><dt>Dilution</dt><dd>{diluted ? `${l.dilutionFactor}-fold` : 'Not diluted · reserve only'}</dd></div>}
            </dl>
            <div className="movement-balances">
              <section><h5>Source balance</h5><dl className="movement-facts">
                <div><dt>Before</dt><dd>{l.sourceBefore ?? 'unavailable'}</dd></div>
                <div><dt>After</dt><dd>{l.sourceAfter ?? 'unavailable'}</dd></div>
              </dl></section>
              <section><h5>Destination balance</h5><dl className="movement-facts">
                <div><dt>Before</dt><dd>{l.destinationBefore ?? 'unavailable'}</dd></div>
                <div><dt>After</dt><dd>{l.destinationAfter ?? 'unavailable'}</dd></div>
              </dl></section>
            </div>
            <dl className="movement-facts movement-supporting">
              <div><dt>Original concentration</dt><dd>{concentrationLabel(l.concentration)}</dd></div>
              {diluted && <div><dt>Resulting concentration</dt><dd>{concentrationLabel(l.resultingConcentration)} ({l.dilutionFactor}-fold)</dd></div>}
              <div><dt>Original expiry</dt><dd>{l.expiryDate ? displayDate(l.expiryDate) : 'unavailable'}</dd></div>
              {diluted && <div><dt>Resulting expiry</dt><dd>{l.resultingExpiryDate ? displayDate(l.resultingExpiryDate) : 'unavailable'}</dd></div>}
            </dl>
          </article>; })}
        </section>
      </div>
    </Dialog>}
  </div></AdminLayout>;
}
