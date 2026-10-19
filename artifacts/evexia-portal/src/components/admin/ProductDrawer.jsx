import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { getProduct, productActivity, productAnalytics, productAssemblies } from '../../services/productMaster.js';
import { formatPrice } from '../../services/serverInventory.js';
import ComboProvenance from './ComboProvenance.jsx';
import { useAdminDateFormatters } from './adminPreferences.js';
import '../../poActivityDrawer.css';
import '../../inventoryServer.css';

const TABS = ['Details', 'Activity', 'Analytics'];
const PAGE = 25;
const CHANGED = ['name', 'mrp', 'sellingPrice', 'status'];

function changes(a) {
  if (!a.before) return 'Created';
  const out = CHANGED.filter((k) => a.before[k] !== a.after[k]).map((k) => `${k}: ${a.before[k]} to ${a.after[k]}`);
  const rb = JSON.stringify(a.before.members.map((m) => [m.allergenId, m.quantity]));
  if (rb !== JSON.stringify(a.after.members.map((m) => [m.allergenId, m.quantity]))) out.push('recipe changed');
  if (a.before.deletedAt !== a.after.deletedAt) out.push('deleted');
  return out.join('; ') || 'No field changes';
}

/** A paged server list that never drops earlier pages and ignores stale responses. */
function usePaged(fetchPage, id, tick) {
  const [s, setS] = useState({ items: [], filtered: 0, loading: true, error: '' });
  const seq = useRef(0);
  const ref = useRef(fetchPage); ref.current = fetchPage;
  const run = useCallback((offset) => {
    const mine = ++seq.current;
    setS((x) => ({ ...x, items: offset ? x.items : [], loading: true, error: '' }));
    ref.current(id, { offset, limit: PAGE }).then((d) => { if (mine === seq.current) setS((x) => ({ items: offset ? [...x.items, ...d.items] : d.items, filtered: d.filtered, loading: false, error: '' })); })
      .catch((e) => { if (mine === seq.current) setS((x) => ({ ...x, loading: false, error: e.message || 'Could not be loaded.' })); });
  }, [id]);
  useEffect(() => { run(0); return () => { seq.current++; }; }, [run, tick]);
  return { ...s, more: () => run(s.items.length), retry: () => run(s.items.length) };
}

