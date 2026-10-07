import { useCallback, useEffect, useRef, useState } from 'react';
import * as service from '../services/serverHeadquarters.js';
import { getSession, subscribeSession, reportingIdentityGuard } from '../auth/adminSession.js';

const empty = () => ({ items: [], total: 0, filtered: 0 });
export default function useServerHeadquarters(query, status, page, pageSize) {
  const [data, setData] = useState(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [revision, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const retry = useCallback(() => refresh((value) => value + 1), []);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      const session = getSession();
      if (!session.user || session.user.id !== owner) {
        setData(empty()); setFeedback(''); setError('');
      }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoading(true);
    const timer = setTimeout(() => {
      service.listHeadquarters({ query, status, limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
        .then((result) => { guard(); if (!controller.signal.aborted) { setData(result); setError(''); } })
        .catch((cause) => {
          try { guard(); } catch { return; }
          if (!controller.signal.aborted) { setData(empty()); setError(cause.message); }
        })
        .finally(() => { if (!controller.signal.aborted && alive.current) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, status, page, pageSize, revision]);
  useEffect(() => {
    const listener = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('focus', listener);
    return () => window.removeEventListener('focus', listener);
  }, [retry]);
  async function apply(work, message) {
    if (busy.current) return { success: false, error: 'A save is already pending.' };
    busy.current = true;
    setPending(true);
    const guard = reportingIdentityGuard();
    try {
      await work(); guard();
      if (!alive.current) return { success: false };
      setFeedback(message); retry();
      return { success: true };
    } catch (cause) {
      return { success: false, error: cause.message, code: cause.code, ambiguous: cause.ambiguous };
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  return {
    records: data.items, total: data.total, filtered: data.filtered, loading, pending, error, feedback, retry,
    clearFeedback: () => setFeedback(''),
    remove: (record) => apply(() => service.deleteHeadquarter(record), 'Headquarter deleted. Server history retained.'),
    changeStatus: (record, status) => apply(() => service.statusHeadquarter(record, status), 'Headquarter status updated.'),
  };
}
