import { useEffect, useRef, useState } from 'react';
import { combinationCategories } from '../../services/serverCombinationPricing.js';

export default function usePricingCategories() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState({ items: [], nextOffset: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const seq = ++sequence.current;
    pending.current = true; setPage({ items: [], nextOffset: null }); setBusy(true); setError('');
    const timer = setTimeout(() => combinationCategories({ query, limit: 50 }, controller.signal)
      .then((value) => { if (seq === sequence.current) setPage(value); })
      .catch((cause) => { if (!controller.signal.aborted && seq === sequence.current) setError(cause.message); })
      .finally(() => { if (seq === sequence.current) { pending.current = false; setBusy(false); } }), 200);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; };
  }, [query, retry]);
  function search(text, force = false) {
    if (!force && text === query) return;
    sequence.current++; pending.current = true; setPage({ items: [], nextOffset: null }); setBusy(true); setError('');
    if (force) setRetry((value) => value + 1); else setQuery(text);
  }
  async function more() {
    if (pending.current || page.nextOffset === null) return;
    const seq = sequence.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const value = await combinationCategories({ query, offset: page.nextOffset, limit: 50 });
      if (seq === sequence.current) setPage((old) => ({ ...value,
        items: [...old.items, ...value.items.filter((item) => !old.items.some((known) => known.id === item.id))] }));
    } catch (cause) { if (seq === sequence.current) setError(cause.message); }
    finally { if (seq === sequence.current) { pending.current = false; setBusy(false); } }
  }
  return { ...page, query, busy, error, search, more };
}
