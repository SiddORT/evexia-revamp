import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { mrReferences } from '../../services/serverMRs.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import { useAdminPreferences } from './adminPreferences.js';

const choiceLabel = (item) => `${item.name}${item.status === 'inactive' ? ' (inactive)' : ''}${item.deleted ? ' (deleted)' : ''}`;

// List-only combobox: query is never an applied filter. Forms keep their native
// reference fields. Reference results remain server searched and paginated.
export default function MRListFilter({ id, label, kind, value, onChange, allLabel, allValue = '', options, emptyGuidance }) {
  const { theme, appearance } = useAdminPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [position, setPosition] = useState(null);
  const root = useRef(null);
  const menu = useRef(null);
  const input = useRef(null);
  const sequence = useRef(0);
  const moreController = useRef(null);
  const moreBusy = useRef(false);
  const selectedValue = useRef(value);
  selectedValue.current = value;

  function invalidate() {
    sequence.current++;
    moreController.current?.abort();
    moreBusy.current = false;
    setMore(false);
  }
  function close() {
    invalidate();
    setOpen(false); setQuery(''); setActive(-1);
  }
  function openMenu() {
    if (!open) { setOpen(true); setQuery(''); setActive(-1); }
  }
  function changeQuery(next) {
    invalidate();
    setItems([]); setStatus('loading'); setError('');
    setQuery(next); setActive(-1); setOpen(true);
  }
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => {
      if (getSession().user?.id !== owner) {
        invalidate(); setItems([]); setSelected(null); setOpen(false);
      }
    });
  }, []);
  useEffect(() => {
    if (!open || options) return undefined;
    const current = ++sequence.current;
    const controller = new AbortController();
    moreController.current?.abort();
    moreBusy.current = false; setMore(false);
    setStatus('loading'); setError(''); setItems([]); setActive(-1);
    const timer = setTimeout(() => {
      mrReferences(kind, { query: query.trim(), limit: 100, offset: 0, includeSaved: selectedValue.current || undefined }, controller.signal)
        .then((result) => {
          if (current !== sequence.current || controller.signal.aborted) return;
          const saved = result.items.find((item) => item.id === selectedValue.current);
          if (saved) setSelected(saved);
          setItems(result.items); setTotal(result.total);
          setOffset(Math.min(result.offset + result.limit, result.total)); setStatus('ready');
        })
        .catch((cause) => {
          if (current === sequence.current && !controller.signal.aborted) { setStatus('error'); setError(cause.message || 'Try again.'); }
        });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); sequence.current++; moreController.current?.abort(); };
  }, [open, kind, query, revision, options]);
  useEffect(() => () => { sequence.current++; moreController.current?.abort(); }, []);

  async function loadMore() {
    if (moreBusy.current) return;
    const current = sequence.current;
    const controller = new AbortController();
    moreController.current = controller; moreBusy.current = true;
    setMore(true); setError('');
    try {
      const result = await mrReferences(kind, { query: query.trim(), limit: 100, offset, includeSaved: selectedValue.current || undefined }, controller.signal);
      if (current !== sequence.current || controller.signal.aborted) return;
      // The paging action can disappear on the final page. Return focus before
      // removing it; a blur must not dismiss the newly loaded choices.
      if (menu.current?.contains(document.activeElement)) input.current?.focus();
      setItems((previous) => [...previous, ...result.items.filter((item) => !previous.some((known) => known.id === item.id))]);
      setTotal(result.total); setOffset(Math.min(result.offset + result.limit, result.total));
    } catch (cause) {
      if (current === sequence.current && !controller.signal.aborted) setError(cause.message || 'More choices could not be loaded.');
    } finally {
      if (current === sequence.current) { moreBusy.current = false; setMore(false); }
    }
  }
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    const place = () => {
      const rect = root.current.getBoundingClientRect();
      const height = window.visualViewport?.height || window.innerHeight;
      const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 24);
      const below = height - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 180 && above > below;
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        width, maxHeight: Math.max(60, Math.min(320, (up ? above : below) - 6)),
        ...(up ? { bottom: height - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    place();
    const outside = (event) => { if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) close(); };
    const scroll = (event) => { if (!menu.current?.contains(event.target)) place(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true); window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open]);

  const choices = options
    ? options.filter((item) => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : status === 'ready' ? items.map((item) => ({ value: item.id, label: choiceLabel(item), item })) : [];
  const matches = [{ value: allValue, label: allLabel }, ...choices];
  const selectedLabel = value === allValue ? allLabel : options?.find((item) => item.value === value)?.label
    || (selected?.id === value ? choiceLabel(selected) : 'Saved choice');
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);

  function choose(choice) {
    if (choice.item) setSelected(choice.item);
    onChange(choice.value); close(); input.current?.focus();
  }
  function keyDown(event) {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(); input.current?.focus(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { openMenu(); setActive(0); }
      else setActive((index) => event.key === 'ArrowDown' ? Math.min(index + 1, matches.length - 1) : Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && event.target === input.current) {
      event.preventDefault();
      if (active >= 0 && matches[active]) choose(matches[active]);
    } else if (event.key === 'Tab' && open) {
      const action = menu.current?.querySelector('button');
      if (event.target === input.current && !event.shiftKey && action) {
        event.preventDefault(); action.focus();
      } else if (menu.current?.contains(event.target)) {
        event.preventDefault();
        if (event.shiftKey) input.current?.focus();
        else {
          // A portal lives at the end of body, not beside its control in the
          // tab order. Continue from the original input when leaving it.
          const tabbables = [...document.querySelectorAll('input, button, select, textarea, a[href], [tabindex]')]
            .filter((node) => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length && !menu.current?.contains(node));
          const next = tabbables[tabbables.indexOf(input.current) + 1];
          close(); next?.focus();
        }
      }
    }
  }
  return <div className="mr-list-filter" ref={root}>
    <div className="mr-list-filter__control">
      <input ref={input} id={id} role="combobox" aria-label={label} aria-autocomplete="list" aria-haspopup="listbox"
        aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
        aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off" maxLength={100} value={open ? query : selectedLabel} title={selectedLabel}
        placeholder={`Search ${label.toLowerCase()}…`} onClick={openMenu}
        onChange={(event) => changeQuery(event.target.value)} onKeyDown={keyDown}
        onBlur={(event) => { if (!root.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) close(); }}
        data-testid={`select-${id}`} />
      <button type="button" tabIndex={-1} aria-label={`Open ${label.toLowerCase()} choices`}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { input.current?.focus(); if (open) close(); else openMenu(); }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
    {open && position && createPortal(<div ref={menu} className="admin-dropdown__menu mr-list-filter__menu"
      data-admin-theme={theme} data-admin-appearance={appearance} style={position} onKeyDown={keyDown}
      onBlur={(event) => { if (!root.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) close(); }}>
      <div id={`${id}-options`} role="listbox" aria-label={label} aria-busy={!options && status === 'loading'}>
        {matches.map((choice, index) => <div key={choice.value} id={`${id}-option-${index}`} role="option"
          aria-selected={choice.value === value} className={`mr-list-filter__option${index === active ? ' mr-list-filter__option--active' : ''}`}
          onPointerDown={(event) => event.preventDefault()} onClick={() => choose(choice)}>
          <span>{choice.label}</span>{choice.value === value && <Check size={15} aria-hidden="true" />}
        </div>)}
      </div>
      <div className="mr-list-filter__feedback" role="status">
        {!options && status === 'loading' ? 'Loading choices…'
          : !options && status === 'error' ? 'Choices could not be loaded.'
            : !choices.length || (!options && !total) ? (query.trim() ? 'No matches found.' : emptyGuidance)
              : !options ? `Showing up to ${offset} of ${total} choices.` : ''}
      </div>
      {error && <p className="mr-list-filter__feedback" role="alert">{error}</p>}
      {!options && status === 'error' && <button type="button" className="mr-list-filter__action" onClick={() => { input.current?.focus(); setRevision((n) => n + 1); }}>Retry</button>}
      {!options && status === 'ready' && offset < total && <button type="button" className="mr-list-filter__action" aria-disabled={more || undefined}
        onClick={loadMore} data-testid={`button-more-mr-${kind}`}>{more ? 'Loading…' : error ? 'Retry load more' : 'Load more'}</button>}
    </div>, document.body)}
  </div>;
}
