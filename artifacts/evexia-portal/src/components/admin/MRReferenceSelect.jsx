import { useEffect, useRef, useState } from 'react';
import { mrReferences } from '../../services/serverMRs.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import MRFormCombobox from './MRFormCombobox.jsx';
import '../../mr.css';

const choiceLabel = (item) => `${item.name}${item.status === 'inactive' ? ' (inactive)' : ''}${item.deleted ? ' (deleted)' : ''}`;

// Server search/paging stays separate from the form's selected ID and label.
export default function MRReferenceSelect({ id, kind, label, value, savedName, onChange, placeholder, invalid, describedBy, excludeId, emptyGuidance, required, requestChoices = mrReferences, onHydrate, testId }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [more, setMore] = useState(false);
  const sequence = useRef(0);
  const nextOffset = useRef(0);
  const nextCursor = useRef(null);
  const savedRef = useRef(value);
  const currentValue = useRef(value);
  currentValue.current = value;
  const controllerRef = useRef(null);
  const moreController = useRef(null);
  const moreBusy = useRef(false);
  const ownerChanged = useRef(false);

  function invalidate() {
    sequence.current++; controllerRef.current?.abort(); moreController.current?.abort();
    moreBusy.current = false; setMore(false);
  }
  function search(next) {
    invalidate(); setItems([]); setState('loading'); setError(''); setQuery(next); setRevision((n) => n + 1);
  }
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) {
        ownerChanged.current = true; invalidate(); setItems([]); setSelected(null);
      }
    });
  }, []);
  useEffect(() => {
    if (ownerChanged.current) return undefined;
    const current = ++sequence.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('loading'); setError(''); setItems([]);
    const timer = setTimeout(() => {
      requestChoices(kind, { query: query.trim(), limit: 100, offset: 0, includeSaved: currentValue.current || undefined }, controller.signal)
        .then((result) => {
          if (current !== sequence.current || controller.signal.aborted) return;
          const saved = result.items.find((item) => item.id === currentValue.current);
          if (saved) setSelected(saved);
          nextOffset.current = result.partial ? 0 : Math.min(result.offset + result.limit, result.total);
          nextCursor.current = result.nextCursor;
          onHydrate?.(result.items);
          setItems(result.items); setTotal(result.total); setState('ready');
        })
        .catch((cause) => {
          if (current === sequence.current && !controller.signal.aborted) { setState('error'); setError(cause.message || 'Try again.'); }
        });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; moreController.current?.abort(); };
  }, [kind, query, revision]);
  useEffect(() => () => { sequence.current++; controllerRef.current?.abort(); moreController.current?.abort(); }, []);
  async function loadMore() {
    if (moreBusy.current || ownerChanged.current) return;
    const current = sequence.current;
    const controller = new AbortController();
    moreController.current = controller; moreBusy.current = true;
    setMore(true); setError('');
    try {
      const result = await requestChoices(kind, { query: query.trim(), limit: 100, offset: nextOffset.current, cursor: nextCursor.current || undefined, includeSaved: currentValue.current || undefined }, controller.signal);
      if (current !== sequence.current || controller.signal.aborted) return;
      nextOffset.current = result.partial ? 0 : Math.min(result.offset + result.limit, result.total);
      nextCursor.current = result.nextCursor;
      onHydrate?.(result.items);
      setItems((existing) => [...existing, ...result.items.filter((item) => !existing.some((known) => known.id === item.id))]);
      setTotal(result.total);
    } catch (cause) {
      if (current === sequence.current && !controller.signal.aborted) setError(cause.message || 'More choices could not be loaded.');
    } finally {
      if (current === sequence.current) { moreBusy.current = false; setMore(false); }
    }
  }
  const visible = state === 'ready' ? items.filter((item) => item.id !== excludeId
    && (item.id !== value || !query.trim() || item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) : [];
  const choices = visible.map((item) => ({ value: item.id, label: choiceLabel(item),
    disabled: kind === 'designations' && (item.deleted || (item.status !== 'active' && item.id !== savedRef.current)) }));
  if (!required) choices.unshift({ value: '', label: placeholder });
  const chosen = items.find((item) => item.id === value) || (selected?.id === value ? selected : null);
  return <MRFormCombobox id={id} label={label} value={value}
    selectedLabel={value ? (chosen ? choiceLabel(chosen) : savedName || 'Saved choice') : ''}
    choices={choices} onChange={(next) => {
      setSelected(items.find((item) => item.id === next) || null); onChange(next);
    }} onSearch={search} onDismiss={() => { invalidate(); }}
    placeholder={placeholder} invalid={invalid} describedBy={describedBy} required={required}
    loading={state === 'loading'} testId={testId || `select-mr-${kind}`}
    feedback={state === 'loading' ? 'Loading choices…' : state === 'error' ? `Choices could not be loaded. ${error}`
      : error ? `More choices could not be loaded. ${error}`
        : total === null ? `Showing ${visible.length} choices in checked sections. ${nextCursor.current ? 'Further records may match. Continue search.' : 'No further records remain.'}`
        : !visible.length ? (query.trim() ? 'No matches found.' : emptyGuidance)
          : `Showing up to ${nextOffset.current} of ${total} choices.`}
    action={state === 'error' ? { label: 'Retry', run: () => search(query) }
      : state === 'ready' && (nextCursor.current || nextOffset.current < total) ? {
        label: more ? 'Loading…' : error ? 'Retry load more' : total === null ? 'Continue search' : 'Load more', pending: more, run: loadMore, testId: `button-more-mr-${kind}`,
      } : null} />;
}
