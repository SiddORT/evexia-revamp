import { useCallback, useEffect, useRef, useState } from 'react';
import * as service from '../services/serverLanguages.js';

export default function useLanguages(query, page, pageSize) {
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
      service.listLanguages({ query, limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setData(result); setError(''); } })
        .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, page, pageSize, revision]);
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
      return { success: false, error: cause.message, code: cause.code, status: cause.status, ambiguous: cause.ambiguous };
    } finally { busy.current = false; setPending(false); }
  }
  return {
    languages: data.items, total: data.total, filtered: data.filtered, loading, pending, error, feedback, retry,
    clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => service.createLanguage(values), 'Language added to shared records.'),
    edit: (record, values) => apply(() => service.editLanguage(record, values), 'Language updated.'),
    remove: (record) => apply(() => service.deleteLanguage(record), 'Language deleted. Server history retained.'),
  };
}
