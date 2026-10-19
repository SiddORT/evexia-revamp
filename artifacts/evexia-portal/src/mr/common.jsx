import { createContext, useContext } from 'react';
import { Link } from 'wouter';
import { Lock } from 'lucide-react';
import useConfirmedNavigation from '../auth/useConfirmedNavigation.js';
import { formatAdminDate, useAdminPreferences } from '../components/admin/adminPreferences.js';

export const WsContext = createContext(null);
export const useWs = () => useContext(WsContext);

export function useDate() {
  const prefs = useAdminPreferences();
  return (value) => formatAdminDate(value, prefs);
}

// In-app menu/link and history confirmation; tab close cannot use custom HTML.
export function useDirtyGuard(dirty) {
  useConfirmedNavigation({ dirty }, 'Discard your unsaved changes? This demo form is not saved anywhere.');
}

export function Head({ eyebrow, title, text, children }) {
  return <div className="mrw-head"><div>{eyebrow && <p className="mrw-eyebrow">{eyebrow}</p>}<h1 tabIndex={-1} data-testid="heading-mr-page">{title}</h1>{text && <p>{text}</p>}</div>{children && <div className="mrw-actions">{children}</div>}</div>;
}

export function Field({ id, label, error, hint, children }) {
  return <div className="mrw-field"><label htmlFor={id}>{label}</label>{children}{hint && <small id={`${id}-hint`}>{hint}</small>}{error && <span className="mrw-err" id={`${id}-error`} role="alert">{error}</span>}</div>;
}

export function PatientLock() {
  return <div className="mrw-lock" data-testid="patient-restricted"><Lock size={20} aria-hidden="true" /><div>Patient details restricted<small>Patient information is never available in the MR workspace.</small></div></div>;
}

export function Empty({ title, text, to, action }) {
  return <div className="mrw-empty"><strong>{title}</strong><span>{text}</span>{to && <Link href={to} className="admin-button">{action}</Link>}</div>;
}

export function Meter({ percentage, fill, label }) {
  const pct = Number(percentage) || 0;
  const width = Math.max(0, Math.min(100, Number(fill ?? pct)));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(pct))} aria-valuetext={`${pct.toFixed(1)} percent of target`} className="mrw-meter" data-testid="meter-sales"><div className="mrw-meter__fill" style={{ width: `${width}%` }} /></div>;
}

export const statusPill = (s) => <span className={`mrw-pill${s === 'placed' || s === 'Paid' || s === 'active' ? ' mrw-pill--ok' : s === 'Unpaid' || s === 'cancelled' ? ' mrw-pill--warn' : ''}`}>{s ? s[0].toUpperCase() + s.slice(1) : ''}</span>;
