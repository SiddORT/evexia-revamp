import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function Dialog({ title, eyebrow, description, onClose, children, footer }) {
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function handleKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); }
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey, true);
      previouslyFocused?.focus?.();
    };
  }, []);
  return (
    <div className="admin-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" aria-describedby={description ? 'admin-dialog-description' : undefined} ref={dialogRef}>
        <div className="admin-dialog__top">
          <div><p className="admin-dialog__eyebrow">{eyebrow || 'Zone Master'}</p><h2 id="admin-dialog-title">{title}</h2></div>
          <button type="button" ref={closeRef} className="admin-icon-button" aria-label="Close dialog" onClick={onClose} data-testid="button-close-dialog"><X size={18} /></button>
        </div>
        {description && <p className="admin-dialog__description" id="admin-dialog-description">{description}</p>}
        {children}
        {footer && <div className="admin-dialog__actions">{footer}</div>}
      </section>
    </div>
  );
}