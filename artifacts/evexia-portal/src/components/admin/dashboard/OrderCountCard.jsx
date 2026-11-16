import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { formatCount } from './dashboardFixtures.js';

// Presentation-only disclosure; all counts come from the applied sample scope.
export default function OrderCountCard({ icon: Icon, label, total, breakdown, tone = 'status', testId }) {
  const id = useId();
  const card = useRef(null);
  const panel = useRef(null);
  const timer = useRef(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const host = card.current?.closest('.admin-shell');
  const cancelClose = () => window.clearTimeout(timer.current);
  const dismiss = () => { cancelClose(); pinned.current = false; setOpen(false); };
  const leave = () => {
    cancelClose();
    timer.current = window.setTimeout(() => {
      if (!pinned.current && !card.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!card.current?.contains(event.target) && !panel.current?.contains(event.target)) dismiss();
    };
    const escape = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    const update = () => {
      const anchor = card.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft || 0) + 8;
      const top = (viewport?.offsetTop || 0) + 8;
      const right = left + (viewport?.width || window.innerWidth) - 16;
      const bottom = top + (viewport?.height || window.innerHeight) - 16;
      if (anchor.bottom < top || anchor.top > bottom) { dismiss(); return; }
      const box = panel.current.getBoundingClientRect();
      const below = bottom - anchor.bottom - 6;
      const above = anchor.top - top - 6;
      const y = below >= box.height || below >= above ? anchor.bottom + 6 : anchor.top - box.height - 6;
      setPosition({ left: Math.max(left, Math.min(anchor.left, right - box.width)),
        top: Math.max(top, Math.min(y, bottom - box.height)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel.current);
    observer.observe(card.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, breakdown]);

  return <div ref={card} className={`dash-card dash-card--order dash-card--${tone}`} data-testid={testId}
    onPointerEnter={(event) => { if (event.pointerType !== 'touch') { cancelClose(); setOpen(true); } }}
    onPointerLeave={leave}
    onFocus={() => { cancelClose(); setOpen(true); }}
    onBlur={() => { pinned.current = false; leave(); }}>
    <span className="dash-card__icon" aria-hidden="true"><Icon size={18} /></span>
    <div className="dash-card__body"><strong>{formatCount(total)}</strong><span>{label}</span></div>
    <button type="button" className="dash-card__info" aria-label={`${label}: breakdown by order type`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
      onClick={() => {
        if (pinned.current) dismiss();
        else { cancelClose(); pinned.current = true; setOpen(true); }
      }}><Info size={16} aria-hidden="true" /></button>
    {open && host && createPortal(<div ref={panel} id={id} role="tooltip" className="dash-breakdown"
      style={{ left: position?.left ?? 8, top: position?.top ?? 8, visibility: position ? 'visible' : 'hidden' }}
      onPointerEnter={cancelClose} onPointerLeave={leave}>
      <strong>{label} · {formatCount(total)}</strong>
      <p>Sample orders by type</p>
      <dl>{breakdown.map(({ type, count, percentage }) => <div key={type}>
        <dt>{type}</dt><dd>{formatCount(count)} <span>({percentage.toFixed(1)}%)</span></dd>
      </div>)}</dl>
      <small>Share of this card’s total · Esc or tap outside to dismiss</small>
    </div>, host)}
  </div>;
}
