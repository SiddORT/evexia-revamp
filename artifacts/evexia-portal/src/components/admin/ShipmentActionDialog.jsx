import { useState } from 'react';
import Dialog from './Dialog.jsx';
import RemoteSelect from './RemoteSelect.jsx';
import { fetchCourierPage, mutationPath, sendFrozen, todayISO, isoDatePart, TYPE_LABELS } from '../../services/serverShipments.js';

const COPY = {
  ship: { title: 'Mark as shipped', eyebrow: 'Shipment', action: 'Mark shipped' },
  delivery: { title: 'Record actual delivery', eyebrow: 'Shipping details', action: 'Save delivery date' },
  return: { title: 'Mark as returned', eyebrow: 'Please confirm', action: 'Mark returned' },
};

function validate(mode, form, row) {
  const errors = {};
  const today = todayISO();
  const orderDate = isoDatePart(row.date);
  const shippedOn = isoDatePart(row.shippedAt);
  if (mode === 'ship') {
    if (!form.courier) errors.courier = 'Choose an active courier partner.';
    if (!form.tracking.trim()) errors.tracking = 'Enter the tracking ID.';
    else if (form.tracking.trim().length > 100) errors.tracking = 'Tracking ID must be 100 characters or fewer.';
    if (!form.expected) errors.expected = 'Enter the expected delivery date.';
    else if (form.expected < today) errors.expected = 'Expected delivery cannot be before shipment (today).';
    if (form.actual) {
      if (form.actual > today) errors.actual = 'Actual delivery cannot be in the future.';
      else if (form.actual < today) errors.actual = 'Actual delivery cannot be before the shipment (today).';
    }
  }
  if (mode === 'delivery') {
    if (!form.actual) errors.actual = 'Enter the actual delivery date.';
    else if (form.actual > today) errors.actual = 'Actual delivery cannot be in the future.';
    else if (shippedOn && form.actual < shippedOn) errors.actual = 'Actual delivery cannot be before the shipment date.';
  }
  return errors;
}

