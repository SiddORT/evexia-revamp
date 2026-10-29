import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { containDialogTab } from './dialogKeyboard.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import { fetchShipmentDetails, TYPE_LABELS } from '../../services/serverShipments.js';
import '../../poActivityDrawer.css';
import '../../inventoryServer.css';
import './ShipmentDetailsDrawer.css';

const NA = <span className="shipment-na">Unavailable</span>;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_KEY = /(^date|Date|At)$/;
// Internal identifiers/evidence keys rendered elsewhere or not business facts.
const SKIP = new Set(['shipment', 'shipmentHistory', 'decisionEligibility', 'mrEditable', 'number', 'date', 'status']);
const SECTION_ORDER = [
  ['Doctor, MR & patient', ['doctor', 'mr', 'patient', 'patients', 'patientCount']],
  ['Allergens, items & quantities', ['groups', 'items', 'lines', 'allergens', 'products']],
  ['Billing & payment', ['billing', 'billTo', 'pricing', 'payment', 'price', 'amount', 'subtotal', 'tax', 'discount', 'total', 'totalMinor']],
  ['Shipping details', ['recipient', 'shipping', 'shipTo', 'address']],
  ['Remarks', ['remarks', 'notes', 'note', 'comments']],
];

const label = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function useValue() {
  const { date, timestamp } = useAdminDateFormatters();
  return function Value({ v, k = '' }) {
    if (v === null || v === undefined || v === '') return NA;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'number') return <span className="shipment-mono">{String(v)}</span>;
    if (typeof v === 'string') {
      if (DATE_KEY.test(k)) {
        if (ISO_DATE.test(v)) return date(v);
        if (ISO_TS.test(v)) return timestamp(v);
      }
      return v;
    }
    if (Array.isArray(v)) {
      if (!v.length) return <span className="shipment-na">None saved</span>;
      if (v.every((x) => x === null || typeof x !== 'object')) return v.map((x) => (x == null ? 'Unavailable' : String(x))).join(', ');
      // Nested groups and patient/item snapshots vary by order type. Stacked
      // records keep every saved field readable without nested sideways tables.
      return <ol className="shipment-drawer__records">{v.map((row, i) =>
        <li key={i}><Value v={row} /></li>)}</ol>;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) return NA;
      return <dl className="shipment-drawer__nested">{keys.map((k) => <div key={k} className={v[k] && typeof v[k] === 'object' ? 'shipment-drawer__field-group' : undefined}><dt>{label(k)}</dt><dd><Value k={k} v={v[k]} /></dd></div>)}</dl>;
    }
    return String(v);
  };
}

