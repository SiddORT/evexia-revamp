import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ReferenceSelect from '../../components/admin/ReferenceSelect.jsx';
import InfoDisclosure from '../../components/admin/InfoDisclosure.jsx';
import ProductPendingBanner from '../../components/admin/ProductPendingBanner.jsx';
import { createProduct, getProduct, journaled, listMemberReferences, newKey, pendingProduct, toCents, updateProduct } from '../../services/productMaster.js';
import '../../mr.css';
import '../../moveStocks.css';
import '../../inventoryServer.css';
import '../../productMaster.css';
import { usePlatformConfirm } from '../../components/PlatformConfirmation.jsx';
import useProductDraftNavigation from '../../hooks/useProductDraftNavigation.js';
import { MAX_MILLI, milli } from '../../services/serverInventory.js';
import { masterNameError, normalizeMasterName } from '../../services/masterValidation.js';

const BASE = '/admin/masters/products';
const PRICE_HELP = 'Independent of component prices. Rounded half-up to two decimals by the server. Selling price must not exceed MRP.';
const qtyRe = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/;
let rowSeq = 0;
const blank = () => ({ rid: ++rowSeq, allergen: null, quantity: '' });
const signature = (name, mrp, sellingPrice, status, rows) => JSON.stringify([name, mrp, sellingPrice, status, rows.map((r) => [r.allergen?.value || '', r.quantity])]);

