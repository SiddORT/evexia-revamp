import { useEffect, useRef } from 'react';
import { ClipboardList, X } from 'lucide-react';
import PurchaseOrderEventMeta from './PurchaseOrderEventMeta.jsx';
import '../../poActivityDrawer.css';

export default function PurchaseOrderActivityDrawer({ number, events, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function closeOnBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }
  return <dialog ref={dialogRef} id="po-order-activity" className="po-activity-drawer"
    aria-labelledby="po-activity-heading" aria-describedby="po-activity-description"
    onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={closeOnBackdrop}
    data-testid="drawer-po-activity">
    <header className="po-activity-drawer__header">
      <div><p className="po-activity-drawer__number">{number}</p><h2 id="po-activity-heading">Order activity</h2></div>
      <button type="button" className="po-action po-activity-drawer__close" onClick={onClose}
        autoFocus aria-label="Close order activity" title="Close order activity" data-testid="button-close-po-activity">
        <X size={20} aria-hidden="true" />
      </button>
    </header>
    <div className="po-activity-drawer__body">
      <p id="po-activity-description" className="po-activity-drawer__description">Local change history for this purchase order. Saved in this browser.</p>
      <p className="po-activity-drawer__count">{events.length} {events.length === 1 ? 'event' : 'events'} · Latest first</p>
      {events.length ? <div className="po-activity">
        {events.map((event) => <article className="po-event" key={event.id}>
          <div className="po-event__mark"><ClipboardList size={14} aria-hidden="true" /></div>
          <div><strong className="po-activity-drawer__action">{event.action}</strong><p>{event.summary}</p><PurchaseOrderEventMeta event={event} /></div>
        </article>)}
      </div> : <div className="admin-empty"><strong>No activity recorded</strong><p>Changes to this order will appear here.</p></div>}
    </div>
  </dialog>;
}