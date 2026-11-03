import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Bell, Check, CircleAlert, RefreshCw, X } from 'lucide-react';
import { orderNotificationRequest } from '../../auth/adminSession.js';
import { interceptNavigation } from '../../auth/navigationGuard.js';
import './notificationBell.css';

const BASE_POLL = 45000;
const MAX_POLL = 300000;
const MAX_ITEMS = 25;
const SLUGS = { immunotherapy: 'immunotherapy', spt: 'spt', lupin: 'lupin', kits: 'kits-consumables' };
const UUID = /^[0-9a-f-]{36}$/i;

function safeList(data) {
  if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.unreadCount) || data.unreadCount < 0) throw new Error('Notifications returned an invalid response.');
  return {
    unread: data.unreadCount,
    items: data.items.filter((n) => n && typeof n.id === 'string' && UUID.test(n.id)).slice(0, MAX_ITEMS).map((n) => ({
      id: n.id, event: String(n.event ?? ''), kind: String(n.kind ?? ''), number: String(n.number ?? ''), status: String(n.status ?? ''),
      mrName: n.mrName ? String(n.mrName) : '', createdAt: n.createdAt, amount: typeof n.amount === 'string' ? n.amount : null, read: n.read === true,
      message: typeof n.message === 'string' ? n.message : null,
    })),
  };
}
const EVENT_NAMES = { order_placed: 'Order placed', order_confirmed: 'Order confirmed', order_rejected: 'Order rejected', order_resubmitted: 'Order resubmitted', order_shipped: 'Order shipped', order_delivered: 'Order delivered', order_returned: 'Order returned', order_transaction: 'Order transaction' };
const eventName = (e) => EVENT_NAMES[e] || (/^[a-z_]+$/.test(e) ? e.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : e) || 'Order update';
const when = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const kindLabel = (k) => ({ immunotherapy: 'Immunotherapy', spt: 'SPT', lupin: 'Lupin', kits: 'Kits & Consumables' })[k] || 'Order';

/**
 * Account-scoped bell. Parent must key this component by identity so state is
 * dropped on any identity/session change. Only rendered for Super Admin and MR.
 */
