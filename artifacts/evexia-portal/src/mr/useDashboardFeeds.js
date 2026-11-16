import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { contactReadScope, getSession, purchaseOrderRequest, sessionEpoch } from '../auth/adminSession.js';
import { getMRDoctorPayments } from '../services/serverMRDashboard.js';

const PAGE = 25;
const MONEY = /^(0|[1-9]\d{0,29})\.\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const day = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const parsed = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === v ? parsed / 86400000 : null;
};

function confirmRestrictions(data, offset) {
  const fail = () => { throw new Error('Financial restrictions could not be confirmed. Refresh to retry.'); };
  if (!data || typeof data.paymentLimit !== 'string' || !MONEY.test(data.paymentLimit)
    || !count(data.doctorDaysLimit) || data.doctorDaysLimit > 3650
    || !count(data.total) || data.total > 20000 || data.offset !== offset || data.limit !== PAGE
    || !Array.isArray(data.items) || data.items.length !== Math.min(PAGE, Math.max(0, data.total - offset))
    || !Array.isArray(data.pendingPricingOrders) || data.pendingPricingOrders.length > 20000
    || day(data.businessDate) === null || (!data.doctorDaysLimit && data.total)) fail();
  const seen = new Set();
  for (const item of data.items) {
    if (!item || typeof item.doctorId !== 'string' || !UUID.test(item.doctorId) || seen.has(item.doctorId)
      || typeof item.doctorName !== 'string' || !item.doctorName.trim()
      || typeof item.doctorPendingBalance !== 'string' || !MONEY.test(item.doctorPendingBalance)
      || BigInt(item.doctorPendingBalance.replace('.', '')) <= 0n
      || item.doctorDaysLimit !== data.doctorDaysLimit
      || !count(item.oldestDoctorUnpaidAgeDays) || item.oldestDoctorUnpaidAgeDays < data.doctorDaysLimit
      || day(item.oldestDoctorUnpaidDate) === null
      || day(data.businessDate) - day(item.oldestDoctorUnpaidDate) !== item.oldestDoctorUnpaidAgeDays) fail();
    seen.add(item.doctorId);
  }
  return data;
}

// Existing saved-order mechanisms (local event + cross-tab channel), focus and visibility.
export function useSavedOrderRefresh(onRefresh, interval) {
  const ref = useRef(onRefresh);
  ref.current = onRefresh;
  useEffect(() => {
    const refresh = () => { if (!document.hidden) ref.current(); };
    const timer = interval ? window.setInterval(refresh, interval) : null;
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('evexia:saved-order-change', refresh);
    window.addEventListener('pageshow', refresh);
    const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel('evexia-order-refresh') : null;
    if (channel) channel.onmessage = refresh;
    return () => {
      if (timer) clearInterval(timer);
      channel?.close();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('evexia:saved-order-change', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [interval]);
}

/** Single dashboard-level restrictions feed: shared by Overview summary and Doctor payments detail. */
export function useFinancialRestrictions(tick = 0) {
  const { status, user } = useAdminSession();
  const scope = contactReadScope(user), epoch = sessionEpoch();
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [result, setResult] = useState(null);
  const key = JSON.stringify([scope, epoch, offset, revision, tick]);
  useEffect(() => {
    if (status !== 'authenticated' || user?.identity_kind !== 'mr') return undefined;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && sessionEpoch() === epoch
      && contactReadScope(getSession().user) === scope && getSession().status === 'authenticated';
    purchaseOrderRequest('/mr-financial-summary', { params: { offset, limit: PAGE }, signal: controller.signal }, 'spt-orders')
      .then((data) => {
        const confirmed = confirmRestrictions(data, offset);
        if (current()) setResult({ key, data: confirmed });
      }).catch((error) => { if (current()) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [key, epoch, scope, offset, status, user?.identity_kind]);
  const visible = status === 'authenticated' && result?.key === key ? result : null;
  return { data: visible?.data, error: visible?.error, loading: !visible, offset, setOffset, page: PAGE,
    refresh: () => setRevision((n) => n + 1) };
}

/** All-date Doctor balances; independent of FY/quarter order filters. */
export function useDoctorPayments(tick = 0) {
  const { status, user } = useAdminSession();
  const scope = contactReadScope(user), epoch = sessionEpoch();
  const [search, setSearchRaw] = useState(''), [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0), [result, setResult] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const setSearch = (v) => {
    setSearchRaw(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setQuery(v.trim()); setOffset(0); }, 300);
  };
  const key = JSON.stringify([scope, epoch, query, offset, revision, tick]);
  useEffect(() => {
    if (status !== 'authenticated' || user?.identity_kind !== 'mr') return undefined;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && sessionEpoch() === epoch
      && contactReadScope(getSession().user) === scope && getSession().status === 'authenticated';
    getMRDoctorPayments({ search: query, offset, limit: PAGE, mrId: user.mr_id, signal: controller.signal })
      .then((data) => {
        // The transport adapter validates the complete page, exact money,
        // aging arithmetic, ownership and missing-pricing consistency.
        if (current()) setResult({ key, data });
      }).catch((error) => { if (current()) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [key, epoch, scope, query, offset, status, user?.identity_kind, user?.mr_id]);
  const visible = status === 'authenticated' && result?.key === key ? result : null;
  return { data: visible?.data, error: visible?.error, loading: !visible, search, setSearch, query, offset, setOffset, page: PAGE,
    refresh: () => setRevision((n) => n + 1) };
}
