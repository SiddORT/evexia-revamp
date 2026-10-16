import { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Star } from 'lucide-react';
import { formatAdminDate, useAdminPreferences } from '../components/admin/adminPreferences.js';
import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './doctorStore.js';
import TablePagination from '../components/admin/TablePagination.jsx';

export const GuardContext = createContext(null);
export const useGuard = () => useContext(GuardContext);
export const useDemo = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export function useFmt() {
  const prefs = useAdminPreferences();
  return (value) => formatAdminDate(value, prefs);
}

/** Registers unsaved-draft state with the portal guard. */
export function useDirty(dirty, nativeConfirmation = false) {
  const guard = useGuard();
  useEffect(() => {
    guard.dirtyRef.current = Boolean(dirty);
    guard.nativeConfirmRef.current = nativeConfirmation && Boolean(dirty);
  }, [dirty, nativeConfirmation, guard]);
  useEffect(() => () => { guard.dirtyRef.current = false; guard.nativeConfirmRef.current = false; }, [guard]);
}

export function A({ to, children, className, ...rest }) {
  const guard = useGuard();
  return (
    <Link href={to} className={className} {...rest} onClick={(event) => {
      if (guard.dirtyRef.current) { event.preventDefault(); guard.go(to); }
    }}>{children}</Link>
  );
}

export function Head({ eyebrow, title, description, actions }) {
  return (
    <div className="admin-page-head dr-head">
      <div>
        <p className="admin-page-head__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="admin-page-head__description">{description}</p>}
      </div>
      {actions && <div className="dr-head__actions dr-noprint">{actions}</div>}
    </div>
  );
}

const TONES = { Paid: 'ok', Completed: 'ok', Delivered: 'ok', Overdue: 'bad', Unpaid: 'bad', Upcoming: 'warn', Placed: 'warn', Shipped: 'warn', 'Partially paid': 'warn', Draft: 'mute' };
export function Badge({ status }) {
  const tone = TONES[status] || 'mute';
  return <span className={`admin-badge dr-badge dr-badge--${tone}`}>{status || 'Unknown'}</span>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="admin-empty dr-empty" role="status">
      <svg className="dr-empty__art" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" /><circle cx="32" cy="32" r="4" fill="currentColor" /><circle cx="32" cy="14" r="3" fill="currentColor" /><circle cx="48" cy="40" r="3" fill="currentColor" /><circle cx="17" cy="42" r="3" fill="currentColor" /></svg>
      <strong>{title}</strong>
      <p>{children}</p>
      {action && <div className="dr-empty__action">{action}</div>}
    </div>
  );
}

export function Field({ id, label, error, hint, children }) {
  return (
    <div className={`dr-field${error ? ' dr-field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && <small className="dr-field__error" id={`${id}-err`} role="alert">{error}</small>}
    </div>
  );
}
export const describe = (id, error, hint) => [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;

export function Stars({ value, label = true }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return (
    <span className="dr-stars" role="img" aria-label={`${Number(value || 0).toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={15} aria-hidden="true" fill={i <= n ? 'currentColor' : 'none'} />)}
      {label && <span className="dr-stars__n">{Number(value) ? Number(value).toFixed(1) : '-'}</span>}
    </span>
  );
}

export function Steps({ steps, current }) {
  return (
    <ol className="dr-steps" aria-label="Progress">
      {steps.map((s, i) => <li key={s} className={i === current ? 'is-current' : i < current ? 'is-done' : ''} aria-current={i === current ? 'step' : undefined}><span>{i + 1}</span>{s}</li>)}
    </ol>
  );
}

export function Notice({ tone = 'info', children }) {
  return <div className={`admin-feedback dr-notice${tone === 'error' ? ' admin-feedback--error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Row({ to, title, sub, badge, meta }) {
  return (
    <A to={to} className="dr-row">
      <span className="dr-row__main"><strong>{title}</strong>{sub && <small>{sub}</small>}</span>
      <span className="dr-row__side">{meta && <small>{meta}</small>}{badge}</span>
    </A>
  );
}

export function RecordList({ rows, label, total = rows.length, render }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(5);
  const signature = rows.map((row) => row.id).join('|');
  useEffect(() => setPage(1), [signature]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  return <>
    <div className="dr-rows">{rows.slice((current - 1) * size, current * size).map(render)}</div>
    <TablePagination page={current} pageCount={pages} pageSize={size} filtered={rows.length} total={total} label={label}
      onPageChange={setPage} onPageSizeChange={(value) => { setSize(value); setPage(1); }} />
  </>;
}

export function PrintPageStyle() {
  // The page-size rule exists only while a Doctor print preview is mounted.
  return <style media="print">{'@page { size: A4; margin: 14mm; }'}</style>;
}

export function useTimers() {
  const [timers] = useState(() => new Set());
  useEffect(() => () => { timers.forEach(clearTimeout); }, [timers]);
  return (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
}

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
export const msg = (e) => (e && e.message) || 'Something went wrong. Check the entries and try again.';
