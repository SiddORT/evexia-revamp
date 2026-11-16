import { useEffect, useState } from 'react';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

const amount = (value) => value == null ? 'Pending pricing' : `₹${value}`;

export default function FinancialReview({ order, request, proposedValues, onEvidence, disabled }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const serialized = proposedValues ? JSON.stringify(proposedValues) : '';
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    onEvidence(null);
    setState({ loading: true, data: null, error: '' });
    const timer = window.setTimeout(async () => {
      try {
        const result = serialized
          ? (await request('/eligibility', { body: {
            orderId: order.id, values: { ...JSON.parse(serialized), expected_version: order.version, idempotencyKey: crypto.randomUUID() },
          }, signal: controller.signal })).financialReview
          : await request(`/${order.id}/financial-review`, { signal: controller.signal });
        guard();
        if (!result || result.orderId !== order.id || result.version !== order.version || typeof result.token !== 'string'
            || typeof result.outstanding !== 'string' || !Array.isArray(result.pendingPricingOrders)) {
          throw new Error('Financial evidence could not be confirmed for this saved version.');
        }
        if (alive) { setState({ loading: false, data: result, error: '' }); onEvidence(result); }
      } catch (cause) {
        if (alive) { setState({ loading: false, data: null, error: cause.message || 'Financial review unavailable.' }); onEvidence(null); }
      }
    }, serialized ? 700 : 0);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [order.id, order.version, serialized, revision, request, onEvidence]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !disabled) setRevision((n) => n + 1); };
    const timer = window.setInterval(refresh, 45000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [disabled]);
  const data = state.data;
  return <section aria-label="MR financial review">
    <h3>MR financial review</h3>
    <p>{serialized ? 'Proposed entry preview — save pricing before approval.' : `Saved version ${order.version}.`} Pricing alone does not approve the order.</p>
    <button type="button" className="admin-button admin-button--secondary" disabled={disabled || state.loading} onClick={() => setRevision((n) => n + 1)}>Refresh financial evidence</button>
    {state.loading && <p role="status">Loading saved orders, MR settings and committed payments…</p>}
    {state.error && <p role="alert">Financial evidence unavailable: {state.error} No unrestricted balance has been assumed. Retry the financial review.</p>}
    {data && <>
      <dl>
        <div><dt>MR Payment Limit</dt><dd>{amount(data.paymentLimit)}{data.paymentLimit === '0.00' ? ' · disabled' : ''}</dd></div>
        <div><dt>Existing priced unpaid exposure, excluding this order</dt><dd>{amount(data.outstanding)}</dd></div>
        <div><dt>{serialized ? 'Entered total' : 'Saved order total'}</dt><dd>{amount(data.proposedAmount)}</dd></div>
        <div><dt>Committed payments on this order</dt><dd>{amount(data.committedTargetPayments)}</dd></div>
        <div><dt>Resulting priced exposure</dt><dd>{amount(data.resultingExposure)}</dd></div>
      </dl>
      <p role="status">{data.amountLimitState === 'Reached' ? 'Payment limit exactly reached.'
        : data.amountLimitState === 'Exceeded' ? 'Payment limit exceeded.'
          : data.amountLimitState === 'Below limit' ? 'Priced exposure is below the payment limit.'
            : data.amountLimitState === 'Disabled' ? 'Amount restriction disabled.' : 'Order is pending pricing.'}
        {' '}Amount warnings do not automatically reject this order. Admin must make an explicit decision with a reason.</p>
      {data.pendingPricingOrders.length > 0 ? <div role="status">
        <strong>Exposure is incomplete: other pending-pricing orders are not zero.</strong>
        <ul>{data.pendingPricingOrders.map((item) => <li key={`${item.kind}:${item.id}`}>{item.number} · {item.date} · Pending pricing</li>)}</ul>
      </div> : <p>No other pending-pricing orders were found in the scoped history.</p>}
    </>}
  </section>;
}