export default function ShipmentDetailsDrawer({ row, onClose, returnFocusTo }) {
  const { date, timestamp } = useAdminDateFormatters();
  const Value = useValue();
  const dialogRef = useRef(null);
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = returnFocusTo || document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close(); document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    const c = new AbortController();
    setState({ data: null, loading: true, error: '' });
    fetchShipmentDetails(row, c.signal)
      .then((data) => { if (!c.signal.aborted) setState({ data, loading: false, error: '' }); })
      .catch((e) => { if (!c.signal.aborted) setState({ data: null, loading: false, error: e?.message || 'Shipment details could not be loaded.' }); });
    return () => c.abort();
  }, [row, tick]);

  function closeOnBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const b = event.currentTarget.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose();
  }

  const rec = state.data?.record;
  const order = state.data?.order && typeof state.data.order === 'object' ? state.data.order : null;
  const used = new Set();
  const patientItems = Array.isArray(order?.patients) && order.patients.some((p) => p && typeof p === 'object' && ('allergens' in p || 'items' in p));
  const plan = SECTION_ORDER.map(([t, keys]) => [t, patientItems ? (t === 'Allergens, items & quantities' ? ['patients', ...keys] : keys.filter((x) => x !== 'patients')) : keys]);
  const sections = order ? plan.map(([title, keys]) => {
    const present = keys.filter((k) => Object.prototype.hasOwnProperty.call(order, k) && !used.has(k));
    present.forEach((k) => used.add(k));
    return [title, present];
  }) : [];
  const rest = order ? Object.keys(order).filter((k) => !used.has(k) && !SKIP.has(k)) : [];
  const fact = (t, v) => <div><dt>{t}</dt><dd>{v}</dd></div>;
  const opt = (v, f = (x) => x) => (v ? f(v) : NA);

  return <dialog ref={dialogRef} className="po-activity-drawer shipment-drawer" aria-labelledby="shipment-drawer-heading" aria-describedby="shipment-drawer-description"
    onKeyDown={containDialogTab} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={closeOnBackdrop} data-testid="drawer-shipment-detail">
    <header className="po-activity-drawer__header">
      <div><p className="po-activity-drawer__number shipment-mono">{row.number} · {TYPE_LABELS[row.type] || row.type}</p><h2 id="shipment-drawer-heading">Shipment details</h2></div>
      <button type="button" className="po-action po-activity-drawer__close" onClick={onClose} autoFocus aria-label="Close shipment details" title="Close shipment details" data-testid="button-close-shipment-detail"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="po-activity-drawer__body" tabIndex={0} role="region" aria-label="Shipment detail content">
      <p id="shipment-drawer-description" className="po-activity-drawer__description">Order, people, items and delivery information. All values are shown as saved.</p>
      {state.loading && <div role="status" className="admin-empty shipment-drawer__skeleton"><span /><span /><span /><strong>Loading shipment details…</strong></div>}
      {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)} data-testid="button-retry-shipment-detail">Retry</button></div>}
      {rec && <>
        <section className="inv-drawer-section shipment-drawer__overview"><h3>Order overview</h3>
          <dl className="stock-report__meta">
            {fact('Order number', <span className="shipment-mono">{rec.number}</span>)}
            {fact('Order date', opt(rec.date, date))}
            {fact('Type', TYPE_LABELS[rec.type] || rec.type)}
            {fact('Value', rec.value != null ? <span className="shipment-mono">{rec.value}</span> : NA)}
            {fact('Status', rec.status || NA)}
            {fact('Payment', rec.paymentStatus || NA)}
          </dl>
        </section>
        <section className="inv-drawer-section shipment-drawer__delivery"><h3>Shipment & delivery</h3>
          <dl className="stock-report__meta">
            {fact('Recipient', rec.recipient || NA)}
            {fact('Shipping address', rec.address || NA)}
            {fact('Courier', rec.courier || NA)}
            {fact('Tracking ID', rec.trackingId ? <span className="shipment-mono">{rec.trackingId}</span> : NA)}
            {fact('Shipped', opt(rec.shippedAt, timestamp))}
            {fact('Expected delivery', opt(rec.expectedDeliveryDate, date))}
            {fact('Actual delivery', opt(rec.actualDeliveryDate, date))}
          </dl>
        </section>
      </>}
      {state.data && !order && <p className="shipment-na">Saved order details are unavailable.</p>}
      {order && <>
        {sections.filter(([, keys]) => keys.length).map(([title, keys]) => <section key={title} className="inv-drawer-section"><h3>{title}</h3>
          <dl className="shipment-drawer__nested">{keys.map((k) => <div key={k} className={order[k] && typeof order[k] === 'object' ? 'shipment-drawer__field-group' : undefined}><dt>{label(k)}</dt><dd><Value k={k} v={order[k]} /></dd></div>)}</dl>
        </section>)}
        {order.shipmentHistory?.length > 0 && <details className="inv-drawer-section shipment-drawer__additional"><summary>Earlier shipment records</summary><Value v={order.shipmentHistory} /></details>}
        {rest.length > 0 && <details className="inv-drawer-section shipment-drawer__additional"><summary>Additional saved details</summary>
          <dl className="shipment-drawer__nested">{rest.map((k) => <div key={k}><dt>{label(k)}</dt><dd><Value k={k} v={order[k]} /></dd></div>)}</dl>
        </details>}
      </>}
    </div>
  </dialog>;
}