export default function ProductDrawer({ id, onClose }) {
  const { timestamp } = useAdminDateFormatters();
  const dialogRef = useRef(null);
  const [tab, setTab] = useState('Details');
  const [tick, setTick] = useState(0);
  const [base, setBase] = useState({ product: null, analytics: null, loading: true, error: '' });
  const activity = usePaged(productActivity, id, tick);
  const assemblies = usePaged(productAssemblies, id, tick);
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
    setBase((x) => ({ ...x, loading: true, error: '' }));
    Promise.all([getProduct(id, c.signal), productAnalytics(id, c.signal)])
      .then(([product, analytics]) => setBase({ product, analytics, loading: false, error: '' }))
      .catch((e) => { if (!c.signal.aborted) setBase((x) => ({ ...x, loading: false, error: e.message || 'Product details could not be loaded.' })); });
    return () => c.abort();
  }, [id, tick]);
  function closeOnBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const b = event.currentTarget.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose();
  }
  const { product: p, analytics: sum } = base;
  const timeline = [
    ...activity.items.map((a) => ({ kind: 'product', key: `p-${a.id}`, at: a.at, a })),
    ...assemblies.items.map((a) => ({ kind: 'assembly', key: `a-${a.id}`, at: a.createdAt, a })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));
  const pager = (list, label) => <>
    {list.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{list.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={list.retry}>Retry {label}</button></div>}
    {list.items.length < list.filtered && <div className="inv-more"><button type="button" className="admin-button admin-button--secondary" disabled={list.loading} onClick={list.more} data-testid={`button-more-${label}`}>{list.loading ? 'Loading…' : `Load more ${label}`}</button><span aria-live="polite">{list.items.length} of {list.filtered} {label} shown</span></div>}
  </>;
  return <dialog ref={dialogRef} className="po-activity-drawer" aria-labelledby="product-drawer-heading" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={closeOnBackdrop} data-testid="drawer-product-detail">
    <header className="po-activity-drawer__header">
      <div><p className="po-activity-drawer__number">{p ? `Version ${p.version}` : 'Product'}</p><h2 id="product-drawer-heading">{p?.name || 'Product details'}</h2></div>
      <button type="button" className="po-activity-drawer__close" onClick={onClose} aria-label="Close product details" data-testid="button-close-product-drawer"><X size={18} /></button>
    </header>
    <div className="po-activity-drawer__body">
      <div role="group" aria-label="Detail sections" className="inv-period">{TABS.map((t) => <button key={t} type="button" aria-pressed={tab === t} className={`admin-button${tab === t ? '' : ' admin-button--secondary'}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      {base.loading && <p role="status">Loading product…</p>}
      {base.error && <div className="admin-feedback admin-feedback--error inv-banner" role="alert"><p>{base.error}</p><button type="button" className="admin-button admin-button--secondary" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      {p && tab === 'Details' && <>
        <section className="inv-drawer-section"><h3>Prices (per whole combo)</h3><p>MRP {formatPrice(p.mrp)} · Selling price {formatPrice(p.sellingPrice)} · {p.status === 'inactive' ? 'Inactive' : 'Active'}{p.deletedAt ? ' · Deleted' : ''}</p>
          <p className="mr-form__hint">Created {timestamp(p.createdAt)} by {p.createdBy}. Updated {timestamp(p.updatedAt)} by {p.updatedBy}.</p></section>
        <section className="inv-drawer-section"><h3>Current recipe, one whole combo</h3>
          <div className="inv-scroll"><table className="inv-lines"><thead><tr><th scope="col">Allergen</th><th scope="col">Quantity</th><th scope="col">Allergen status</th></tr></thead>
            <tbody>{p.members.map((m) => <tr key={m.allergenId}><td>{m.name}</td><td className="inv-mono">{m.quantity} {m.unit}</td><td>{m.available ? 'Active' : 'Unavailable (inactive or deleted)'}</td></tr>)}</tbody></table></div></section>
      </>}
      {p && tab === 'Activity' && <section className="inv-drawer-section"><h3>Recipe, price and assembly history</h3>
        {timeline.length ? <div className="po-activity">{timeline.map((t) => t.kind === 'product'
          ? <article className="po-event" key={t.key}><div><strong className="po-activity-drawer__action">{t.a.action}</strong><p>{timestamp(t.a.at)} · {t.a.actor} · version {t.a.version}</p><p className="mr-form__hint">{changes(t.a)}</p></div></article>
          : <article className="po-event" key={t.key}><div><strong className="po-activity-drawer__action">Assembled {t.a.quantity} {t.a.unit}</strong><p>{timestamp(t.a.createdAt)} · {t.a.actor} · {t.a.location?.name} · recipe v{t.a.version}</p>
            <details><summary>Provenance, batch {t.a.batchNo}</summary>
              <p>Output lot {t.a.lotId}: {t.a.outputBefore} to {t.a.outputAfter} {t.a.unit}. MRP {formatPrice(t.a.mrp)}, selling price {formatPrice(t.a.sellingPrice)}.</p>
              <ComboProvenance item={{ assemblyId: t.a.id, recipe: { version: t.a.version, members: t.a.members }, mrp: t.a.mrp, sellingPrice: t.a.sellingPrice, components: t.a.components }} /></details></div></article>)}</div>
          : activity.loading || assemblies.loading ? <p role="status">Loading history…</p> : <p>No activity recorded.</p>}
        {pager(activity, 'activity')}{pager(assemblies, 'assemblies')}</section>}
      {p && tab === 'Analytics' && sum && <section className="inv-drawer-section"><h3>Analytics</h3>
        <p>{sum.assemblies} assembl{sum.assemblies === 1 ? 'y' : 'ies'}.</p>
        <h4>Assembled quantity</h4>{sum.assembled?.length ? <ul className="ms-totals">{sum.assembled.map((a) => <li key={a.productId}>{a.productName}: {a.quantity} {a.unit}</li>)}</ul> : <p>None assembled.</p>}
        <h4>Remaining by location</h4>{sum.remaining?.length ? <ul className="ms-totals">{sum.remaining.map((a) => <li key={`${a.productId}-${a.locationId}`}>{a.locationName}: {a.quantity} {a.unit}</li>)}</ul> : <p>No remaining stock.</p>}
        {sum.scope && <p className="mr-form__hint">{sum.scope}</p>}</section>}
    </div>
  </dialog>;
}
