import { useEffect, useRef, useState } from 'react';
import { useResourceActions } from '../../auth/useMasterActions.js';
import { X } from 'lucide-react';
import { containDialogTab } from './dialogKeyboard.js';
import { getOpening, openingActivity, openingAnalytics, money, valueMoney, locationLabel } from '../../services/openingStock.js';
import { useAdminDateFormatters } from './adminPreferences.js';
import '../../poActivityDrawer.css';
import '../../inventoryServer.css';

export default function OpeningDrawer({ id, onClose, returnFocusTo }) {
  const can = useResourceActions('opening_stock');
  const { date, timestamp } = useAdminDateFormatters();
  const dialogRef = useRef(null);
  const [state, setState] = useState({ data: null, activity: [], summary: null, loading: true, error: '' });
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
    setState({ data: null, activity: [], summary: null, loading: true, error: '' });
    Promise.all([getOpening(id, c.signal), can.protected ? openingActivity(id, { limit: 50 }, c.signal) : Promise.resolve({ items: [] }), can.protected ? openingAnalytics(id, c.signal) : Promise.resolve(null)])
      .then(([data, act, summary]) => setState({ data, activity: act.items || [], summary, loading: false, error: '' }))
      .catch((e) => { if (!c.signal.aborted) setState({ data: null, activity: [], summary: null, loading: false, error: e.message || 'Opening stock could not be loaded.' }); });
    return () => c.abort();
  }, [id, tick, can.protected]);
  function backdrop(event) {
    if (event.target !== event.currentTarget) return;
    const b = event.currentTarget.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose();
  }
  const o = state.data; const s = state.summary;
  return <dialog ref={dialogRef} className="po-activity-drawer" aria-labelledby="opening-drawer-heading" onKeyDown={containDialogTab} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={backdrop} data-testid="drawer-opening-detail">
    <header className="po-activity-drawer__header">
      <div><p className="po-activity-drawer__number">{o ? o.productName : 'Opening stock'}</p><h2 id="opening-drawer-heading">Opening stock details</h2></div>
      <button type="button" className="po-action po-activity-drawer__close" onClick={onClose} autoFocus aria-label="Close opening stock details" data-testid="button-close-opening-detail"><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="po-activity-drawer__body" tabIndex={0} role="region" aria-label="Opening stock detail content">
      <p className="po-activity-drawer__description">Append-only stock initialization record. It cannot be edited or deleted. Later movements are recorded in Move Stocks.</p>
      {state.loading && <div role="status" className="admin-empty"><strong>Loading opening stock…</strong></div>}
      {state.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{state.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      {o && <>
        <dl className="stock-report__meta">
          <div><dt>Item</dt><dd>{o.productName}<span className="stock-sub">{o.itemKind === 'combo' ? 'Finished product (whole combos)' : 'Allergen'}</span></dd></div>
          <div><dt>Quantity</dt><dd className="inv-mono">{o.quantity} {o.unit}</dd></div>
          <div><dt>Unit rate</dt><dd className="inv-mono">{money(o.unitRate)}</dd></div>
          <div><dt>Opening value</dt><dd className="inv-mono">{valueMoney(o.openingValue)}</dd></div>
          <div><dt>Location</dt><dd>{locationLabel(o.location)}{!o.location?.id && <span className="stock-sub">Not assigned to a physical location. Allocate through Move Stocks.</span>}</dd></div>
          <div><dt>Recorded date</dt><dd>{date(o.recordedDate)}</dd></div>
          <div><dt>Saved by (server)</dt><dd>{o.actor}</dd></div>
          <div><dt>Created</dt><dd>{timestamp(o.createdAt)}</dd></div>
          <div><dt>Before / after</dt><dd className="inv-mono">{o.before} to {o.after}</dd></div>
          <div><dt>Lot</dt><dd className="inv-mono">{o.lotId}</dd></div>
          <div><dt>Item ID</dt><dd className="inv-mono">{o.itemId}</dd></div>
          <div><dt>Source / row ID</dt><dd className="inv-mono">{o.sourceId} / {o.rowId}</dd></div>
        </dl>
        <p className="mr-form__hint" data-testid="text-opening-historical">{o.historicalData}</p>
        {can.protected && <section className="inv-drawer-section"><h3>Server activity</h3>
          {state.activity.length ? <div className="po-activity">{state.activity.map((a, i) => <article className="po-event" key={`${a.at}-${i}`}><div><strong className="po-activity-drawer__action">{a.action}</strong><p>{timestamp(a.at)} · {a.actor}{a.requestId ? ` · request ${a.requestId}` : ''}</p></div></article>)}</div> : <p>No activity recorded.</p>}
        </section>}
        {s && <section className="inv-drawer-section"><h3>Totals</h3>
          <p>{s.records} record{s.records === 1 ? '' : 's'}, {s.imports} import{s.imports === 1 ? '' : 's'}. {s.scope}</p>
          {s.breakdown?.length > 0 && <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Item</th><th scope="col">Location</th><th scope="col">Quantity</th><th scope="col">Value</th></tr></thead>
            <tbody>{s.breakdown.map((b, i) => <tr key={`${b.itemId}-${b.locationId || 'u'}-${i}`}><td>{b.productName}</td><td>{b.locationId ? b.locationName : 'Unallocated'}</td><td className="inv-mono">{b.quantity} {b.unit}</td><td className="inv-mono">{valueMoney(b.openingValue)}</td></tr>)}</tbody></table></div>}
        </section>}
      </>}
    </div>
  </dialog>;
}
