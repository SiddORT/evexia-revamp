import { useEffect, useRef } from 'react';

// Accessible modal: focus moves in, Tab is trapped, Escape closes, focus returns.
export default function ImmDialog({ title, eyebrow, description, onClose, children, className = '', testId, returnFocusRef }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => [...node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled);
    const enter = () => (focusables()[0] || node).focus();
    enter();
    // Dropdown close-time focus may happen after the new dialog mounts.
    const frame = requestAnimationFrame(enter);
    const onKey = (event) => {
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
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKey);
      const target = returnFocusRef?.current || previous;
      if (target?.isConnected) target.focus();
    };
  }, []);
  return <div className="admin-dialog-backdrop" data-admin-theme-scope>
    <div className={`admin-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby="imm-dialog-title" aria-describedby={description ? 'imm-dialog-desc' : undefined} tabIndex={-1} ref={ref} data-testid={testId}>
      {eyebrow && <p className="admin-dialog__eyebrow">{eyebrow}</p>}
      <h2 id="imm-dialog-title">{title}</h2>
      {description && <p className="admin-dialog__description" id="imm-dialog-desc">{description}</p>}
      {children}
    </div>
  </div>;
}
