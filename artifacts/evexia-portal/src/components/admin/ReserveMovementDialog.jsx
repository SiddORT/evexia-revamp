import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { reserveConfiguration } from '../../services/reserveDilution.js';

export default function ReserveMovementDialog({ lot, sourceName, applied, onApply, onClose, returnFocusRef, displayDate }) {
  const [draft, setDraft] = useState({ quantity: applied.quantity, dilute: applied.dilute, factor: applied.factor });
  const [errors, setErrors] = useState({});
  const change = (patch) => { setDraft((d) => ({ ...d, ...patch })); setErrors({}); };
  const calculated = reserveConfiguration(lot, draft);
  const apply = () => {
    setErrors(calculated.errors);
    if (!Object.keys(calculated.errors).length) onApply(draft);
  };
  return <Dialog title="Configure in-house reserve" eyebrow="Move stock / Draft only" className="ms-config-dialog"
    description="Apply changes to this draft only. Stock changes only after server review and final confirmation."
    onClose={onClose} returnFocusRef={returnFocusRef}
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={onClose}>Cancel configuration</button>
      <button type="button" className="admin-button" onClick={apply}>Apply configuration</button></>}>
    <div className="ms-config-content">
      <p><strong>{lot.productName}</strong><span className="stock-sub">Source {sourceName} · Batch {lot.batchNo || 'unavailable'} · Reserve {lot.reserveId || lot.id}</span>
        <span className="stock-sub">Concentration {lot.concentration || 'unavailable'} · Available {lot.available} {lot.unit || 'ml'} · Exp {lot.expiryDate ? displayDate(lot.expiryDate) : 'unavailable'}</span></p>
      <label htmlFor="reserve-source-quantity">Source input quantity ({lot.unit || 'ml'})</label>
      <input id="reserve-source-quantity" className="mr-form__control" inputMode="decimal" autoComplete="off" value={draft.quantity}
        onChange={(e) => change({ quantity: e.target.value })} aria-invalid={Boolean(errors.quantity)} aria-describedby={errors.quantity ? 'reserve-quantity-error' : undefined} />
      {errors.quantity && <p id="reserve-quantity-error" className="mr-form__error" role="alert">{errors.quantity}</p>}
      <fieldset className="ms-dilute" aria-describedby={errors.dilute ? 'reserve-dilute-error' : undefined}>
        <legend>Dilute this in-house reserve?</legend>
        <div className="ms-dilute__choices">{[[true, 'Yes'], [false, 'No']].map(([value, text]) => <label key={text}>
          <input type="radio" name="reserve-dilution" checked={draft.dilute === value} onChange={() => change({ dilute: value, factor: value ? draft.factor : '' })} />{text}</label>)}</div>
        {draft.dilute === true && <><label htmlFor="reserve-factor">Dilution factor</label><select id="reserve-factor" className="mr-form__control" value={draft.factor}
          onChange={(e) => change({ factor: e.target.value })}><option value="">Select factor</option>{[2, 5, 10].map((f) => <option key={f} value={f}>{f}-fold</option>)}</select></>}
        {errors.dilute && <p id="reserve-dilute-error" className="mr-form__error" role="alert">{errors.dilute}</p>}
      </fieldset>
      <div className="ms-config-summary" role="status">{calculated.output
        ? <><strong>Output: {calculated.output.quantity} {lot.unit || 'ml'} at concentration {calculated.output.concentration}</strong>
          <p>{draft.dilute ? 'Source input × fold; concentration ÷ fold. Expiry is two calendar years after the movement date. Only source input is deducted.' : 'Not diluted. Concentration and expiry unchanged; remains reserve-only.'}</p></>
        : <p>{Object.values(calculated.errors)[0] || 'Enter quantity and choose Yes or No to calculate output.'}</p>}</div>
    </div>
  </Dialog>;
}
