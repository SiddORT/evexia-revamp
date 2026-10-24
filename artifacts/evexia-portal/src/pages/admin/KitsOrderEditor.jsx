import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderActions } from '../../components/orders/OrderPortalContext.jsx';
import KitsReferenceSelect from '../../components/admin/KitsReferenceSelect.jsx';
import { DownloadOrderFile, OrderFileList } from '../../components/orders/OrderFiles.jsx';
import { KIT_PRODUCTS, blankOrder, orderInput, downloadAttachment, updateOrder } from '../../services/serverKits.js';
import { blankPricing, calculateKitsPricing, pricingInput, moneyText, normalizeKitsAmount } from '../../services/kitsPricing.js';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import '../../kitsOrders.css';
import '../../orderEntry.css';

const Err = ({ id, text }) => (text ? <p className="kits-error" id={id} role="alert">{text}</p> : null);

function Facts({ person, empty }) {
  if (!person) return <p className="kits-unavailable">{empty}</p>;
  const a = person.address || {};
  const rows = [['Name', person.name], ['Phone no.', person.phone], ['Address line 1', a.line1], ['Address line 2', a.line2], ['Landmark', a.landmark], ['Country', a.country], ['State', a.state], ['City', a.city], ['Pincode', a.pincode]];
  return <dl className="kits-facts">{rows.map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '-'}</dd></div>)}</dl>;
}

function hydrate(o) {
  const b = blankOrder();
  const k = o.kit || {};
  return {
    ...b, orderFor: o.orderFor || 'doctor',
    doctorId: o.doctorId || o.doctor?.id || '', mrId: o.mrId || o.mr?.id || '', patientId: o.patientId || o.patient?.id || '',
    kit: { product: k.product || '', custom: k.custom || '', volume: k.volume == null ? '' : String(k.volume), quantity: k.quantity == null ? '' : String(k.quantity) },
    lancets: o.lancets == null ? '' : String(o.lancets), applicators: o.applicators == null ? '' : String(o.applicators), tray: o.tray == null ? '' : String(o.tray),
    shipping: o.shipping || 'doctor', remarks: o.remarks || '',
    other: { ...b.other, ...(o.other || {}), address: { ...b.other.address, ...(o.other?.address || {}) } },
    status: o.status, paymentStatus: o.paymentStatus, attachments: o.attachments || [],
  };
}

