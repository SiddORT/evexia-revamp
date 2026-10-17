import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import './messageTemplates.css';

export default function MessageTemplateDrawer({ title, subtitle, onRequestClose, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onRequestClose); closeRef.current = onRequestClose;
  useEffect(() => {
    const d = ref.current; const prev = document.activeElement; const ov = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; d.showModal();
    return () => { d.close(); document.body.style.overflow = ov; if (prev?.isConnected) prev.focus(); };
  }, []);
  const backdrop = (e) => {
    if (e.target !== e.currentTarget) return;
    const b = e.currentTarget.getBoundingClientRect();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closeRef.current();
  };
  const focusEdge = (last = false) => {
    const targets = [...ref.current.querySelectorAll('button, input, select, textarea, iframe, a[href], [tabindex]')]
      .filter((el) => !el.hasAttribute('data-focus-boundary') && !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    (last ? targets.at(-1) : targets[0])?.focus();
  };
  const containTab = (e) => {
    if (e.key !== 'Tab') return;
    const targets = [...e.currentTarget.querySelectorAll('button, input, select, textarea, iframe, a[href], [tabindex]')]
      .filter((el) => !el.hasAttribute('data-focus-boundary') && !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    if ((e.shiftKey && document.activeElement === targets[0]) ||
      (!e.shiftKey && document.activeElement === targets.at(-1))) {
      e.preventDefault(); focusEdge(e.shiftKey);
    }
  };
  return <dialog ref={ref} className="mt-drawer" aria-labelledby="mt-drawer-h" onKeyDown={containTab} onCancel={(e) => { e.preventDefault(); closeRef.current(); }} onClick={backdrop} data-testid="drawer-template">
    <span tabIndex={0} data-focus-boundary className="mt-sr" onFocus={() => focusEdge(true)} aria-label="End of email dialog" />
    <header className="mt-drawer__head"><div><h2 id="mt-drawer-h">{title}</h2>{subtitle && <p className="mt-note">{subtitle}</p>}</div>
      <button type="button" autoFocus className="admin-button admin-button--secondary mt-drawer__x" onClick={() => closeRef.current()} aria-label="Close drawer" data-testid="button-template-close"><X size={18} aria-hidden="true" /></button></header>
    <div className="mt mt-drawer__body">{children}</div>
    <span tabIndex={0} data-focus-boundary className="mt-sr" onFocus={() => focusEdge()} aria-label="Start of email dialog" />
  </dialog>;
}
