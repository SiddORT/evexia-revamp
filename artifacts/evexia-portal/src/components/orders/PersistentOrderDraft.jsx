import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { getSession, purchaseOrderRequest } from '../../auth/adminSession.js';
import { validOrderDraft as validDraft } from '../../auth/orderDraftResponse.js';
import { prepareOrderPlacement, announceOrderChange } from '../../services/orderFreshness.js';
import { useAdminDateFormatters } from '../admin/adminPreferences.js';
import OrderPortalLayout, { useOrderBase, useOrderActions } from './OrderPortalContext.jsx';

const request = (kind, path = '', options) => purchaseOrderRequest(path, options, `order-drafts/${kind}`);
const queryId = () => new URLSearchParams(window.location.search).get('draft');

// Only new-order routes use this boundary. Submitted editors never become drafts.
export function DraftEntry({ kind, children }) {
  const BASE = useOrderBase(kind === 'kits' ? 'kits-consumables' : kind);
  const [id] = useState(queryId);
  const [record, setRecord] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    request(kind, `/${encodeURIComponent(id)}`, { signal: controller.signal }).then((result) => {
      if (!validDraft(result, kind, id)) throw new Error('The saved draft response could not be read. Return to orders or retry; no draft has been replaced.');
      if (!controller.signal.aborted) setRecord(result);
    })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [id, kind, revision]);
  if (id && !record) return <OrderPortalLayout title="ORDER DRAFT"><section className="admin-panel" aria-label="Order draft">
    <h1>{error ? 'Draft unavailable' : 'Loading saved draft…'}</h1>
    {error && <><p role="alert">{error}</p><button type="button" className="admin-button" onClick={() => { setError(''); setRevision((n) => n + 1); }}>Retry</button></>}
    <Link className="admin-button admin-button--secondary" href={BASE}>Back to orders</Link>
  </section></OrderPortalLayout>;
  return children(record);
}

export function usePersistentOrderDraft(kind, loaded) {
  const record = useRef(loaded);
  const id = useRef(loaded?.id || crypto.randomUUID());
  const owner = useRef(getSession().user?.id);
  const pending = useRef(null), sending = useRef(false);
  const [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false), [notice, setNotice] = useState('');
  const ensureOwner = () => {
    if (getSession().user?.id !== owner.current) throw new Error('Return to orders using the original account before continuing.');
  };
  async function persist(payload) {
    if (sending.current) throw new Error('Draft save is already in progress.');
    ensureOwner();
    if (!pending.current) pending.current = { payload: structuredClone(payload), expected_version: record.current?.version ?? null, idempotencyKey: crypto.randomUUID() };
    sending.current = true; setBusy(true); setNotice('');
    try {
      const result = await request(kind, `/${id.current}`, { body: pending.current });
      ensureOwner();
      if (!validDraft(result, kind, id.current)) {
        const cause = new Error('Draft save response was not confirmed. Retry the unchanged draft save.');
        cause.ambiguous = true; throw cause;
      }
      record.current = result; pending.current = null; setUnknown(false);
      const url = new URL(window.location.href);
      url.searchParams.set('draft', result.id);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      setNotice('Draft saved on the server. You can resume it from Drafts after reload or login. This is not a submitted order.');
      return result;
    } catch (cause) {
      // An uncertain write retains its exact request until confirmed. A failed
      // retry's authorization/transport response does not cancel its predecessor.
      const keep = unknown || Boolean(cause.ambiguous);
      setUnknown(keep);
      if (!keep) pending.current = null;
      setNotice(`${cause.message} ${keep ? 'Editing and final submission are locked. Retry the unchanged draft save.' : 'Your entries remain in this tab; draft save was not confirmed.'}`);
      throw cause;
    } finally { sending.current = false; setBusy(false); }
  }
  async function submit(body, normalCreate) {
    ensureOwner();
    if (pending.current || sending.current) throw new Error('Confirm the pending draft save before submitting.');
    if (!record.current) return normalCreate();
    // The editor retains this exact final payload on a lost response; the
    // server additionally binds the attempt to the saved draft version.
    await prepareOrderPlacement('', { body }, `${kind}-orders`);
    const result = await request(kind, `/${id.current}/submit`, { body: { expected_version: record.current.version, order: body } });
    if (!result?.id || !Number.isSafeInteger(result.version)) {
      const cause = new Error('Submission response was not confirmed. Retry the unchanged submission.');
      cause.ambiguous = true; throw cause;
    }
    // A browser refresh-channel failure cannot turn an already confirmed
    // transaction into an apparent failed save.
    try { announceOrderChange(`${kind}-orders`); }
    catch { /* Lists also refresh on focus, periodically, and explicitly. */ }
    return result;
  }
  return { persist, submit, busy, unknown, saved: record.current, locked: busy || unknown,
    notice: notice ? <p role={unknown ? 'alert' : 'status'} aria-live="polite">{notice}</p> : null };
}

export default function PersistentDrafts({ kind }) {
  const can = useOrderActions(kind);
  const BASE = useOrderBase(kind === 'kits' ? 'kits-consumables' : kind);
  const { timestamp } = useAdminDateFormatters();
  const [open, setOpen] = useState(false), [data, setData] = useState({ items: [], nextCursor: null });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState(null);
  useEffect(() => {
    if (!open || !can.add) return undefined;
    const controller = new AbortController();
    setBusy(true); setError('');
    request(kind, '', { params: { cursor, limit: 25 }, signal: controller.signal })
      .then((result) => {
        if (!Array.isArray(result?.items) || result.items.some((item) => !validDraft(item, kind, item?.id))) {
          throw new Error('Draft list response could not be read. Retry Refresh drafts.');
        }
        if (!controller.signal.aborted) setData(result);
      })
      .catch((cause) => { if (!controller.signal.aborted) { setData({ items: [], nextCursor: null }); setError(cause.message); } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [kind, open, cursor, revision, can.add]);
  if (!can.add) return null;
  return <details className="admin-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Drafts — resume an incomplete order</summary>
    {open && <div style={{ padding: 16 }}>
      <p>Only drafts created by your account appear here. They are not submitted orders and are excluded from order totals and review.</p>
      <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => { setCursor(null); setRevision((n) => n + 1); }}>Refresh drafts</button>
      {busy && <p role="status">Loading drafts…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !data.items.length && <p>No saved drafts in this section.</p>}
      <ul>{data.items.map((item, index) => <li key={item.id}>
        <strong>Draft {index + 1}</strong> — saved {timestamp(item.updatedAt)}
        {item.payload.values.remarks && <p>{item.payload.values.remarks}</p>}
        <Link className="admin-button admin-button--secondary" href={`${BASE}/new?draft=${item.id}`} aria-label={`Resume draft saved ${timestamp(item.updatedAt)}`}>Resume draft</Link>
      </li>)}</ul>
      {cursor && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => setCursor(null)}>First section</button>}
      {data.nextCursor && <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => setCursor(data.nextCursor)}>Next drafts</button>}
    </div>}
  </details>;
}
