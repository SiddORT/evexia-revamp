import { useEffect, useRef, useState } from 'react';
import { listAllergenReferences } from '../../services/serverAllergens.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import AllergenSearchableSelect from './AllergenSearchableSelect.jsx';

const PAGE = 25;
export default function AllergenRefPicker({ id, kind, label, value, onChange, retained = null, includeUnusable = false, allLabel = '', invalid = false, testId, disabled = false, describedBy }) {
  const [request, setRequest] = useState({ search: '', offset: 0, revision: 0 });
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const selectedValue = useRef(value);
  selectedValue.current = value;
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      const session = getSession();
      if (session.user?.id !== owner || !['authenticated', 'renewing', 'renewal-error'].includes(session.status)) {
        generation.current++; setItems([]); setSelected(null); setTotal(0); setError('');
      }
    });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    let guard;
    try { guard = reportingIdentityGuard(); } catch { return undefined; }
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      listAllergenReferences(kind, { query: request.search.trim(), limit: PAGE, offset: request.offset, include_unusable: includeUnusable }, controller.signal)
        .then((result) => {
          guard();
          if (controller.signal.aborted || generation.current !== current) return;
          const known = result.items.find((item) => item.id === selectedValue.current);
          if (known) setSelected(known);
          setItems((previous) => request.offset ? [...previous, ...result.items.filter((item) => !previous.some((old) => old.id === item.id))] : result.items);
          setTotal(result.total);
        })
        .catch((cause) => { try { guard(); } catch { return; } if (!controller.signal.aborted && generation.current === current) setError(cause.message); })
        .finally(() => { if (!controller.signal.aborted && generation.current === current) setLoading(false); });
    }, request.offset ? 0 : 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, includeUnusable, request]);
  function search(text) {
    if (text === request.search) return;
    // Invalidate synchronously so even a response arriving before effect cleanup is ignored.
    generation.current++; setItems([]); setTotal(0); setLoading(true); setError('');
    setRequest((previous) => ({ ...previous, search: text, offset: 0 }));
  }
  const options = items.map((item) => ({ value: item.id, label: `${item.name}${item.status !== 'active' ? ` (${item.status})` : ''}`, item }));
  const known = selected?.id === value ? selected : retained?.id === value ? retained : null;
  const knownLabel = known ? `${known.name}${known.status !== 'active' ? ` (${known.status})` : ''}` : undefined;
  if (known && !options.some((option) => option.value === value) && (!request.search || known.name.toLocaleLowerCase().includes(request.search.trim().toLocaleLowerCase()))) options.unshift({ value: known.id, label: knownLabel, item: known });
  options.unshift({ value: '', label: allLabel || `Select ${label.toLowerCase()}` });
  return <AllergenSearchableSelect id={id} label={label} value={value} options={options} selectedLabel={knownLabel} empty={!items.length} invalid={invalid} describedBy={describedBy}
    disabled={disabled} testId={testId} placeholder={allLabel || `Select ${label.toLowerCase()}`} onSearch={search}
    onChange={(next) => { const item = options.find((option) => option.value === next)?.item || null; setSelected(item); onChange(next, item); }}
    loading={loading} error={error} onRetry={() => setRequest((previous) => ({ ...previous, revision: previous.revision + 1 }))}
    remaining={Math.max(0, total - items.length)} onMore={() => { setLoading(true); setRequest((previous) => ({ ...previous, offset: items.length })); }} />;
}
