import { useEffect, useState } from 'react';
import { Link } from 'wouter';
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
  return <section className="mrw-card" aria-labelledby="mr-financial-restrictions">
    <h2 id="mr-financial-restrictions">MR payment limit and overdue Doctors</h2>
    <button type="button" className="admin-button admin-button--secondary" onClick={() => setRevision((n) => n + 1)}>Refresh restrictions</button>
    {!visible && <p role="status">Loading current MR limits and saved unpaid evidence…</p>}
    {visible?.error && <p role="alert">Financial restrictions unavailable: {visible.error} No absence of restrictions has been assumed. Use Refresh restrictions to retry.</p>}
    {data && <>
      <p><strong>MR Payment Limit: ₹{data.paymentLimit}</strong>{data.paymentLimit === '0.00' && ' · disabled'}</p>
      <p>Inherited Doctor Days Limit: <strong>{data.doctorDaysLimit} days</strong>{data.doctorDaysLimit === 0 && ' · restriction disabled'}. Evaluated on {date(data.businessDate)} (Asia/Kolkata).</p>
      <p>Kits, SPT and Lupin amounts are reviewed by Admin. This list uses your own saved obligations and committed payments, not legacy payment flags or demo balances.</p>
      {data.items.length ? <ul className="mrw-list">{data.items.map((item) => <li key={item.doctorId}>
        <Link href={`/mr/doctors/${item.doctorId}`}>{item.doctorName} — view Doctor</Link>
        <p>Unpaid ₹{item.doctorPendingBalance} · oldest relevant order {date(item.oldestDoctorUnpaidDate)}
          {' '}({item.oldestDoctorUnpaidAgeDays} days old) · effective limit {item.doctorDaysLimit} days.</p>
      </li>)}</ul> : <p role="status">{data.doctorDaysLimit === 0 ? 'The overdue-days restriction is disabled.' : data.total ? 'No Doctors in this page. Return to the previous page.' : 'No currently assigned Doctors are blocked by the overdue-days rule.'}</p>}
      {data.pendingPricingOrders?.length > 0 && <p>{data.pendingPricingOrders.length} other pending-pricing orders are not counted as zero or as overdue debt.</p>}
      <div className="mrw-actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={!offset} onClick={() => setOffset((n) => Math.max(0, n - 25))}>Previous Doctors</button>
        <span>{data.total} blocked Doctors</span>
        <button type="button" className="admin-button admin-button--secondary" disabled={offset + 25 >= data.total} onClick={() => setOffset((n) => n + 25)}>Next Doctors</button>
      </div>
    </>}
  </section>;
}