export default function KitsOrderEditor({ order }) {
  const can = useOrderActions('kits');
  const BASE = useOrderBase('kits-consumables');
  const [, navigate] = useLocation();
  const { date } = useAdminDateFormatters();
  const [v, setV] = useState(() => hydrate(order));
  const [pricing, setPricing] = useState(() => (order.pricing ? { ...blankPricing(), ...pricingInput(order.pricing) } : blankPricing()));
  const [parking, setParking] = useState(order.businessParking == null ? '' : String(order.businessParking));
  const [po, setPo] = useState(order.poNumber || '');
  const [doctor, setDoctor] = useState(null), [mr, setMr] = useState(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [errors, setErrors] = useState({}), [done, setDone] = useState(false);
  const submission = useRef(null), saving = useRef(false), summaryRef = useRef(null);
  const tax = order.pricing?.taxPercentage || '5.00';
  const protectedOk = Boolean(can.protected);

  useEffect(() => setNavigationGuard(() => {
    if (!saving.current && !submission.current) return false;
    setErrors({ save: 'Keep this draft open and retry the unchanged submission to confirm its outcome.' });
    return true;
  }), []);

  const set = (p) => setV((c) => ({ ...c, ...p }));
  const setKit = (p) => setV((c) => ({ ...c, kit: { ...c.kit, ...p } }));
  const setP = (p) => setPricing((c) => ({ ...c, ...p }));
  const frozen = busy || uncertain || done;

  const calc = useMemo(() => {
    try { return { snap: calculateKitsPricing(v, pricing, tax), error: '' }; }
    catch (e) { return { snap: null, error: e.message || 'Enter valid rates.' }; }
  }, [v, pricing, tax]);
  const snap = calc.snap;
  const L = snap?.lineAmounts || {};

  const doctorChanged = v.doctorId !== order.doctorId;
  const mrChanged = v.mrId !== (order.mrId || '');
  const recipient = v.shipping === 'other' ? null
    : v.shipping === order.shipping && !(v.shipping === 'doctor' ? doctorChanged : mrChanged) ? order.recipient
      : v.shipping === 'mr' ? (v.mrId ? mr || (!mrChanged ? order.mr : null) : null)
        : (v.doctorId ? doctor || (!doctorChanged ? order.doctor : null) : null);
  const billing = doctorChanged ? doctor : (order.billing || order.doctor);

  async function save() {
    if (saving.current || done || !protectedOk) return;
    if (!submission.current) {
      const e = {};
      try { normalizeKitsAmount(parking); } catch { e.parking = 'Enter Business Parking as a non-negative amount up to 999999999.99; 0 is valid.'; }
      if (calc.error) e.pricing = calc.error;
      if (Object.keys(e).length) { setErrors(e); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    }
    saving.current = true; setBusy(true); setErrors({});
    try {
      if (!submission.current) {
        submission.current = { ...orderInput(v), pricing: pricingInput(pricing), businessParking: parking, poNumber: po, expected_version: order.version, idempotencyKey: crypto.randomUUID() };
      }
      await updateOrder(order.id, submission.current);
      submission.current = null; setUncertain(false); setDone(true);
      navigate(`${BASE}/${order.id}`);
    } catch (error) {
      setUncertain(Boolean(error.ambiguous));
      if (!error.ambiguous) submission.current = null;
      setErrors({ [error.stage || 'save']: error.message || 'Order was not saved. Your draft is preserved; retry.' });
      requestAnimationFrame(() => summaryRef.current?.focus());
    } finally { saving.current = false; setBusy(false); }
  }

  const errList = Object.entries(errors).filter(([, m]) => m);
  const rate = (key, label) => <input aria-label={`${label} rate (INR per unit)`} inputMode="decimal" value={pricing[key] ?? ''} onChange={(e) => setP({ [key]: e.target.value })} placeholder="Not entered" />;
  const count = (k, label) => <input aria-label={`${label} count`} inputMode="numeric" value={v[k]} onChange={(e) => set({ [k]: e.target.value })} placeholder="Count" />;

  return <AdminLayout title="KITS & CONSUMABLES"><div className="kits order-entry kits-entry kito">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / Kits &amp; Consumables</p><h1>Edit order {order.number}</h1>
      <p className="admin-page-head__description">Saved date: {date(order.date)}. Historical people, shipping and billing stay as saved unless you change them.</p></div>
      <Link href={`${BASE}/${order.id}`} className="admin-button admin-button--secondary"><ArrowLeft size={15} aria-hidden="true" />Back</Link></div>
    {!protectedOk && <p role="alert" className="kits-error">Pricing is restricted to Super Admin. Editing is unavailable.</p>}
    {done && <p role="status" className="kito-done">Order saved. <Link href={`${BASE}/${order.id}`} className="kits-link">View order</Link></p>}
    {errList.length > 0 && <div className="kits-errors" role="alert" tabIndex={-1} ref={summaryRef}><strong>{errors.save ? 'Order save needs attention' : 'Fix before saving'}</strong>
      <ul>{errList.map(([k, m]) => <li key={k}>{m}</li>)}</ul>
      <a href={`${BASE}/${order.id}`} target="_blank" rel="noopener noreferrer" className="kits-link">Compare saved order in a separate tab (keeps this draft)</a></div>}
    <fieldset className="kits-layout kits-form-fields" disabled={!protectedOk || frozen}>
      <div className="kits-main">
        <section className="admin-panel kits-panel" aria-labelledby="kito-items"><h2 id="kito-items">Order details</h2>
          <label className="kits-field">Order for<select value={v.orderFor} onChange={(e) => set({ orderFor: e.target.value })}><option value="doctor">Doctor</option><option value="mr">MR</option></select></label>
          <div className="kito-scroll" tabIndex={0} role="region" aria-label="Order items and rates">
            <table className="kito-table"><thead><tr><th>Test</th><th>Products</th><th>ml</th><th>Quantity</th><th>Rate</th><th>Line amount</th></tr></thead>
              <tbody>
                <tr><th scope="row">Stallergo Skin Prick Kit</th>
                  <td><select aria-label="Kit product" value={v.kit.product} onChange={(e) => setKit(e.target.value ? { product: e.target.value, custom: e.target.value === 'Customized' ? v.kit.custom : '' } : { product: '', custom: '', volume: '', quantity: '' })}><option value="">No kit</option>{KIT_PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select>
                    {v.kit.product === 'Customized' && <input aria-label="Custom value" value={v.kit.custom} onChange={(e) => setKit({ custom: e.target.value })} />}</td>
                  <td><input aria-label="Kit volume (ml)" inputMode="decimal" value={v.kit.volume} onChange={(e) => setKit({ volume: e.target.value })} /></td>
                  <td><input aria-label="Kit quantity" inputMode="numeric" value={v.kit.quantity} onChange={(e) => setKit({ quantity: e.target.value })} /></td>
                  <td>{rate('kitRate', 'Kit')}</td><td>{L.kit ? moneyText(L.kit) : '-'}</td></tr>
                {[['lancets', 'Lancets', 'lancetsRate'], ['applicators', 'Applicators', 'applicatorsRate'], ['tray', 'Tray', 'trayRate']].map(([k, l, r]) =>
                  <tr key={k}><th scope="row">{l}</th><td>{count(k, l)}</td><td /><td /><td>{rate(r, l)}</td><td>{L[k] ? moneyText(L[k]) : '-'}</td></tr>)}
              </tbody></table></div>
          {calc.error && <Err text={calc.error} />}
          <div className="kito-fin">
            <div className="kits-field"><label htmlFor="kito-fwd">Forwarding charges</label><input id="kito-fwd" inputMode="decimal" value={pricing.forwardingCharges} onChange={(e) => setP({ forwardingCharges: e.target.value })} /></div>
            <div className="kits-field"><label htmlFor="kito-dv">Discount</label><div className="kito-disc"><input id="kito-dv" inputMode="decimal" value={pricing.discountValue} onChange={(e) => setP({ discountValue: e.target.value })} />
              <select aria-label="Discount type" value={pricing.discountType} onChange={(e) => setP({ discountType: e.target.value })}><option value="percent">%</option><option value="inr">Fixed INR</option></select></div></div>
          </div>
          <dl className="kpr-totals" aria-live="polite" data-testid="kits-editor-totals">
            {[['Gross value', 'gross'], ['Discount', 'discountAmount'], ['Discounted value', 'discounted'], ['Taxable value', 'taxable'], [`GST (${tax}%)`, 'gst']].map(([l, k]) => <div key={k}><dt>{l}</dt><dd>{snap ? moneyText(snap[k]) : '-'}</dd></div>)}
            <div className="kpr-total"><dt>Total amount</dt><dd>{snap ? moneyText(snap.total) : '-'}</dd></div></dl>
          <p className="kits-hint">{order.pricing ? 'Preview only; the server recalculates every total on save.' : 'Not yet priced. Enter rates to price this order; the server recalculates totals on save.'}</p>
          <p className="kits-hint">Quantity × unit rate for each included item, plus forwarding = gross. Discount is applied once to gross; discounted value is taxable. GST is added last. Products and ml do not multiply prices.</p>
        </section>
        <section className="admin-panel kits-panel" aria-labelledby="kito-more"><h2 id="kito-more">Remarks and attachments</h2>
          <div className="kits-field"><label htmlFor="kito-remarks">Remarks</label><textarea id="kito-remarks" rows={3} maxLength={4000} value={v.remarks} onChange={(e) => set({ remarks: e.target.value })} /></div>
          <h3 className="kito-sub">Retained attachments</h3>
          <OrderFileList empty="No attachments saved.">{(v.attachments || []).map((f) => <DownloadOrderFile key={f.id} file={f} allowed={can.read_attachment} download={downloadAttachment} status="Saved attachment, retained" locked />)}</OrderFileList>
        </section>
        <section className="admin-panel kits-panel" aria-labelledby="kito-bp"><h2 id="kito-bp">Parking and PO</h2>
          <div className="kits-grid">
            <div className="kits-field"><label htmlFor="kito-parking">Business Parking (INR)</label><input id="kito-parking" inputMode="decimal" aria-invalid={Boolean(errors.parking)} aria-describedby="kito-parking-hint" value={parking} onChange={(e) => setParking(e.target.value)} placeholder="Not entered" /></div>
            <div className="kits-field"><label htmlFor="kito-po">PO Number (optional)</label><input id="kito-po" maxLength={200} value={po} onChange={(e) => setPo(e.target.value)} placeholder="Enter PO number" /></div>
          </div><p id="kito-parking-hint" className="kits-hint">Independently entered amount. Not a commission, deduction or part of the order total.</p></section>
      </div>
      <div className="kits-side">
        <section className="admin-panel kits-panel"><h2>Doctor details</h2>
          <div className="kits-grid">
            <KitsReferenceSelect historicalPerson={order.doctor} showClearAction={false} disabled={frozen} id="kito-doctorId" kind="doctors" label="Doctor (billing)" value={v.doctorId} onChange={(x) => set({ doctorId: x })} onPerson={setDoctor} />
            <KitsReferenceSelect historicalPerson={order.mr} disabled={frozen} id="kito-mrId" kind="mrs" label="MR" value={v.mrId} onChange={(x) => set({ mrId: x })} onPerson={setMr} />
            <KitsReferenceSelect historicalPerson={order.patient} disabled={frozen} id="kito-patientId" kind="patients" label="Patient (optional)" value={v.patientId} onChange={(x) => set({ patientId: x })} />
            <p className="kits-hint">Saved: {order.doctor?.name || '-'} / MR {order.mr?.name || 'none'} / Patient {order.patient?.name || 'none'}. Only a changed selection replaces the historical person.</p>
          </div></section>
        <section className="admin-panel kits-panel"><h2>Shipping details</h2>
          <fieldset className="kits-radios"><legend>Ship to</legend>
            {[['doctor', 'Doctor'], ['mr', 'MR'], ['other', 'Other']].map(([s, l]) => <label key={s}><input type="radio" name="kito-ship" checked={v.shipping === s} onChange={() => set({ shipping: s })} />{l}</label>)}</fieldset>
          {v.shipping === 'other' ? <div className="kits-grid">{[['name', 'Name'], ['phone', 'Phone no.']].map(([k, l]) => <div className="kits-field" key={k}><label htmlFor={`kito-o-${k}`}>{l}</label><input id={`kito-o-${k}`} value={v.other[k]} onChange={(e) => set({ other: { ...v.other, [k]: e.target.value } })} /></div>)}
            {[['line1', 'Address line 1'], ['line2', 'Address line 2'], ['landmark', 'Landmark'], ['country', 'Country'], ['state', 'State'], ['city', 'City'], ['pincode', 'Pincode']].map(([k, l]) => <div className="kits-field" key={k}><label htmlFor={`kito-o-${k}`}>{l}</label><input id={`kito-o-${k}`} value={v.other.address[k]} onChange={(e) => set({ other: { ...v.other, address: { ...v.other.address, [k]: e.target.value } } })} /></div>)}</div>
            : <Facts person={recipient} empty="Address unavailable." />}
        </section>
        <section className="admin-panel kits-panel"><h2>Billing details</h2><p className="kits-hint">Always the billing doctor, independent of shipping.</p><Facts person={billing} empty="Billing doctor unavailable." /></section>
      </div>
    </fieldset>
    <div className="kits-actions"><button type="button" className="admin-button" disabled={!protectedOk || busy || done} onClick={save}>{busy ? 'Saving…' : uncertain ? 'Retry unchanged save' : 'Save changes'}</button>
      {!busy && !uncertain && !done && <Link href={`${BASE}/${order.id}`} className="admin-button admin-button--secondary">Cancel</Link>}</div>
  </div></AdminLayout>;
}
