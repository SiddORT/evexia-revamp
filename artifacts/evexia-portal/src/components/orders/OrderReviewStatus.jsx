function lifecycleLabel(order) {
  if (order.status === 'Rejected') return 'Rejected · reason and corrections in View';
  if (order.approval) return `Approved · ${order.status}`;
  if (['Confirmed', 'Saved'].includes(order.status)) return `${order.status} · Awaiting review`;
  return order.status;
}

export function reviewLabel(order) {
  return `${order.freeKit?.classification === 'Free kit' ? 'Free kit · ' : ''}${lifecycleLabel(order)}`;
}

export default function OrderReviewStatus({ order, compact = false }) {
  return <div className="order-review-status">
    <p role="status">{reviewLabel(order)}</p>
    {!compact && order.pricingState === 'Pending pricing' && <p>Pending pricing · amount not recorded. Not a payment or approval.</p>}
    {order.status === 'Rejected' && <div>
      <strong>Rejection reason</strong>
      <p className="order-review-reason">{order.rejection?.reason || 'Reason unavailable for this historical rejection.'}</p>
      {!compact && <p>{order.freeKit ? 'This Free kit remains locked. Its allowance is not refunded; correction and resubmission are unavailable.' : 'Saving corrections keeps this order Rejected. Only an explicit Resubmit for review sends it back to Admin.'}</p>}
    </div>}
    {order.reviewHistory?.length > 0 && <details><summary>Review history</summary>
      <ol>{order.reviewHistory.map((entry, index) => <li key={index}>
        {entry.decision === 'approve' ? 'Approved' : entry.decision === 'resubmit' ? 'Resubmitted for review' : 'Rejected'}
        {entry.at ? ` · ${entry.at}` : entry.rejectedAt ? ` · ${entry.rejectedAt}` : ' · Date unavailable'}
        {(entry.reason || entry.decision === 'reject') && <p className="order-review-reason">{entry.reason || 'Reason unavailable for this historical rejection.'}</p>}
      </li>)}</ol>
    </details>}
  </div>;
}
