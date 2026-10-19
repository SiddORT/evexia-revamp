import { Fragment, useEffect, useRef, useState } from 'react';
import ComboProvenance from './ComboProvenance.jsx';
import { X } from 'lucide-react';
import { getMovement } from '../../services/serverInventory.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import '../../poActivityDrawer.css';
import '../../inventoryServer.css';

export default function MovementDrawer({ id, onClose }) {
  const { date, timestamp } = useAdminDateFormatters();
  const dialogRef = useRef(null);
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setState({ data: null, loading: true, error: '' });
    getMovement(id, c.signal).then((data) => setState({ data, loading: false, error: '' }))
      .catch((e) => { if (!c.signal.aborted) setState({ data: null, loading: false, error: e.message || 'Movement could not be loaded.' }); });
    return () => c.abort();
  }, [id, tick]);
  function closeOnBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const b = event.currentTarget.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose();
  }
  const m = state.data;
  const place = (p) => [p.address, p.city, p.state, p.pincode, p.countryCode].filter(Boolean).join(', ');
  return <dialog ref={dialogRef} className="po-activity-drawer" aria-labelledby="move-drawer-heading" aria-describedby="move-drawer-description"
    onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={closeOnBackdrop} data-testid="drawer-move-detail">
    <header className="po-activity-drawer__header">
      <div><p className="po-activity-drawer__number">{m ? `${m.source.name} to ${m.destination.name}` : 'Stock movement'}</p><h2 id="move-drawer-heading">Movement details</h2></div>
      <button type="button" className="po-action po-activity-drawer__close" onClick={onClose} autoFocus aria-label="Close movement details" title="Close movement details" data-testid="button-close-move-detail"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="po-activity-drawer__body">
      <p id="move-drawer-description" className="po-activity-drawer__description">Append-only server record. It cannot be edited or deleted; before and after quantities are saved as of the transfer.</p>
      {state.loading && <div role="status" className="admin-empty"><strong>Loading movement…</strong></div>}
      {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      {m && <>
        <dl className="stock-report__meta">
          <div><dt>Source</dt><dd>{m.source.name}<span className="stock-sub">{place(m.source)}</span></dd></div>
          <div><dt>Destination</dt><dd>{m.destination.name}<span className="stock-sub">{place(m.destination)}</span></dd></div>
          <div><dt>Date</dt><dd>{date(m.date)}</dd></div>
          <div><dt>Delivered by</dt><dd>{m.deliveredBy} ({m.deliveryMode === 'staff' ? 'staff' : 'other'}; recorded name, not proof of actor)</dd></div>
          <div><dt>Recorded by (server)</dt><dd>{m.actor}</dd></div>
          <div><dt>Created</dt><dd>{timestamp(m.createdAt)}</dd></div>
        </dl>
        <section className="inv-drawer-section"><h3>Items</h3>
          <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Product</th><th scope="col">Batch / receipt</th><th scope="col">Quantity</th><th scope="col">Source before / after</th><th scope="col">Destination before / after</th></tr></thead>
            <tbody>{m.lines.map((l) => <Fragment key={l.lotId}><tr><td>{l.productName}{l.itemKind === 'combo' && <span className="stock-sub">Assembled combo</span>}</td><td>{l.batchNo || 'Batch unavailable'}<span className="stock-sub">{l.receiptNumber || 'Receipt unavailable'} · exp {l.expiryDate ? date(l.expiryDate) : 'unavailable'}</span></td>
              <td className="inv-mono">{l.quantity}</td><td className="inv-mono">{l.sourceBefore} to {l.sourceAfter}</td><td className="inv-mono">{l.destinationBefore} to {l.destinationAfter}</td></tr>
              {l.itemKind === 'combo' && <tr><td colSpan={5}><ComboProvenance item={l} /></td></tr>}</Fragment>)}</tbody></table></div>
          <p className="mr-form__hint">Units: procurement quantity units. Quantities are not summed across products.</p>
        </section>
        <section className="inv-drawer-section"><h3>Server activity</h3>
          {m.activity?.length ? <div className="po-activity">{m.activity.map((a, i) => <article className="po-event" key={`${a.at}-${i}`}><div><strong className="po-activity-drawer__action">{a.action}</strong><p>{timestamp(a.at)} · {a.actor}{a.requestId ? ` · request ${a.requestId}` : ''}</p></div></article>)}</div>
            : <p>No activity recorded.</p>}
        </section>
        <section className="inv-drawer-section"><h3>Scope</h3><p>{m.summary?.movements} movement, {m.summary?.lots} lot line{m.summary?.lots === 1 ? '' : 's'}. {m.summary?.scope}</p></section>
      </>}
    </div>
  </dialog>;
}
