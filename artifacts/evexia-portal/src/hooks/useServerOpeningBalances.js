import { useCallback, useEffect, useRef, useState } from 'react';
import * as service from '../services/serverOpeningBalances.js';
import { getSession, subscribeSession, reportingIdentityGuard } from '../auth/adminSession.js';

const empty = () => ({ items: [], total: 0, filtered: 0 });
export default function useServerOpeningBalances(query, status, page, pageSize) {
  const [data, setData] = useState(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [revision, refresh] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const retry = useCallback(() => refresh((n) => n + 1), []);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) { setData(empty()); setError(''); }
    });
    const focus = () => retry();
    window.addEventListener('focus', focus);
    return () => { alive.current = false; unsubscribe(); window.removeEventListener('focus', focus); };
  }, [retry]);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await service.listOpeningBalances({ query, status, limit: pageSize, offset: (page - 1) * pageSize }, controller.signal);
        guard(); if (!controller.signal.aborted) { setData(result); setError(''); }
      } catch (cause) {
        try { guard(); } catch { return; }
        if (!controller.signal.aborted) { setData(empty()); setError(cause.message); }
      } finally { if (!controller.signal.aborted && alive.current) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, status, page, pageSize, revision]);
  async function apply(record, type) {
    if (busy.current) return;
    busy.current = true; setPending(true);
    const guard = reportingIdentityGuard();
    try {
      await (type === 'delete' ? service.deleteOpeningBalance(record) : service.statusOpeningBalance(record, type));
      guard(); if (alive.current) retry();
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  return { ...data, error, loading, pending, retry, apply };
}
