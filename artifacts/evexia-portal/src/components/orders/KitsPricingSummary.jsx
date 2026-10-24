import { moneyText } from '../../services/kitsPricing.js';

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
      <div><dt>GST ({p.taxPercentage}%)</dt><dd>{moneyText(p.gst)}</dd></div>
      <div className="kpr-total"><dt>Total amount</dt><dd>{moneyText(p.total)}</dd></div>
    </dl></section>
    <AdditionalInformation order={order} />
  </div>;
}