export default function ProductFormPage({ id }) {
  const [, navigate] = useLocation();
  const isNew = !id || id === 'new';
  const [name, setName] = useState('');
  const [mrp, setMrp] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [status, setStatus] = useState('active');
  const [rows, setRows] = useState(() => [blank(), blank()]);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState('');
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [tick, setTick] = useState(0);
  const [loadTick, setLoadTick] = useState(0);
  const [currentSaved, setCurrentSaved] = useState(null);
  const [checking, setChecking] = useState(false);
  const confirm = usePlatformConfirm();
  const baseline = useRef(signature(name, mrp, sellingPrice, status, rows));
  const leave = useProductDraftNavigation({ dirty: signature(name, mrp, sellingPrice, status, rows) !== baseline.current, busy: busy || checking, uncertain: blocked });
  const keyRef = useRef(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { try { setBlocked(Boolean(pendingProduct())); } catch { setBlocked(true); } }, [tick]);
  useEffect(() => {
    if (isNew) return undefined;
    const c = new AbortController(); setLoading(true); setLoadError('');
    getProduct(id, c.signal).then((p) => {
      setName(p.name); setMrp(String(p.mrp)); setSellingPrice(String(p.sellingPrice)); setStatus(p.status); setVersion(p.version);
      const nextRows = p.members.map((m) => ({ rid: ++rowSeq, allergen: { value: m.allergenId, label: m.name }, quantity: String(m.quantity) }));
      baseline.current = signature(p.name, String(p.mrp), String(p.sellingPrice), p.status, nextRows);
      setRows(nextRows);
      setLoading(false);
    }).catch((e) => { if (!c.signal.aborted) { setLoadError(e.message || 'Product could not be loaded.'); setLoading(false); } });
    return () => c.abort();
  }, [id, isNew, loadTick]);

  async function checkSaved() {
    setChecking(true); setMessage('');
    try { setCurrentSaved(await getProduct(id)); }
    catch (e) { setMessage(e.message || 'Current saved version could not be loaded. Your draft is unchanged.'); }
    finally { setChecking(false); }
  }
  async function acceptVersion() {
    if (!await confirm(`Keep your draft and prepare it against saved version ${currentSaved.version}? Saving will replace that version's displayed recipe and prices with your draft. No stock is changed.`, { title: 'Use this draft for the current version?', actionLabel: 'Keep draft for this version' })) return;
    setVersion(currentSaved.version); setCurrentSaved(null); keyRef.current = null;
    setMessage('Your draft is preserved against the reviewed saved version. Check all fields before saving. A further concurrent change will still be rejected.');
  }

  const patchRow = (rid, patch) => { keyRef.current = null; setRows((r) => r.map((x) => (x.rid === rid ? { ...x, ...patch } : x))); setErrors((e) => ({ ...e, [rid]: undefined, members: undefined })); };
  const clear = (k) => { keyRef.current = null; setErrors((e) => ({ ...e, [k]: undefined })); };
  function validate() {
    const e = {};
    const nameError = masterNameError(name, 'product name');
    if (nameError) e.name = nameError;
    if (!['active', 'inactive'].includes(status)) e.status = 'Select Active or Inactive.';
    const mc = toCents(mrp), sc = toCents(sellingPrice);
    if (mc === null) e.mrp = 'Enter a non-negative amount.';
    if (sc === null) e.sellingPrice = 'Enter a non-negative amount.';
    else if (mc !== null && sc > mc) e.sellingPrice = 'Selling price cannot exceed MRP (compared after rounding to two decimals).';
    if (rows.length < 2 || rows.length > 100) e.members = 'A combo needs 2–100 distinct allergens.';
    const seen = new Set();
    rows.forEach((r) => {
      if (!r.allergen) e[r.rid] = 'Select an allergen.';
      else if (seen.has(r.allergen.value)) e[r.rid] = 'Each allergen can appear only once.';
      else if (!qtyRe.test(r.quantity.trim()) || milli(r.quantity) === null || milli(r.quantity) <= 0n || milli(r.quantity) > MAX_MILLI) e[r.rid] = 'Enter a positive quantity up to 1000000, with up to 3 decimals.';
      if (r.allergen) seen.add(r.allergen.value);
    });
    return e;
  }
  async function submit(ev) {
    ev.preventDefault();
    if (lock.current || busy || blocked) return;
    const e = validate(); setErrors(e); setMessage('');
    if (Object.keys(e).length) return;
    lock.current = true; setBusy(true);
    const key = keyRef.current || (keyRef.current = newKey());
    const body = { idempotencyKey: key, name: normalizeMasterName(name), mrp: mrp.trim(), sellingPrice: sellingPrice.trim(), status,
      members: rows.map((r) => ({ allergenId: r.allergen.value, quantity: r.quantity.trim() })) };
    try {
      await journaled(key, () => (isNew ? createProduct(body) : updateProduct(id, { ...body, expected_version: version })));
      keyRef.current = null; navigate(BASE);
    } catch (err) {
      if (!mounted.current) return;
      if (err.fields) {
        const next = {};
        for (const [field, message] of Object.entries(err.fields)) {
          const member = /^members\.(\d+)\.(allergenId|quantity)$/.exec(field);
          if (member && rows[Number(member[1])]) next[rows[Number(member[1])].rid] = message;
          else if (['name', 'mrp', 'sellingPrice', 'status', 'members'].includes(field)) next[field] = message;
        }
        setErrors((current) => ({ ...current, ...next }));
      }
      if (err.uncertain) { setBlocked(true); setTick((t) => t + 1); setMessage(`${err.message || 'The save outcome is unknown.'} Check the save outcome before saving again. Your draft is preserved.`); }
      else { keyRef.current = null; setMessage(`${err.message || 'Nothing was saved.'} Your draft is preserved.`); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const err = (k) => errors[k] && <p id={`pf-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
    return <AdminLayout title={isNew ? 'Add product' : 'Edit product'}><div className="move-stocks-page product-form-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Product Master / {isNew ? 'New' : 'Edit'}</p><h1>{isNew ? 'Add product' : 'Edit product'}</h1><p className="admin-page-head__description">Quantities are for one whole combo, in each allergen's stock unit. Edits affect future assemblies only.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => leave(BASE)} data-testid="button-back-products"><ArrowLeft size={16} /> All products</button></div></div>
    <ProductPendingBanner refreshSignal={tick} onResolved={(r) => { keyRef.current = null; if (r.state === 'committed') { navigate(BASE); return; } setMessage('The earlier save was not committed. Your draft is preserved; save again to retry.'); setTick((t) => t + 1); }} />
    {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
    {loadError && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{loadError}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setLoadTick((t) => t + 1)}>Retry</button></div>}
    {!isNew && !loading && !loadError && <div className="admin-feedback inv-banner">
      <p>Editing version {version}. Check the saved version after a conflict without losing this draft.</p>
      <button type="button" className="admin-button admin-button--secondary" disabled={busy || blocked || checking} onClick={checkSaved}>{checking ? 'Checking…' : 'Check saved version (keep draft)'}</button>
      {currentSaved && <div><h2>Saved version {currentSaved.version}</h2><p>{currentSaved.name} · MRP {currentSaved.mrp} · Selling price {currentSaved.sellingPrice} · {currentSaved.deletedAt ? 'Deleted' : currentSaved.status}</p>
        <ul>{currentSaved.members.map((m) => <li key={m.allergenId}>{m.name}: {m.quantity} {m.unit}</li>)}</ul>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || blocked || Boolean(currentSaved.deletedAt)} onClick={acceptVersion}>Keep draft for this saved version</button></div>}
    </div>}
    {loading ? <p className="admin-empty" role="status">Loading product…</p> : !loadError && <section className="admin-panel"><form onSubmit={submit} noValidate>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><div className="ms-form-body">
        <div className="ms-fields">
          <div className="ms-field"><label htmlFor="pf-name">Combo name <span className="mr-form__required">*</span></label><input id="pf-name" className="mr-form__control" maxLength={200} value={name} onChange={(e) => { setName(e.target.value); clear('name'); }} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'pf-name-error' : undefined} data-testid="input-product-name" />{err('name')}</div>
          <div className="ms-field"><InfoDisclosure id="pf-mrp-help" title="MRP per combo" text={PRICE_HELP}><label htmlFor="pf-mrp">MRP per combo <span className="mr-form__required">*</span></label></InfoDisclosure><input id="pf-mrp" className="mr-form__control" inputMode="decimal" value={mrp} onChange={(e) => { setMrp(e.target.value); clear('mrp'); clear('sellingPrice'); }} aria-invalid={Boolean(errors.mrp)} aria-describedby={errors.mrp ? 'pf-mrp-error' : undefined} data-testid="input-product-mrp" />{err('mrp')}</div>
          <div className="ms-field"><InfoDisclosure id="pf-sp-help" title="Selling price per combo" text={PRICE_HELP}><label htmlFor="pf-sp">Selling price per combo <span className="mr-form__required">*</span></label></InfoDisclosure><input id="pf-sp" className="mr-form__control" inputMode="decimal" value={sellingPrice} onChange={(e) => { setSellingPrice(e.target.value); clear('sellingPrice'); }} aria-invalid={Boolean(errors.sellingPrice)} aria-describedby={errors.sellingPrice ? 'pf-sellingPrice-error' : undefined} data-testid="input-product-selling-price" />{err('sellingPrice')}</div>
          <div className="ms-field"><label htmlFor="pf-status">Status</label><select id="pf-status" className="mr-form__control" value={status} onChange={(e) => { setStatus(e.target.value); keyRef.current = null; clear('status'); }} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'pf-status-error' : undefined} data-testid="select-product-form-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>{err('status')}</div>
        </div>
        <fieldset className="ms-products product-members" aria-labelledby="pf-members-heading">
          <div className="product-members__heading"><h2 id="pf-members-heading" className="ms-legend">Allergen members <span className="mr-form__required">*</span></h2>
            <button type="button" className="admin-button admin-button--secondary" disabled={busy || rows.length >= 100} onClick={() => { keyRef.current = null; setRows((x) => x.length < 100 ? [...x, blank()] : x); }} data-testid="button-add-member"><Plus size={14} aria-hidden="true" /> Add allergen</button>
          </div>
          {rows.map((r, i) => <div key={r.rid} className="product-member-row">
            <div className="ms-field"><label htmlFor={`pf-a-${r.rid}`}>Allergen {i + 1}</label>
              <ReferenceSelect id={`pf-a-${r.rid}`} label={`Allergen ${i + 1}`} kind="allergens" fetchPage={listMemberReferences} value={r.allergen?.value || ''} selected={r.allergen} onChange={(_v, o) => patchRow(r.rid, { allergen: o ? { value: o.value, label: o.label } : null })} placeholder="Select allergen" invalid={Boolean(errors[r.rid])} describedBy={errors[r.rid] ? `pf-${r.rid}-error` : undefined} showResultHint={false} disabled={busy} />
</div>
            <div className="ms-field"><label htmlFor={`pf-q-${r.rid}`}>Quantity per combo</label><input id={`pf-q-${r.rid}`} className="mr-form__control" inputMode="decimal" autoComplete="off" value={r.quantity} onChange={(e) => patchRow(r.rid, { quantity: e.target.value })} aria-invalid={Boolean(errors[r.rid])} aria-describedby={errors[r.rid] ? `pf-${r.rid}-error` : undefined} data-testid={`input-member-qty-${i}`} />{err(r.rid)}</div>
            <button type="button" className="admin-button admin-button--secondary product-member-remove" disabled={busy || rows.length <= 2} aria-label={`Remove allergen ${i + 1}${r.allergen ? `, ${r.allergen.label}` : ''}`} title={`Remove allergen ${i + 1}${r.allergen ? `, ${r.allergen.label}` : ''}`} onClick={() => { keyRef.current = null; setRows((x) => x.filter((y) => y.rid !== r.rid)); }}><Trash2 size={16} aria-hidden="true" /></button>
          </div>)}
          {err('members')}
        </fieldset>
      </div></fieldset>
      <div className="ms-footer"><span>Saving the master does not create stock or change allergen prices.</span><div className="ms-head-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => leave(BASE)} disabled={busy}>Cancel</button>
        <button type="submit" className="admin-button" disabled={busy || blocked} data-testid="button-save-product">{busy ? 'Saving…' : 'Save product'}</button></div></div>
    </form></section>}
  </div></AdminLayout>;
}
