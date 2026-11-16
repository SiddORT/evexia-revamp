import { useEffect, useState } from 'react';
import { reportingIdentityGuard } from '../../auth/adminSession.js';

const amount = (value) => value == null ? 'Pending pricing' : `₹${value}`;

export default function FinancialReview({ order, request, proposedValues, onEvidence, disabled, compact = false, refreshKey = 0 }) {
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
            || typeof result.outstanding !== 'string' || !Array.isArray(result.pendingPricingOrders)
            || !(result.committedTargetCredits == null || (typeof result.committedTargetCredits === 'string' && /^(0|[1-9]\d{0,13})\.\d{2}$/.test(result.committedTargetCredits)))
            || !(result.creditRevision == null || typeof result.creditRevision === 'string' || Number.isSafeInteger(result.creditRevision))) {
          throw new Error('Financial evidence could not be confirmed for this saved version.');
        }
        if (alive) { setState({ loading: false, data: result, error: '' }); onEvidence({ ...result, reviewValues: serialized }); }
      } catch (cause) {
        if (alive) { setState({ loading: false, data: null, error: cause.message || 'Financial review unavailable.' }); onEvidence(null); }
      }
    }, serialized ? 700 : 0);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [order.id, order.version, serialized, revision, refreshKey, request, onEvidence]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !disabled) { onEvidence(null); setRevision((n) => n + 1); } };
    const timer = window.setInterval(refresh, 45000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [disabled, onEvidence]);
  const data = state.data;
  return <section className={compact ? 'order-approval__financial' : undefined} aria-label="MR financial review">
    <h3>MR financial review</h3>
    {!compact && <p>{serialized ? 'Proposed entry preview — save pricing before approval.' : `Saved version ${order.version}.`} Pricing alone does not approve the order.</p>}
    <button type="button" className="admin-button admin-button--secondary" disabled={disabled || state.loading} onClick={() => { onEvidence(null); setRevision((n) => n + 1); }}>{state.error ? 'Retry financial review' : compact ? 'Refresh review' : 'Refresh financial evidence'}</button>
    {state.loading && <p role="status">{compact ? 'Loading financial review…' : 'Loading saved orders, MR settings and committed payments…'}</p>}
    {state.error && <p role="alert">{compact ? 'Financial review could not be loaded. Retry before approving.' : `Financial evidence unavailable: ${state.error} No unrestricted balance has been assumed. Retry the financial review.`}</p>}
    {data && <>
      <dl>
        <div><dt>{compact ? 'MR payment limit' : 'MR Payment Limit'}</dt><dd>{amount(data.paymentLimit)}{data.paymentLimit === '0.00' ? ' · disabled' : ''}</dd></div>
        <div><dt>{compact ? 'Other priced outstanding' : 'Existing priced unpaid exposure, excluding this order'}</dt><dd>{amount(data.outstanding)}</dd></div>
        <div><dt>{compact ? serialized ? 'Entered order payable total' : 'Saved order payable total'
          : serialized ? 'Entered total' : 'Saved order total'}</dt><dd>{amount(data.proposedAmount)}</dd></div>
        <div><dt>Paid (cash) on this order</dt><dd>{amount(data.committedTargetPayments)}</dd></div>
        <div><dt>Credited on this order (not cash)</dt><dd>{data.committedTargetCredits == null ? 'Not reported' : amount(data.committedTargetCredits)}</dd></div>
        <div><dt>Resulting priced exposure</dt><dd>{amount(data.resultingExposure)}</dd></div>
      </dl>
      {compact && <p role="status">{data.exposureComplete ? 'Priced exposure history is complete.' : 'Exposure history is incomplete; pending orders are not zero.'}</p>}
      {(!compact || ['Reached', 'Exceeded'].includes(data.amountLimitState)) && <p role="status">{data.amountLimitState === 'Reached' ? 'Payment limit exactly reached.'
        : data.amountLimitState === 'Exceeded' ? 'Payment limit exceeded.'
          : data.amountLimitState === 'Below limit' ? 'Priced exposure is below the payment limit.'
            : data.amountLimitState === 'Disabled' ? 'Amount restriction disabled.' : 'Order is pending pricing.'}
        {' '}{compact ? 'Review before deciding; this warning does not automatically reject the order.' : 'Amount warnings do not automatically reject this order. Admin must make an explicit decision with a reason.'}</p>}
      {data.pendingPricingOrders.length > 0 ? <div role="status">
        <strong>Exposure is incomplete: other pending-pricing orders are not zero.</strong>
        <ul>{data.pendingPricingOrders.map((item) => <li key={`${item.kind}:${item.id}`}>{item.number} · {item.date} · Pending pricing</li>)}</ul>
      </div> : !compact && <p>No other pending-pricing orders were found in the scoped history.</p>}
    </>}
  </section>;
}
