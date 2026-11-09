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
      <section className="ms-config-source" aria-labelledby="reserve-product-name">
        <p className="ms-config-caption">Source reserve</p>
        <h3 id="reserve-product-name" data-testid="text-reserve-product">{lot.productName}</h3>
        <dl className="ms-config-meta">
          <div><dt>Source</dt><dd>{sourceName}</dd></div>
          <div><dt>Batch</dt><dd>{lot.batchNo || 'unavailable'}</dd></div>
          <div className="ms-config-meta__identifier"><dt>Reserve identifier</dt><dd>{lot.reserveId || lot.id}</dd></div>
          <div><dt>Concentration</dt><dd>{lot.concentration || 'unavailable'}</dd></div>
          <div><dt>Available quantity</dt><dd>{lot.available} {lot.unit || 'ml'}</dd></div>
          <div><dt>Expiry</dt><dd>{lot.expiryDate ? displayDate(lot.expiryDate) : 'unavailable'}</dd></div>
        </dl>
      </section>
      <section className="ms-config-fields" aria-labelledby="reserve-configuration-heading">
        <h3 id="reserve-configuration-heading" className="ms-config-heading">Configure transfer</h3>
        <div className="ms-config-controls">
          <div className="ms-config-field">
            <label htmlFor="reserve-source-quantity">Source input quantity ({lot.unit || 'ml'})</label>
            <input id="reserve-source-quantity" className="mr-form__control" inputMode="decimal" autoComplete="off" value={draft.quantity}
              onChange={(e) => change({ quantity: e.target.value })} aria-invalid={Boolean(errors.quantity)} aria-describedby={errors.quantity ? 'reserve-quantity-error' : undefined} data-testid="input-reserve-quantity" />
            {errors.quantity && <p id="reserve-quantity-error" className="mr-form__error" role="alert">{errors.quantity}</p>}
          </div>
          <fieldset className="ms-dilute" aria-invalid={Boolean(errors.dilute)} aria-describedby={errors.dilute ? 'reserve-dilute-error' : undefined}>
            <legend>Dilute this in-house reserve?</legend>
            <div className="ms-dilute__choices">{[[true, 'Yes'], [false, 'No']].map(([value, text]) => <label key={text} className={draft.dilute === value ? 'ms-dilute__choice--selected' : undefined}>
              <input type="radio" name="reserve-dilution" checked={draft.dilute === value} onChange={() => change({ dilute: value, factor: value ? draft.factor : '' })}
                aria-invalid={Boolean(errors.dilute)} aria-describedby={errors.dilute ? 'reserve-dilute-error' : undefined} data-testid={`radio-reserve-dilution-${text.toLowerCase()}`} />{text}</label>)}</div>
            {draft.dilute === true && <div className="ms-config-field ms-config-factor">
              <label htmlFor="reserve-factor">Dilution factor</label><select id="reserve-factor" className="mr-form__control" value={draft.factor}
                onChange={(e) => change({ factor: e.target.value })} aria-invalid={Boolean(errors.dilute)} aria-describedby={errors.dilute ? 'reserve-dilute-error' : undefined} data-testid="select-reserve-factor">
                <option value="">Select factor</option>{[2, 5, 10].map((f) => <option key={f} value={f}>{f}-fold</option>)}</select>
            </div>}
            {errors.dilute && <p id="reserve-dilute-error" className="mr-form__error" role="alert">{errors.dilute}</p>}
          </fieldset>
        </div>
      </section>
      <div className="ms-config-summary" role="status" aria-atomic="true" data-testid="status-reserve-output">
        <h3 className="ms-config-heading">Output preview</h3>
        {calculated.output
          ? <><dl className="ms-config-output">
              <div><dt>Output quantity</dt><dd>{calculated.output.quantity} <span>{lot.unit || 'ml'}</span></dd></div>
              <div><dt>Output concentration</dt><dd>{calculated.output.concentration}</dd></div>
            </dl>
            <div className="ms-config-policy">
              {draft.dilute
                ? <><p>Quantity × fold · concentration ÷ fold.</p><p><strong>Expiry:</strong> Two calendar years after the movement date.</p></>
                : <><p><strong>Not diluted · remains reserve-only.</strong></p><p>Concentration and expiry unchanged.</p></>}
              <p><strong>Source deducted:</strong> {String(draft.quantity).trim()} {lot.unit || 'ml'} only.</p>
            </div></>
          : <p className="ms-config-policy">{Object.values(calculated.errors)[0] || 'Enter quantity and choose Yes or No to calculate output.'}</p>}
      </div>
    </div>
  </Dialog>;
}
