import { useCallback, useEffect, useRef, useState } from 'react';
import * as service from '../services/serverSalesTargets.js';

const ZERO = { q1: '0', q2: '0', q3: '0', q4: '0', total: '0' };
const EMPTY = { items: [], total: 0, filtered: 0, totals: ZERO };

export default function useSalesTargets(filters, page, pageSize) {
  const [data, setData] = useState(EMPTY);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [revision, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const retry = useCallback(() => refresh((value) => value + 1), []);
  const key = JSON.stringify(filters);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      service.listSalesTargets({ ...JSON.parse(key), limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setData({ ...EMPTY, ...result, totals: result.totals || ZERO }); setError(''); } })
        .catch((cause) => { if (!controller.signal.aborted) { setData(EMPTY); setError(cause.message || 'Sales targets could not be loaded.'); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, page, pageSize, revision]);
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
      return { success: false, error: cause.message || 'Sales target request failed.', code: cause.code, ambiguous: cause.ambiguous, fields: cause.fields };
    } finally { busy.current = false; setPending(false); }
  }
  return {
    records: data.items, total: data.total, filtered: data.filtered, totals: data.totals || ZERO, loading, pending, error, feedback, retry,
    clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => service.createSalesTarget(values), 'Sales target added to shared records.'),
    edit: (record, values) => apply(() => service.editSalesTarget(record, values), 'Sales target updated.'),
    remove: (record) => apply(() => service.deleteSalesTarget(record), 'Sales target deleted. Server deletion history retained.'),
    changeStatus: (record, status) => apply(() => service.statusSalesTarget(record, status), 'Sales target status updated.'),
  };
}
