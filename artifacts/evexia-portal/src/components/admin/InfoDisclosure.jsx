import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const GAP = 8;

export default function InfoDisclosure({ id, title, text, children, testId, interactive = false }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const tooltipRef = useRef(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const pinned = useRef(false);
  const host = buttonRef.current?.closest('.admin-dialog-backdrop, .admin-shell');

  useLayoutEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;
      if (!button || !tooltip) return;
      const anchor = button.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight || anchor.right < 0 || anchor.left > window.innerWidth) {
        pinned.current = false;
        setOpen(false);
        return;
      }
      const box = tooltip.getBoundingClientRect();
      const left = Math.max(GAP, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - GAP));
      const below = window.innerHeight - anchor.bottom - GAP;
      const above = anchor.top - GAP;
      const top = below >= box.height || below >= above
        ? Math.min(anchor.bottom + GAP, window.innerHeight - box.height - GAP)
        : Math.max(GAP, anchor.top - box.height - GAP);
      setPosition({ left, top: Math.max(GAP, top) });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    const observer = new ResizeObserver(updatePosition);
    observer.observe(tooltipRef.current);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
      observer.disconnect();
    };
  }, [open, text]);

  useEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    function dismiss(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        pinned.current = false;
        if (interactive && tooltipRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
        setOpen(false);
      }
    }
    function outside(event) {
      if (!buttonRef.current?.contains(event.target) && !(interactive && tooltipRef.current?.contains(event.target))) {
        pinned.current = false;
        setOpen(false);
      }
    }
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open, interactive]);

  return <div className="admin-info">
    <div className="admin-info__row">
      {children}
      <button ref={buttonRef} type="button" className="admin-info__button" aria-label={`About ${title}`}
        aria-expanded={open} aria-describedby={open ? id : undefined}
        aria-controls={interactive && open ? id : undefined}
        data-admin-info-open={open} data-testid={testId}
        onMouseEnter={() => { hovered.current = true; setOpen(true); }}
        onMouseLeave={() => {
          hovered.current = false;
          if (!interactive && !focused.current && !pinned.current) setOpen(false);
        }}
        onFocus={() => { focused.current = true; setOpen(true); }}
        onBlur={(event) => {
          focused.current = false;
          if (interactive && tooltipRef.current?.contains(event.relatedTarget)) return;
          pinned.current = false;
          if (!hovered.current) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (interactive && open && event.key === 'Tab' && !event.shiftKey) {
            const link = tooltipRef.current?.querySelector('a[href]');
            if (link) { event.preventDefault(); link.focus(); }
          }
        }}
        onClick={() => {
          if (pinned.current) {
            pinned.current = false;
            setOpen(false);
          } else {
            pinned.current = true;
            setOpen(true);
          }
        }}><Info size={16} aria-hidden="true" /></button>
    </div>
    {open && host && createPortal(
      <div id={id} ref={tooltipRef} role={interactive ? 'region' : 'tooltip'} aria-label={interactive ? `About ${title}` : undefined}
        className="admin-info__text"
        onBlur={interactive ? (event) => {
          if (!tooltipRef.current?.contains(event.relatedTarget) && event.relatedTarget !== buttonRef.current) {
            pinned.current = false; setOpen(false);
          }
        } : undefined}
        onKeyDown={interactive ? (event) => {
          const links = [...tooltipRef.current.querySelectorAll('a[href]')];
          if (event.key === 'Tab' && event.shiftKey && event.target === links[0]) {
            event.preventDefault(); buttonRef.current.focus();
          } else if (event.key === 'Tab' && !event.shiftKey && event.target === links.at(-1)) {
            // The panel is portalled. Resume the form's natural focus order.
            event.preventDefault();
            const scope = buttonRef.current.closest('.admin-dialog') || document;
            const nodes = [...scope.querySelectorAll('input, button, select, textarea, a[href], [tabindex]')]
              .filter((node) => node.tabIndex >= 0 && !node.disabled && node.getClientRects().length && !tooltipRef.current.contains(node));
            const next = nodes[nodes.indexOf(buttonRef.current) + 1] || buttonRef.current;
            next.focus(); pinned.current = false; setOpen(false);
          }
        } : undefined}
        style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden',
          ...(interactive ? { pointerEvents: 'auto' } : {}) }}>{text}</div>,
      host,
    )}
  </div>;
}