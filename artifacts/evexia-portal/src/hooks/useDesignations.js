import { useCallback, useEffect, useRef, useState } from 'react';
import * as service from '../services/serverDesignations.js';
import { getSession, subscribeSession } from '../auth/adminSession.js';

export default function useServerDesignations(query, status, page, pageSize) {
  const [data, setData] = useState({ items: [], total: 0, filtered: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [revision, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const retry = useCallback(() => refresh((value) => value + 1), []);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      const session = getSession();
      if (!session.user || session.user.id !== owner) {
        setData({ items: [], total: 0, filtered: 0 });
        setFeedback('');
        setError('');
      }
    });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      service.listDesignations({ query, status, limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setData(result); setError(''); } })
        .catch((cause) => { if (!controller.signal.aborted) { setData({ items: [], total: 0, filtered: 0 }); setError(cause.message); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
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
    try {
      await work();
      setFeedback(message);
      retry();
      return { success: true };
    } catch (cause) {
      return { success: false, error: cause.message, code: cause.code, ambiguous: cause.ambiguous };
    } finally { busy.current = false; setPending(false); }
  }
  return {
    records: data.items, total: data.total, filtered: data.filtered, loading, pending, error, feedback, retry,
    clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => service.createDesignation(values), 'Designation added to shared records.'),
    edit: (record, values) => apply(() => service.editDesignation(record, values), 'Designation updated.'),
    remove: (record) => apply(() => service.deleteDesignation(record), 'Designation deleted. Server deletion history retained.'),
    changeStatus: (record, status) => apply(() => service.statusDesignation(record, status), 'Designation status updated.'),
  };
}
