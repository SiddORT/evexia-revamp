import { useEffect, useState } from 'react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { contactReadScope, getSession, sessionEpoch } from '../auth/adminSession.js';
import { getMRSales, getMRSalesYears } from '../services/serverMRSales.js';

// Every read belongs to identity + period + page. Hiding old data happens during
// render, not only after an effect, so a late response cannot flash old figures.
function useSalesRead(kind, { year, period = 'all', offset = 0 } = {}) {
  const { status, user } = useAdminSession();
  const scope = contactReadScope(user);
  const epoch = sessionEpoch();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const key = JSON.stringify([scope, epoch, kind, year, period, offset, revision]);
  useEffect(() => {
    if (status !== 'authenticated' || user?.identity_kind !== 'mr') {
      setResult(null);
      return undefined;
    }
    const controller = new AbortController();
    const params = { year, period, offset, limit: 25, mrId: user.mr_id, signal: controller.signal };
    const read = kind === 'years' ? getMRSalesYears(params) : getMRSales(params);
    const current = () => !controller.signal.aborted && sessionEpoch() === epoch
      && contactReadScope(getSession().user) === scope && getSession().status === 'authenticated';
    read.then((data) => { if (current()) setResult({ key, data }); })
      .catch((error) => { if (current()) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [key, status, scope, epoch, kind, year, period, offset, user?.mr_id]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRevision((n) => n + 1); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const visible = status === 'authenticated' && result?.key === key ? result : null;
  return { data: visible?.data, error: visible?.error, loading: !visible,
    refresh: () => setRevision((n) => n + 1) };
}

export const useSalesAchievement = (params) => useSalesRead('report', params);
export const useSalesYears = (offset) => useSalesRead('years', { offset });