export default function NotificationBell({ portal }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rowError, setRowError] = useState({});
  const [busyId, setBusyId] = useState(null);
  const wrapRef = useRef(null), panelRef = useRef(null), btnRef = useRef(null);
  const alive = useRef(true), seq = useRef(0), timer = useRef(null), delay = useRef(BASE_POLL), ctrl = useRef(null);

  const load = useCallback(async () => {
    const n = ++seq.current;
    ctrl.current?.abort(); const ac = new AbortController(); ctrl.current = ac;
    try {
      const next = safeList(await orderNotificationRequest('/notifications', undefined, { signal: ac.signal }));
      if (!alive.current || n !== seq.current) return;
      setData(next); setError(''); delay.current = BASE_POLL;
    } catch (e) {
      if (!alive.current || n !== seq.current || ac.signal.aborted) return;
      setError(e?.message || 'Unable to load notifications.');
      delay.current = Math.min(MAX_POLL, delay.current * 2);
      if (e?.status === 401 || e?.status === 403) delay.current = MAX_POLL;
    } finally { if (alive.current && n === seq.current) setLoading(false); }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    if (typeof document !== 'undefined' && document.hidden) return;
    timer.current = setTimeout(async () => { await load(); if (alive.current) schedule(); }, delay.current);
  }, [load]);

  useEffect(() => {
    alive.current = true;
    void load().then(() => { if (alive.current) schedule(); });
    const vis = () => {
      if (document.hidden) clearTimeout(timer.current);
      else void load().then(() => { if (alive.current) schedule(); });
    };
    document.addEventListener('visibilitychange', vis);
    return () => { alive.current = false; seq.current += 1; clearTimeout(timer.current); ctrl.current?.abort(); document.removeEventListener('visibilitychange', vis); };
  }, [load, schedule]);

  useEffect(() => {
    if (!open) return undefined;
    requestAnimationFrame(() => panelRef.current?.querySelector('button:not(:disabled)')?.focus());
    const down = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btnRef.current?.focus(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const els = [...panelRef.current.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')].filter((el) => el.getClientRects().length);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const toggle = () => { const next = !open; setOpen(next); if (next) { setRowError({}); void load(); } };

  async function setRead(item, read) {
    if (busyId) return;
    setBusyId(item.id); setRowError((r) => ({ ...r, [item.id]: '' }));
    try {
      const res = await orderNotificationRequest(`/notifications/${item.id}/read`, { read });
      if (!alive.current) return;
      const confirmed = res?.read === true;
      setData((d) => {
        if (!d) return d;
        const was = d.items.find((x) => x.id === item.id)?.read;
        const delta = was === confirmed ? 0 : confirmed ? -1 : 1;
        return { unread: Math.max(0, d.unread + delta), items: d.items.map((x) => (x.id === item.id ? { ...x, read: confirmed } : x)) };
      });
    } catch (e) { if (alive.current) setRowError((r) => ({ ...r, [item.id]: e?.message || 'Could not update read state.' })); }
    finally { if (alive.current) setBusyId(null); }
  }

  async function openTarget(item) {
    if (busyId) return;
    setBusyId(item.id); setRowError((r) => ({ ...r, [item.id]: '' }));
    try {
      const res = await orderNotificationRequest(`/notifications/${item.id}/open`, {});
      if (!alive.current) return;
      const slug = SLUGS[res?.kind];
      if (!slug || typeof res?.orderId !== 'string' || !UUID.test(res.orderId)) throw new Error('This order is unavailable. It may have been removed or its type is not supported here.');
      const href = `/${portal === 'mr' ? 'mr' : 'admin'}/orders/${slug}/${res.orderId}`;
      if (!item.read) {
        // Read state persists only via /read; never assume /open marked it.
        try {
          const r = await orderNotificationRequest(`/notifications/${item.id}/read`, { read: true });
          if (alive.current && r?.read === true) setData((d) => (d ? { unread: Math.max(0, d.unread - (d.items.find((x) => x.id === item.id)?.read ? 0 : 1)), items: d.items.map((x) => (x.id === item.id ? { ...x, read: true } : x)) } : d));
        } catch { /* Navigation still proceeds; the item stays unread until the next confirmed refresh. */ }
        if (!alive.current) return;
      }
      setOpen(false);
      if (!interceptNavigation({ kind: 'href', href })) navigate(href);
    } catch (e) { if (alive.current) setRowError((r) => ({ ...r, [item.id]: e?.message || 'This order is unavailable.' })); }
    finally { if (alive.current) setBusyId(null); }
  }

  const unread = data?.unread || 0;
  const badge = unread > 99 ? '99+' : String(unread);
  return <div className="nb" ref={wrapRef} data-portal={portal}>
    <button ref={btnRef} type="button" className="nb__trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls="nb-panel"
      aria-label={`Order notifications${unread ? `, ${unread} unread` : ''}`} onClick={toggle} data-testid="button-notifications">
      <Bell size={18} aria-hidden="true" />
      {unread > 0 && <span className="nb__badge" aria-hidden="true" data-testid="text-notification-unread">{badge}</span>}
      {error && !data && <span className="nb__dot" aria-hidden="true" />}
    </button>
    {open && <div ref={panelRef} id="nb-panel" className="nb__panel" role="dialog" aria-modal="false" aria-labelledby="nb-title">
      <div className="nb__head">
        <div><h2 id="nb-title">Order activity</h2><p>{unread ? `${unread} unread` : 'All caught up'} · latest {MAX_ITEMS}</p></div>
        <div className="nb__head-actions">
          <button type="button" className="nb__icon" onClick={() => void load()} aria-label="Refresh notifications" data-testid="button-notifications-refresh"><RefreshCw size={15} aria-hidden="true" /></button>
          <button type="button" className="nb__icon" onClick={() => { setOpen(false); btnRef.current?.focus(); }} aria-label="Close notifications" data-testid="button-notifications-close"><X size={15} aria-hidden="true" /></button>
        </div>
      </div>
      {error && <div className="nb__error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{error}{data ? ' Showing last loaded list.' : ''}</span><button type="button" onClick={() => void load()} data-testid="button-notifications-retry">Retry</button></div>}
      {loading && !data && <ul className="nb__list" aria-busy="true" aria-label="Loading notifications">{[0, 1, 2].map((i) => <li key={i} className="nb__skel"><span /><span /></li>)}</ul>}
      {data && !data.items.length && <div className="nb__empty" data-testid="status-notifications-empty"><Bell size={22} aria-hidden="true" /><strong>No order activity yet</strong><span>Placed, confirmed, shipped and other order events you can access appear here.</span></div>}
      {data && data.items.length > 0 && <ul className="nb__list" aria-label="Recent order notifications">{data.items.map((n) => <li key={n.id} className={`nb__item${n.read ? '' : ' nb__item--unread'}`} data-testid={`row-notification-${n.id}`}>
        <button type="button" className="nb__open" disabled={busyId === n.id} onClick={() => void openTarget(n)} aria-label={`${n.read ? '' : 'Unread. '}${n.message || `${eventName(n.event)} for ${kindLabel(n.kind)} order ${n.number}.`} Open order.`} data-testid={`button-open-notification-${n.id}`}>
          <span className="nb__line"><strong>{eventName(n.event)}</strong><span className="nb__kind">{kindLabel(n.kind)}</span></span>
          <span className="nb__meta">#{n.number}{n.status ? ` · ${n.status}` : ''}{n.mrName ? ` · ${n.mrName}` : ''}{n.amount ? ` · ${n.amount}` : ''}</span>
          {n.message && <span className="nb__message">{n.message}</span>}
          <span className="nb__time">{when(n.createdAt)}</span>
        </button>
        <button type="button" className="nb__mark" disabled={busyId === n.id} onClick={() => void setRead(n, !n.read)} aria-label={n.read ? `Mark ${n.number} unread` : `Mark ${n.number} read`} title={n.read ? 'Mark unread' : 'Mark read'} data-testid={`button-toggle-read-${n.id}`}>
          {n.read ? <span className="nb__ring" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
        </button>
        {rowError[n.id] && <p className="nb__row-error" role="alert">{rowError[n.id]}</p>}
      </li>)}</ul>}
    </div>}
  </div>;
}
