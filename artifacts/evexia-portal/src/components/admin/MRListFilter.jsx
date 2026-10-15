import { useEffect, useRef, useState } from 'react';
import { mrReferences } from '../../services/serverMRs.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import SearchableControl from './SearchableControl.jsx';

const choiceLabel = (item) => `${item.name}${item.status === 'inactive' ? ' (inactive)' : ''}${item.deleted ? ' (deleted)' : ''}`;

// The adapter owns remote search/paging; presentation never filters a partial
// server directory locally. A typed query is not an applied filter.
export default function MRListFilter({ id, label, kind, value, onChange, allLabel, allValue = '', options, emptyGuidance }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const controllerRef = useRef(null);
  const moreController = useRef(null);
  const moreBusy = useRef(false);
  const ownerChanged = useRef(false);
  const selectedValue = useRef(value);
  selectedValue.current = value;

  function invalidate() {
    sequence.current++;
    controllerRef.current?.abort(); moreController.current?.abort();
    moreBusy.current = false; setMore(false);
  }
  function search(next) {
    invalidate();
    setItems([]); setStatus('loading'); setError('');
    setQuery(next); setOpen(true); setRevision((n) => n + 1);
  }
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) {
        ownerChanged.current = true;
        invalidate(); setItems([]); setSelected(null); setOpen(false);
      }
    });
  }, []);
  useEffect(() => {
    if (!open || options || ownerChanged.current) return undefined;
    const current = ++sequence.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    moreController.current?.abort();
    moreBusy.current = false; setMore(false);
    setStatus('loading'); setError(''); setItems([]);
    const timer = setTimeout(() => {
      mrReferences(kind, { query: query.trim(), limit: 100, offset: 0, includeSaved: selectedValue.current || undefined }, controller.signal)
        .then((result) => {
          if (current !== sequence.current || controller.signal.aborted) return;
          const saved = result.items.find((item) => item.id === selectedValue.current);
          if (saved) setSelected(saved);
          setItems(result.items); setTotal(result.total); setCursor(result.nextCursor);
          setOffset(result.partial ? 0 : Math.min(result.offset + result.limit, result.total)); setStatus('ready');
        })
        .catch((cause) => {
          if (current === sequence.current && !controller.signal.aborted) { setStatus('error'); setError(cause.message || 'Try again.'); }
        });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; moreController.current?.abort(); };
  }, [open, kind, query, revision, options]);
  useEffect(() => () => { sequence.current++; controllerRef.current?.abort(); moreController.current?.abort(); }, []);

  async function loadMore() {
    if (moreBusy.current || ownerChanged.current) return;
    const current = sequence.current;
    const controller = new AbortController();
    moreController.current = controller; moreBusy.current = true;
    setMore(true); setError('');
    try {
      const result = await mrReferences(kind, { query: query.trim(), limit: 100, offset, cursor: cursor || undefined, includeSaved: selectedValue.current || undefined }, controller.signal);
      if (current !== sequence.current || controller.signal.aborted) return;
      setItems((previous) => [...previous, ...result.items.filter((item) => !previous.some((known) => known.id === item.id))]);
      setTotal(result.total); setCursor(result.nextCursor);
      setOffset(result.partial ? 0 : Math.min(result.offset + result.limit, result.total));
    } catch (cause) {
      if (current === sequence.current && !controller.signal.aborted) setError(cause.message || 'More choices could not be loaded.');
    } finally {
      if (current === sequence.current) { moreBusy.current = false; setMore(false); }
    }
  }

  const choices = options
    ? options.filter((item) => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : status === 'ready' ? items.map((item) => ({ value: item.id, label: choiceLabel(item) })) : [];
  const selectedLabel = value === allValue ? allLabel : options?.find((item) => item.value === value)?.label
    || (selected?.id === value ? choiceLabel(selected) : 'Saved choice');
  const feedback = options ? '' : status === 'loading' ? 'Loading choices…'
    : status === 'error' ? `Choices could not be loaded. ${error}`
      : error ? `More choices could not be loaded. ${error}`
        : total === null ? `Showing ${items.length} choices in checked sections. ${cursor ? 'Further records may match. Continue search.' : 'No further records remain.'}`
          : !choices.length ? (query.trim() ? 'No matches found.' : emptyGuidance)
            : `Showing up to ${offset} of ${total} choices.`;
  return <SearchableControl id={id} label={label} value={value} selectedLabel={selectedLabel}
    choices={[{ value: allValue, label: allLabel }, ...choices]} onSearch={search}
    onDismiss={() => { invalidate(); setOpen(false); }}
    onChange={(next) => {
      setSelected(items.find((item) => item.id === next) || null); onChange(next);
    }} placeholder={allLabel} loading={!options && status === 'loading'} feedback={feedback}
    action={!options && status === 'error' ? { label: 'Retry', run: () => search(query) }
      : !options && status === 'ready' && (cursor || offset < total) ? {
        label: more ? 'Loading…' : error ? 'Retry load more' : total === null ? 'Continue search' : 'Load more',
        pending: more, run: loadMore, testId: `button-more-mr-${kind}`,
      } : null} />;
}
