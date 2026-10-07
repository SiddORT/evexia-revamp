import { useCallback, useEffect, useRef, useState } from 'react';
import * as service from '../services/serverZones.js';

export default function useZones(query, status, page, pageSize, deleted = false) {
  const [data, setData] = useState({ items: [], total: 0, filtered: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [revision, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const retry = useCallback(() => refresh((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const list = deleted ? service.listDeletedZones : service.listZones;
      list({ query, status, limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setData(result); setError(''); } })
        .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, status, page, pageSize, revision, deleted]);
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
    zones: data.items, total: data.total, filtered: data.filtered, loading, pending, error, feedback, retry,
    clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => service.createZone(values), 'Zone added to shared records.'),
    edit: (record, values) => apply(() => service.editZone(record, values), 'Zone updated.'),
    remove: (record) => apply(() => service.deleteZone(record), 'Zone deleted. Server audit history retained.'),
    restore: (record) => apply(() => service.restoreZone(record), 'Zone restored to shared records with its original status.'),
    changeStatus: (record, status) => apply(() => service.statusZone(record, status), 'Zone status updated.'),
  };
}
