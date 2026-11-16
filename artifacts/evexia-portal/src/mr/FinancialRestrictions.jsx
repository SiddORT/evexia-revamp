import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { contactReadScope, getSession, purchaseOrderRequest, sessionEpoch } from '../auth/adminSession.js';
import { useAdminDateFormatters } from '../components/admin/adminPreferences.js';

export default function FinancialRestrictions() {
  const { status, user } = useAdminSession();
  const { date } = useAdminDateFormatters();
  const scope = contactReadScope(user), epoch = sessionEpoch();
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [result, setResult] = useState(null);
  const key = JSON.stringify([scope, epoch, offset, revision]);
  useEffect(() => {
    if (status !== 'authenticated' || user?.identity_kind !== 'mr') return undefined;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && sessionEpoch() === epoch && contactReadScope(getSession().user) === scope;
    purchaseOrderRequest('/mr-financial-summary', { params: { offset, limit: 25 }, signal: controller.signal }, 'spt-orders')
      .then((data) => {
        if (!data || typeof data.paymentLimit !== 'string' || !Number.isInteger(data.doctorDaysLimit)
            || !Array.isArray(data.items) || !Number.isInteger(data.total)) throw new Error('Financial summary response is unavailable.');
        if (current()) setResult({ key, data });
      }).catch((error) => { if (current()) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [key, epoch, scope, offset, status, user?.identity_kind]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision((n) => n + 1); };
    const timer = window.setInterval(refresh, 45000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('evexia:saved-order-change', refresh);
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('evexia-order-refresh') : null;
    if (channel) channel.onmessage = refresh;
    return () => {
      clearInterval(timer); channel?.close();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('evexia:saved-order-change', refresh);
    };
  }, []);
  const visible = status === 'authenticated' && result?.key === key ? result : null;
  const data = visible?.data;
  const outOfRange = data && offset > 0 && !data.items.length;
  const showPages = data && (data.total > 25 || offset > 0);
  return <section className="mrw-card mrd-restrictions" aria-labelledby="mr-financial-restrictions">
    <header className="mrd-restrictions__header">
      <h2 id="mr-financial-restrictions">MR payment limit and overdue Doctors</h2>
      <button type="button" className="admin-button admin-button--secondary" data-testid="button-refresh-restrictions"
        onClick={() => setRevision((n) => n + 1)}><RefreshCw size={15} aria-hidden="true" />Refresh restrictions</button>
    </header>
    {!visible && <p className="mrd-restrictions__state" role="status" data-testid="status-restrictions-loading">Loading current MR limits and saved unpaid evidence…</p>}
    {visible?.error && <p className="mrd-restrictions__state mrd-restrictions__state--error" role="alert" data-testid="status-restrictions-error">
      <strong>Financial restrictions unavailable</strong>
      <span>{visible.error} No absence of restrictions has been assumed. Use Refresh restrictions to retry.</span>
    </p>}
    {data && <>
      <dl className="mrd-restrictions__summary">
        <div data-testid="text-restrictions-payment-limit">
          <dt>MR Payment Limit</dt><dd>₹{data.paymentLimit}
            <small>{data.paymentLimit === '0.00' ? 'Amount restriction disabled · zero limit' : 'Configured amount limit'}</small>
          </dd>
        </div>
        <div data-testid="text-restrictions-days-limit">
          <dt>Inherited Doctor Days Limit</dt><dd>{data.doctorDaysLimit} <span>days</span>
            <small>{data.doctorDaysLimit === 0 ? 'Overdue-days restriction disabled · zero limit' : 'Applies to currently assigned Doctors'}</small>
          </dd>
        </div>
        <div data-testid="text-restrictions-blocked-total">
          <dt>Overdue / blocked Doctors</dt><dd>{data.total}
            <small>Blocked by the overdue-days rule · not a balance</small>
          </dd>
        </div>
      </dl>
      <div className="mrd-restrictions__metadata">
        <p data-testid="text-restrictions-evaluated">Evaluated on {date(data.businessDate)} · Asia/Kolkata</p>
        <details>
          <summary data-testid="button-restrictions-policy">Policy and evidence</summary>
          <p>Kits, SPT and Lupin amounts are reviewed by Admin. This list uses your own saved obligations and committed payments, not legacy payment flags or demo balances.</p>
        </details>
      </div>
      {data.items.length ? <ul className="mrd-restrictions__doctors" aria-label="Doctors blocked by the overdue-days rule">
        {data.items.map((item) => <li key={item.doctorId} data-testid={`row-restrictions-doctor-${item.doctorId}`}>
          <Link className="mrd-restrictions__doctor" href={`/mr/doctors/${item.doctorId}`} data-testid={`link-restrictions-doctor-${item.doctorId}`}>
            <strong>{item.doctorName}</strong><span>View Doctor →</span>
          </Link>
          <dl className="mrd-restrictions__evidence">
            <div><dt>Unpaid amount</dt><dd>₹{item.doctorPendingBalance}</dd></div>
            <div><dt>Oldest unpaid order</dt><dd>{date(item.oldestDoctorUnpaidDate)}<small>{item.oldestDoctorUnpaidAgeDays} days old</small></dd></div>
            <div><dt>Effective days limit</dt><dd>{item.doctorDaysLimit} days</dd></div>
          </dl>
        </li>)}
      </ul> : <div className="mrd-restrictions__state" role="status" data-testid="status-restrictions-empty">
        <strong>{outOfRange ? 'No Doctors on this page' : data.doctorDaysLimit === 0 ? 'Overdue-days restriction disabled' : data.total ? 'No Doctors on this page' : 'No Doctors currently blocked'}</strong>
        <span>{outOfRange
          ? 'Return to the previous page to view the current results.'
          : data.total ? 'No Doctors returned on this page. Refresh restrictions to retry.'
            : data.doctorDaysLimit === 0
              ? 'The inherited days limit is zero, so the overdue-days rule does not block Doctors. This does not mean unpaid balances are zero.'
              : 'No currently assigned Doctors are blocked by the overdue-days rule. This does not mean unpaid balances are zero.'}</span>
      </div>}
      {data.pendingPricingOrders?.length > 0 && <p className="mrd-restrictions__pricing" data-testid="status-restrictions-pending-pricing">
        <strong>Pending pricing excluded:</strong> {data.pendingPricingOrders.length} other pending-pricing orders are not counted as zero or as overdue debt.
      </p>}
      {showPages && <nav className="mrd-restrictions__pages" aria-label="Overdue Doctors pages">
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-restrictions-previous" disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 25))}>Previous Doctors</button>
        <span>{data.items.length ? `${offset + 1}–${offset + data.items.length} of ${data.total} blocked Doctors` : `${data.total} blocked Doctors · page out of range`}</span>
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-restrictions-next" disabled={offset + 25 >= data.total} onClick={() => setOffset((n) => n + 25)}>Next Doctors</button>
      </nav>}
    </>}
  </section>;
}
