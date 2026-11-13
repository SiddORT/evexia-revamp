import { moneyText } from '../../services/kitsPricing.js';
import { useEffect, useState } from 'react';
import { loadKitsGST } from '../../services/serverKits.js';

function CurrentGST() {
  const [evidence, setEvidence] = useState(null), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setEvidence(null); setError('');
    loadKitsGST(null, controller.signal).then(setEvidence).catch((cause) => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return () => controller.abort();
  }, [refresh]);
  return <p className="kits-hint" role={error ? 'alert' : 'status'}>
    {evidence ? `Today's applicable policy (${evidence.order_date}): ${evidence.rate}%. This is not the GST charged on this saved order.`
      : error ? `Today's applicable policy is unavailable. ${error}` : "Loading today's applicable GST policy…"}
    <button type="button" className="kits-link" onClick={() => setRefresh((n) => n + 1)}>Refresh current policy</button>
  </p>;
}

function AdditionalInformation({ order }) {
  return <section className="kpr-additional" aria-label="Parking and PO">
    <h3>Parking and PO</h3>
    <p className="kits-hint">Business Parking is an independent amount, not a deduction or part of the order total.</p>
    <dl className="kpr-totals kpr-extra">
      <div><dt>Business Parking</dt><dd>{order.businessParking == null ? 'Not set' : moneyText(order.businessParking)}</dd></div>
      <div><dt>PO Number</dt><dd>{order.poNumber || '-'}</dd></div>
    </dl>
  </section>;
}

export default function KitsPricingSummary({ order }) {
  const p = order?.pricing;
  const k = order?.kit || {};
  if (!p) return <div className="kpr kpr-empty" data-testid="kits-pricing-unpriced"><p>Not yet priced. No historical totals have been assumed.</p>
    <p>Actual applied GST: unavailable — no saved pricing evidence.</p><CurrentGST />
    <AdditionalInformation order={order} /></div>;
  const L = p.lineAmounts || {};
  const rows = [];
  if (k.product || k.volume || k.quantity) rows.push(['Stallergo Skin Prick Kit', k.product === 'Customized' ? `Customized (${k.custom})` : k.product, k.volume, k.quantity, p.kitRate, L.kit]);
  if (order.lancets) rows.push(['Lancets', '', '', order.lancets, p.lancetsRate, L.lancets]);
  if (order.applicators) rows.push(['Applicators', '', '', order.applicators, p.applicatorsRate, L.applicators]);
  if (order.tray) rows.push(['Tray', '', '', order.tray, p.trayRate, L.tray]);
  const disc = p.discountType === 'percent' ? `${p.discountValue}%` : moneyText(p.discountValue);
  return <div className="kpr" data-testid="kits-pricing-summary">
    <div className="kpr-scroll" tabIndex={0} role="region" aria-label="Priced items">
      <table className="kpr-table"><thead><tr><th scope="col">Test</th><th scope="col">Products</th><th scope="col">ml</th><th scope="col">Quantity</th><th scope="col">Rate</th><th scope="col">Line amount</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1] || '-'}</td><td>{r[2] || '-'}</td><td>{r[3] || '-'}</td><td>{r[4] ? moneyText(r[4]) : '-'}</td><td>{r[5] ? moneyText(r[5]) : '-'}</td></tr>)}</tbody></table></div>
    <section className="kpr-breakdown" aria-label="Pricing totals"><h3>Pricing totals</h3>
    <dl className="kpr-totals">
      <div><dt>Forwarding charges</dt><dd>{moneyText(p.forwardingCharges)}</dd></div>
      <div><dt>Gross value</dt><dd>{moneyText(p.gross)}</dd></div>
      <div><dt>Discount ({disc})</dt><dd>{moneyText(p.discountAmount)}</dd></div>
      <div><dt>Discounted value</dt><dd>{moneyText(p.discounted)}</dd></div>
      <div><dt>Taxable value</dt><dd>{moneyText(p.taxable)}</dd></div>
      <div><dt>{p.taxPercentage == null ? 'Actual applied GST: rate unavailable' : `Actual applied GST (${p.taxPercentage}%)`}</dt><dd>{moneyText(p.gst)}</dd></div>
      <div className="kpr-total"><dt>Total amount</dt><dd>{moneyText(p.total)}</dd></div>
    </dl>
    <p className="kits-hint">{p.gstPolicy ? `Saved GST policy revision ${p.gstPolicy.policy_revision} · Effective from ${p.gstPolicy.applicable_from === '0001-01-01' ? 'opening period' : p.gstPolicy.applicable_from} · Order date ${p.gstPolicy.order_date}.`
      : 'Policy revision and effective boundary were not saved with this historical price. The saved rate and amounts above are actual order evidence, not inferred from current policy.'}</p>
    <CurrentGST /></section>
    <AdditionalInformation order={order} />
  </div>;
}
