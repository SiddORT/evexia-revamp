import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { containDialogTab } from './dialogKeyboard.js';
import { getOpening, money, valueMoney, locationLabel } from '../../services/openingStock.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import '../../inventoryServer.css';
import '../../openingStock.css';

export default function OpeningDrawer({ id, onClose, returnFocusTo }) {
  const { date } = useAdminDateFormatters();
  const dialogRef = useRef(null);
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // React autofocus may already have moved focus before this effect runs.
    const dialog = dialogRef.current; const prev = returnFocusTo || document.activeElement; const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.showModal();
    return () => {
      dialog.close(); document.body.style.overflow = overflow;
      // Search/freshness requests can replace the table row while modal.
      const target = prev?.isConnected ? prev : prev?.id ? document.getElementById(prev.id) : null;
      target?.focus();
    };
  }, [returnFocusTo]);
  useEffect(() => {
    const c = new AbortController();
    setState({ data: null, loading: true, error: '' });
    getOpening(id, c.signal)
      .then((data) => { if (!c.signal.aborted) setState({ data, loading: false, error: '' }); })
      .catch((e) => { if (!c.signal.aborted) setState({ data: null, loading: false, error: e.message || 'Opening stock could not be loaded.' }); });
    return () => c.abort();
  }, [id, tick]);
  function backdrop(event) {
    if (event.target !== event.currentTarget) return;
    const b = event.currentTarget.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose();
  }
  const o = state.data;
  return <dialog ref={dialogRef} className="opening-stock-detail" aria-labelledby="opening-drawer-heading" onKeyDown={containDialogTab} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={backdrop} data-testid="drawer-opening-detail">
    <header className="opening-stock-detail__header">
      <h2 id="opening-drawer-heading">Opening stock details</h2>
      <button type="button" className="admin-icon-button opening-stock-detail__close" onClick={onClose} autoFocus aria-label="Close opening stock details" data-testid="button-close-opening-detail"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="opening-stock-detail__body" tabIndex={0} role="region" aria-label="Opening stock detail content">
      {state.loading && <div role="status" className="admin-empty"><strong>Loading opening stock…</strong></div>}
      {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      {o && <dl className="opening-stock-detail__fields">
          <div><dt>Item</dt><dd>{o.productName}<span className="stock-sub">{o.itemKind === 'combo' ? 'Finished product (whole combos)' : 'Allergen'}</span></dd></div>
          <div><dt>Quantity</dt><dd className="inv-mono">{o.quantity} {o.unit}</dd></div>
          <div><dt>Unit rate</dt><dd className="inv-mono">{money(o.unitRate)}</dd></div>
          <div><dt>Opening value</dt><dd className="inv-mono">{valueMoney(o.openingValue)}</dd></div>
          <div><dt>Location</dt><dd>{locationLabel(o.location)}</dd></div>
          <div><dt>Recorded date</dt><dd>{date(o.recordedDate)}</dd></div>
          <div><dt>Expiry date</dt><dd>{o.expiryDate ? date(o.expiryDate) : 'Unknown / unavailable'}</dd></div>
        </dl>}
    </div>
  </dialog>;
}
