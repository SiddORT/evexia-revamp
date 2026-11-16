import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export const KIND_LABELS = { IT: 'Immunotherapy', Kit: 'Kits & Consumables', SPT: 'SPT', Lupin: 'Lupin' };
export const KIND_ORDER = ['IT', 'Kit', 'SPT', 'Lupin'];
const fmt = (n) => new Intl.NumberFormat('en-IN').format(n);

// Always present all four types, including zero counts, in fixed order.
export function fullBreakdown(byType) {
  // The response validator requires all four rows. Never fabricate a missing
  // row as zero if the reporting contract is violated.
  return KIND_ORDER.map((kind) => byType.find((r) => r.kind === kind));
}

/** Order-count card with a viewport-safe four-type disclosure (hover, focus, tap). */
export default function DashboardCountCard({ icon: Icon, label, total, byType, tone = 'status', scope, testId }) {
  const id = useId();
  const card = useRef(null);
  const panel = useRef(null);
  const timer = useRef(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const host = card.current?.closest('.admin-shell') || (typeof document !== 'undefined' ? document.body : null);
  const rows = fullBreakdown(byType);
  const cancel = () => window.clearTimeout(timer.current);
  const dismiss = () => { cancel(); pinned.current = false; setOpen(false); };
  const leave = () => {
    cancel();
    timer.current = window.setTimeout(() => {
      if (!pinned.current && !card.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!card.current?.contains(e.target) && !panel.current?.contains(e.target)) dismiss(); };
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(); } };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    const update = () => {
      if (!card.current || !panel.current) return;
      const a = card.current.getBoundingClientRect();
      const vv = window.visualViewport;
      const left = (vv?.offsetLeft || 0) + 8, top = (vv?.offsetTop || 0) + 8;
      const right = left + (vv?.width || window.innerWidth) - 16, bottom = top + (vv?.height || window.innerHeight) - 16;
      if (a.bottom < top || a.top > bottom) { dismiss(); return; }
      const b = panel.current.getBoundingClientRect();
      const below = bottom - a.bottom - 6, above = a.top - top - 6;
      const y = below >= b.height || below >= above ? a.bottom + 6 : a.top - b.height - 6;
      setPosition({ left: Math.max(left, Math.min(a.left, right - b.width)), top: Math.max(top, Math.min(y, bottom - b.height)),
        maxWidth: right - left, maxHeight: bottom - top });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(panel.current); ro.observe(card.current);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, byType]);

  return <div ref={card} className={`mrd-card mrd-card--${tone}`} data-testid={testId}
    onPointerEnter={(e) => { if (e.pointerType !== 'touch') { cancel(); setOpen(true); } }}
    onPointerLeave={leave}
    onFocus={() => { cancel(); setOpen(true); }}
    onBlur={() => { pinned.current = false; leave(); }}>
    <span className="mrd-card__icon" aria-hidden="true"><Icon size={17} /></span>
    <div className="mrd-card__body">
      <strong data-testid={testId ? `${testId}-value` : undefined}>{fmt(total)}</strong>
      <span>{label}</span>
    </div>
    <button type="button" className="mrd-card__info" aria-label={`${label}: ${fmt(total)} orders, breakdown by order type`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
      data-testid={testId ? `button-${testId}-breakdown` : undefined}
      onClick={() => { if (pinned.current) dismiss(); else { cancel(); pinned.current = true; setOpen(true); } }}>
      <Info size={15} aria-hidden="true" />
    </button>
    {open && host && createPortal(<div ref={panel} id={id} role="tooltip" className="mrd-breakdown"
      style={{ left: position?.left ?? 8, top: position?.top ?? 8, maxWidth: position?.maxWidth,
        maxHeight: position?.maxHeight, visibility: position ? 'visible' : 'hidden' }}
      onPointerEnter={cancel} onPointerLeave={leave}>
      <strong>{label} · {fmt(total)}</strong>
      <p>{scope}</p>
      <dl>{rows.map((r) => <div key={r.kind}><dt>{KIND_LABELS[r.kind]}</dt><dd>{fmt(r.count)} <span>({total === 0 ? '0.00' : r.percentage}%)</span></dd></div>)}</dl>
      <small>Share of this card’s total · Esc or tap outside to dismiss</small>
    </div>, host)}
  </div>;
}

/** Deferred financial card: never a zero, never a fabricated split. */
export function PendingCard({ icon: Icon, label, testId }) {
  return <div className="mrd-card mrd-card--pending" data-testid={testId}>
    <span className="mrd-card__icon" aria-hidden="true"><Icon size={17} /></span>
    <div className="mrd-card__body">
      <strong aria-label={`${label}: not yet defined`}>—</strong>
      <span>{label}</span>
      <small>Definition pending · type split pending</small>
    </div>
  </div>;
}

export function DirectoryCard({ icon: Icon, label, value, note, testId }) {
  return <div className="mrd-card mrd-card--directory" data-testid={testId}>
    <span className="mrd-card__icon" aria-hidden="true"><Icon size={17} /></span>
    <div className="mrd-card__body"><strong>{fmt(value)}</strong><span>{label}</span>{note && <small>{note}</small>}</div>
  </div>;
}
