import { useEffect, useId, useRef } from 'react';
import { enterModal, isTopModal } from '../modalLayers.js';

// Accessible modal: focus moves in, Tab is trapped, Escape closes, focus returns.
export default function ImmDialog({ title, eyebrow, description, onClose, children, className = '', testId, returnFocusRef }) {
  const id = useId();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const leaveLayer = enterModal(node);
    const focusables = () => [...node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled);
    const enter = () => { if (isTopModal(node)) (focusables()[0] || node).focus(); };
    enter();
    // Dropdown close-time focus may happen after the new dialog mounts.
    const frame = requestAnimationFrame(enter);
    const onKey = (event) => {
      if (!isTopModal(node)) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      leaveLayer();
      document.removeEventListener('keydown', onKey);
      const target = returnFocusRef?.current || previous;
      if (target?.isConnected && !document.querySelector('[data-platform-confirmation]')) target.focus();
    };
  }, []);
  return <div className="admin-dialog-backdrop" data-admin-theme-scope>
    <div className={`admin-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-desc` : undefined} tabIndex={-1} ref={ref} data-testid={testId}>
      {eyebrow && <p className="admin-dialog__eyebrow">{eyebrow}</p>}
      <h2 id={`${id}-title`}>{title}</h2>
      {description && <p className="admin-dialog__description" id={`${id}-desc`}>{description}</p>}
      {children}
    </div>
  </div>;
}