export default function ShipmentActionDialog({ mode, row, onClose, onDone, formatDate }) {
  const copy = COPY[mode];
  const [form, setForm] = useState({ courier: null, tracking: '', expected: '', actual: row.actualDeliveryDate || '' });
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  // Frozen request after an uncertain outcome: only the exact same body/key may be retried.
  const [frozen, setFrozen] = useState(null);
  const locked = pending || Boolean(frozen);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setErrors({}); };
  const today = todayISO();

  function build() {
    const base = { idempotency_key: crypto.randomUUID(), expected_version: row.version };
    if (mode === 'ship') return { ...base, courier_id: form.courier.value, tracking_id: form.tracking.trim(), expected_delivery_date: form.expected, actual_delivery_date: form.actual || null };
    if (mode === 'delivery') return { ...base, actual_delivery_date: form.actual };
    return base;
  }

  async function submit(event) {
    event?.preventDefault();
    if (pending) return;
    let request = frozen;
    if (!request) {
      const found = validate(mode, form, row);
      setErrors(found);
      if (Object.keys(found).length) return;
      request = { path: mutationPath(row, mode), body: build() };
    }
    setPending(true); setError('');
    try {
      const updated = await sendFrozen(request, row);
      setFrozen(null);
      onDone(updated);
    } catch (cause) {
      if (cause?.ambiguous) {
        setFrozen(request);
        setError(`${cause.message || 'The server response was not confirmed.'} The outcome is uncertain. Retry the identical request; it is safe and will not apply twice.`);
      } else {
        setFrozen(null);
        setError(cause?.message || 'The change was not saved.');
      }
    } finally { setPending(false); }
  }

  const footer = <>
    <button type="button" className="admin-button admin-button--secondary" disabled={locked} onClick={onClose} data-testid="button-cancel-shipment">Cancel</button>
    <button type="submit" form="shipment-action-form" disabled={pending}
      className={`admin-button${mode === 'return' ? ' admin-button--danger' : ''}`} data-testid={`button-submit-${mode}`}>
      {pending ? 'Saving…' : frozen ? 'Retry exact request' : copy.action}
    </button>
  </>;

  return <Dialog title={copy.title} eyebrow={copy.eyebrow} className="shipment-dialog" onClose={locked ? () => {} : onClose} footer={footer}
    description={mode === 'return' ? `Mark ${row.number} as Returned. Courier, tracking and delivery details are kept. No stock, payment or clinical changes are made.` : undefined}>
    <form id="shipment-action-form" className="shipment-dialog__form" onSubmit={submit} noValidate>
      <dl className="shipment-dialog__summary">
        <div><dt>Order</dt><dd data-testid="text-dialog-order">{row.number}</dd></div>
        <div><dt>Type</dt><dd>{TYPE_LABELS[row.type] || row.type}</dd></div>
        <div><dt>Order date</dt><dd>{formatDate(row.date)}</dd></div>
        {mode !== 'ship' && <div><dt>Courier</dt><dd>{row.courier || 'Unavailable'}{row.trackingId && <span className="shipment-sub">{row.trackingId}</span>}</dd></div>}
      </dl>
      {mode === 'ship' && <>
        <div className="kits-field shipment-dialog__field">
          <span id="ship-courier-label">Courier partner <em>Required</em></span>
          <RemoteSelect id="ship-courier" label="Courier partner" value={form.courier?.value || ''} selected={form.courier} fetchPage={fetchCourierPage}
            onChange={(item) => set({ courier: item })} placeholder="Search active couriers" invalid={errors.courier} disabled={locked} required describedBy={errors.courier ? 'ship-courier-error' : undefined} emptyText="No active courier partners match." />
          {errors.courier && <span id="ship-courier-error" className="shipment-error">{errors.courier}</span>}
        </div>
        <label className="kits-field shipment-dialog__field">
          <span>Tracking ID <em>Required</em></span>
          <input value={form.tracking} maxLength={100} disabled={locked} aria-invalid={Boolean(errors.tracking)} onChange={(e) => set({ tracking: e.target.value })} data-testid="input-tracking-id" />
          {errors.tracking && <span className="shipment-error">{errors.tracking}</span>}
        </label>
        <div className="shipment-dialog__dates">
          <label className="kits-field shipment-dialog__field">
            <span>Expected delivery date <em>Required</em></span>
            <input type="date" value={form.expected} min={today} disabled={locked} aria-invalid={Boolean(errors.expected)} onChange={(e) => set({ expected: e.target.value })} data-testid="input-expected-delivery" />
            {errors.expected && <span className="shipment-error">{errors.expected}</span>}
          </label>
          <label className="kits-field shipment-dialog__field">
            <span>Actual delivery date <em>Optional until known</em></span>
            <input type="date" value={form.actual} min={today} max={today} disabled={locked} aria-invalid={Boolean(errors.actual)} onChange={(e) => set({ actual: e.target.value })} data-testid="input-actual-delivery" />
            {errors.actual && <span className="shipment-error">{errors.actual}</span>}
          </label>
        </div>
      </>}
      {mode === 'delivery' && <label className="kits-field shipment-dialog__field">
        <span>Actual delivery date <em>Required</em></span>
        <input type="date" value={form.actual} min={isoDatePart(row.shippedAt) || undefined} max={today} disabled={locked} aria-invalid={Boolean(errors.actual)} onChange={(e) => set({ actual: e.target.value })} data-testid="input-actual-delivery" />
        {errors.actual && <span className="shipment-error">{errors.actual}</span>}
        <span className="shipment-sub">Expected: {row.expectedDeliveryDate ? formatDate(row.expectedDeliveryDate) : 'Unavailable'}. The status stays Shipped.</span>
      </label>}
      {error && <div className={`admin-feedback ${frozen ? 'admin-feedback--warning' : 'admin-feedback--error'}`} role="alert" data-testid="status-shipment-error">{error}</div>}
    </form>
  </Dialog>;
}
