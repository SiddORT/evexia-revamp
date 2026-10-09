import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useAdminPreferences } from './adminPreferences.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';

// Form selector: displayed search text is never the submitted assignment.
export default function MRFormCombobox({ id, label, value, selectedLabel, choices, onChange, onSearch,
  placeholder, required, invalid, describedBy, feedback, loading, action, testId, onDismiss }) {
  const { theme, appearance } = useAdminPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState(null);
  const root = useRef(null);
  const menu = useRef(null);
  const input = useRef(null);
  const matches = onSearch ? choices : choices.filter((choice) =>
    choice.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  function close() {
    setOpen(false); setQuery(''); setActive(-1);
    onDismiss?.();
  }
  function openMenu() {
    if (!open) { setOpen(true); setQuery(''); setActive(-1); onSearch?.(''); }
  }
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => { if (getSession().user?.id !== owner) { setOpen(false); setQuery(''); setActive(-1); } });
  }, []);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = root.current.getBoundingClientRect();
      const height = window.visualViewport?.height || window.innerHeight;
      const viewportWidth = window.visualViewport?.width || window.innerWidth;
      const width = Math.min(Math.max(rect.width, 220), viewportWidth - 24);
      const below = height - rect.bottom - 12, above = rect.top - 12;
      const up = below < 180 && above > below;
      setPosition({ left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)), width,
        maxHeight: Math.max(60, Math.min(320, (up ? above : below) - 6)),
        ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    };
    const outside = (event) => { if (!root.current?.contains(event.target) && !menu.current?.contains(event.target)) close(); };
    const scroll = (event) => { if (!menu.current?.contains(event.target)) place(); };
    place();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  // Search/paging responses can replace the active option.
  useEffect(() => { setActive(-1); }, [choices]);

  function choose(choice) {
    if (choice.disabled) return;
    onChange(choice.value); close(); input.current?.focus();
  }
  function keyDown(event) {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); close(); input.current?.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (open || event.key.startsWith('Arrow'))) {
      event.preventDefault();
      if (!open) { openMenu(); return; }
      const enabled = matches.map((choice, index) => choice.disabled ? -1 : index).filter((index) => index >= 0);
      const at = enabled.indexOf(active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : event.key === 'ArrowDown' ? Math.min(at + 1, enabled.length - 1) : Math.max(at - 1, 0);
      setActive(enabled[next] ?? -1);
    } else if (event.key === 'Enter' && event.target === input.current) {
      // Never submit the form while interacting with the selector.
      event.preventDefault();
      if (!open) openMenu();
      else if (active >= 0 && matches[active]) choose(matches[active]);
    } else if (event.key === 'Tab' && open) {
      const button = menu.current?.querySelector('button');
      if (event.target === input.current && !event.shiftKey && button) {
        event.preventDefault(); button.focus();
      } else if (menu.current?.contains(event.target)) {
        event.preventDefault();
        if (event.shiftKey) input.current?.focus();
        else {
          const tabbables = [...document.querySelectorAll('input, button, select, textarea, a[href], [tabindex]')]
            .filter((node) => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length && !menu.current?.contains(node));
          const next = tabbables[tabbables.indexOf(input.current) + 1];
          close(); next?.focus();
        }
      } else close();
    }
  }
  const blur = (event) => {
    if (!root.current?.contains(event.relatedTarget) && !menu.current?.contains(event.relatedTarget)) close();
  };
  return <div className="mr-form-combobox" ref={root}>
    <div className="mr-form-combobox__control">
      <input ref={input} id={id} name={id.replace('mr-', '')} role="combobox" aria-label={label}
        aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={open ? `${id}-options` : undefined}
        aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined}
        aria-required={Boolean(required)} aria-invalid={Boolean(invalid)} aria-describedby={describedBy}
        aria-busy={Boolean(loading)} autoComplete="off" maxLength={100}
        value={open ? query : selectedLabel || ''} title={selectedLabel || ''}
        placeholder={open ? `Search ${label.toLowerCase()}…` : placeholder}
        onClick={openMenu} onChange={(event) => {
          const next = event.target.value;
          setOpen(true); setQuery(next); setActive(-1); onSearch?.(next);
        }} onKeyDown={keyDown} onBlur={blur} data-testid={testId || `select-${id}`} />
      <button type="button" tabIndex={-1} aria-label={`Open ${label.toLowerCase()} choices`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { input.current?.focus(); if (open) close(); else openMenu(); }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
    {open && position && createPortal(<div ref={menu} className="admin-dropdown__menu mr-form-combobox__menu"
      data-admin-theme={theme} data-admin-appearance={appearance} style={position} onKeyDown={keyDown} onBlur={blur}>
      <div id={`${id}-options`} role="listbox" aria-label={label} aria-busy={Boolean(loading)}>
        {matches.map((choice, index) => <div key={choice.value} id={`${id}-option-${index}`} role="option"
          aria-selected={choice.value === value} aria-disabled={Boolean(choice.disabled)}
          className={`mr-form-combobox__option${active === index ? ' mr-form-combobox__option--active' : ''}`}
          onPointerDown={(event) => event.preventDefault()} onClick={() => choose(choice)}>
          <span>{choice.label}</span>{choice.value === value && <Check size={15} aria-hidden="true" />}
        </div>)}
      </div>
      <div className="mr-form-combobox__feedback" role="status">{feedback || (!matches.length && 'No matches found.')}</div>
      {action && <button type="button" className="mr-form-combobox__action" aria-disabled={action.pending || undefined}
        data-testid={action.testId} onClick={async () => {
          // Return focus before an async action is removed from the menu.
          input.current?.focus(); await action.run();
        }}>{action.label}</button>}
    </div>, document.body)}
  </div>;
}
