import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import InfoDisclosure from './InfoDisclosure.jsx';
import { enterModal, isTopModal } from '../modalLayers.js';

export default function Dialog({ title, eyebrow, description, titleInfo, onClose, children, footer, className = '' }) {
  const id = useId();
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const leaveLayer = enterModal(dialogRef.current);
    closeRef.current?.focus();
    function handleKey(event) {
      if (!isTopModal(dialogRef.current)) return;
      // Existing source drawers/previews use the browser's top-layer dialog.
      // Their own focus/Escape handlers must win over an enclosing portal dialog.
      if (event.target?.closest?.('dialog[open]')) return;
      if (event.key === 'Escape' && document.activeElement?.closest?.('.searchable-select--open')) return;
      const activeControl = document.activeElement?.closest?.('.searchable-control--open');
      const portal = document.activeElement?.closest?.('[data-searchable-owner]');
      const portalOwner = portal && document.getElementById(portal.dataset.searchableOwner);
      const ownedControl = activeControl && dialogRef.current?.contains(activeControl);
      const ownedPortal = portalOwner && dialogRef.current?.contains(portalOwner);
      if (event.key === 'Escape' && (ownedControl || ownedPortal)) return;
      // Let the combobox manage its portalled async action. Ordinary Tab from
      // its input still uses the dialog trap, including a final field.
      if (event.key === 'Tab' && (ownedPortal ||
        (ownedControl && !event.shiftKey && [...document.querySelectorAll('[data-searchable-owner]')]
          .some((node) => node.dataset.searchableOwner === document.activeElement?.id && node.querySelector('button'))))) return;
      if (event.key === 'Escape' && !dialogRef.current?.parentElement?.querySelector('[data-admin-info-open="true"]')) { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
      if (event.key === 'Tab') {
        const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])') || [])]
          .filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', handleKey, true);
    return () => {
      leaveLayer();
      document.removeEventListener('keydown', handleKey, true);
      if (previouslyFocused?.isConnected && !document.querySelector('[data-platform-confirmation]')) previouslyFocused.focus();
    };
  }, []);
  return (
    <div className="admin-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`admin-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} ref={dialogRef}>
        <div className="admin-dialog__top">
           <div><p className="admin-dialog__eyebrow">{eyebrow || 'Zone Master'}</p>
             {titleInfo ? <InfoDisclosure id={`${id}-help`} title={title} text={titleInfo} testId="button-zone-info"><h2 id={`${id}-title`}>{title}</h2></InfoDisclosure> : <h2 id={`${id}-title`}>{title}</h2>}
           </div>
          <button type="button" ref={closeRef} className="admin-icon-button" aria-label="Close dialog" onClick={onClose} data-testid="button-close-dialog"><X size={18} /></button>
        </div>
        {description && <p className="admin-dialog__description" id={`${id}-description`}>{description}</p>}
        {children}
        {footer && <div className="admin-dialog__actions">{footer}</div>}
      </section>
    </div>
  );
}