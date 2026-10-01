import { Link } from 'wouter';
import { rollupPOReceiving, createPRState } from '../../services/poReceivingRollup.js';
import { getPOBalances } from '../../services/purchaseReceived.js';
import '../../purchaseReceived.css';
import '../../poReceivingDetail.css';

const date = (d) => d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const stamp = (d) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const BASE = '/admin/inventory/purchase-received';

export default function POReceivingSection({ order, receipts }) {
  const linked = receipts.filter((r) => r.poId === order.id);
  const balances = getPOBalances(order, linked);
  let roll;
  try { roll = rollupPOReceiving(order, linked, balances); }
  catch (cause) { return <section className="porx admin-feedback admin-feedback--error" role="alert"><h3>Receiving details are unavailable</h3><p>{cause.message || 'Saved quantities could not be read.'} Refresh this purchase order before continuing.</p></section>; }
  const create = createPRState(order, roll);
  const enc = encodeURIComponent(order.id);
  return <section className="porx" aria-label="Receiving" data-testid="section-po-receiving">
    <div className="porx-head">
      <h3 className="po-section-title">Receiving <span>Active receipts only count toward fulfillment</span></h3>
      <div className="po-actions">
        <Link href={`${BASE}?poId=${enc}`} className="admin-button admin-button--secondary" data-testid="link-view-all-prs">View all PRs ({linked.length})</Link>
        {create.enabled ? <Link href={`${BASE}/new?poId=${enc}`} className="admin-button" data-testid="link-create-pr">Create PR</Link>
          : <button type="button" className="admin-button" disabled data-testid="button-create-pr-disabled">Create PR</button>}
      </div>
    </div>
    {!create.enabled && <p className="porx-reason" role="note" data-testid="text-create-pr-reason">{create.reason}</p>}
    <div className="pr-grid" role="region" tabIndex={0} aria-label="Remaining quantities by order line"><table>
      <thead><tr><th>Sr. No.</th><th>Product</th><th>Ordered</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Remaining</th></tr></thead>
      <tbody>{roll.lines.map((l, i) => <tr key={l.lineId} data-testid={`row-po-remaining-${i}`}><td>{i + 1}</td><td><strong>{l.productName}</strong><small>Line {l.lineId}</small></td><td>{l.ordered}</td><td>{l.received}</td><td>{l.accepted}</td><td>{l.rejected}</td><td><strong>{l.remaining}</strong></td></tr>)}</tbody>
    </table></div>
    <p className="mr-form__hint">Rejected quantities stay outstanding. Remaining = ordered minus accepted on active receipts.</p>
    <h3 className="po-section-title">Linked receipts <span>{linked.length} record{linked.length === 1 ? '' : 's'}, including deleted</span></h3>
    {!linked.length ? <div className="admin-empty"><strong>No receipts recorded</strong><p>No receiving history exists for this order.</p></div> :
      linked.map((r, idx) => <details key={r.id} className={`porx-card${r.status === 'deleted' ? ' porx-card--deleted' : ''}`} open={idx === 0} data-testid={`card-po-receipt-${r.id}`}>
        <summary><Link href={`${BASE}/${encodeURIComponent(r.id)}`} className="po-link"><strong>{r.number}</strong></Link><span>{date(r.receivedDate)}</span><span>By {r.receivedBy}</span><span className={`pr-tag${r.status === 'active' ? ' pr-tag--closed' : ''}`}>{r.status}</span></summary>
        <div className="porx-card__body">
          <dl className="pr-ctx"><div><dt>Saved source PO</dt><dd>{r.poNumber}</dd></div><div><dt>Receipt ID</dt><dd>{r.id}</dd></div><div><dt>Source PO ID</dt><dd>{r.poId}</dd></div><div><dt>Vendor ID</dt><dd>{r.vendorId}</dd></div><div><dt>Destination ID</dt><dd>{r.locationId}</dd></div></dl>
          {r.status === 'deleted' && <p className="pr-note pr-warn">Deleted receipt. Shown as history; excluded from current fulfillment.</p>}
          <dl className="pr-ctx"><div><dt>Vendor</dt><dd>{r.vendorName}<span className="po-secondary">{r.vendorPhone || 'No mobile on record'}</span></dd></div><div><dt>Destination</dt><dd>{r.locationName}</dd></div><div><dt>PO date</dt><dd>{date(r.poDate)}</dd></div>{r.vendorAddress && <div><dt>Supplier address</dt><dd>{r.vendorAddress}</dd></div>}{r.vendorGstNo && <div><dt>Supplier GST</dt><dd>{r.vendorGstNo}</dd></div>}<div><dt>Received by</dt><dd>{r.receivedBy}<span className="po-secondary">Local demo name, not verified</span></dd></div><div><dt>Created</dt><dd>{stamp(r.createdAt)}</dd></div><div><dt>Last changed</dt><dd>{stamp(r.updatedAt)}</dd></div>{r.deletedAt && <div><dt>Deleted</dt><dd>{stamp(r.deletedAt)}</dd></div>}</dl>
          <div className="pr-grid" style={{ marginTop: 10 }} role="region" tabIndex={0} aria-label={`Lines of ${r.number}`}><table>
            <thead><tr><th>Sr. No.</th><th>Product</th><th>Batch</th><th>Ordered</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Expiry</th><th>Balance after (historical)</th></tr></thead>
            <tbody>{r.lines.map((l, i) => <tr key={l.lineId}><td>{i + 1}</td><td><strong>{l.productName}</strong><small>Product ID: {l.productId}</small><small>Line {l.lineId}</small></td><td>{l.batchNo}</td><td>{l.orderedQty}</td><td>{l.receivedQty}</td><td>{l.acceptedQty}</td><td>{l.rejectedQty}</td><td>{date(l.expiryDate)}</td><td>{l.balanceAfterQty == null ? 'Unavailable' : l.balanceAfterQty}</td></tr>)}</tbody>
          </table></div>
        </div>
      </details>)}
  </section>;
}
