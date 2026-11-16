import { useEffect, useState } from 'react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { contactReadScope, getSession, sessionEpoch } from '../auth/adminSession.js';
import { getMRDashboard } from '../services/serverMRDashboard.js';

export function useMRDashboard({ year = null, period = 'all', refreshKey = 0 } = {}) {
  const { status, user } = useAdminSession();
  const scope = contactReadScope(user);
  const epoch = sessionEpoch();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const key = JSON.stringify([scope, epoch, year, period, revision, refreshKey]);
  useEffect(() => {
    if (status !== 'authenticated' || user?.identity_kind !== 'mr') {
      setResult(null);
      return undefined;
    }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && sessionEpoch() === epoch
      && contactReadScope(getSession().user) === scope && getSession().status === 'authenticated';
    getMRDashboard({ year, period, mrId: user.mr_id, signal: controller.signal })
      .then((data) => { if (current()) setResult({ key, data }); })
      .catch((error) => { if (current()) setResult({ key, error: error.message }); });
    return () => controller.abort();
  }, [key, status, scope, epoch, year, period, user?.mr_id]);
  // Suppress old identity/period data during render, not after an effect.
  const visible = status === 'authenticated' && result?.key === key ? result : null;
  return { data: visible?.data, error: visible?.error, loading: !visible,
    refresh: () => setRevision((n) => n + 1) };
}
