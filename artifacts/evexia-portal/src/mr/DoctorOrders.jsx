import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { contactReadScope, getSession, reportingIdentityGuard, subscribeSession } from '../auth/adminSession.js';
import { getDoctorOrders } from '../services/serverDoctors.js';
import { statusPill, useDate } from './common.jsx';

const TYPES = {
  immunotherapy: ['Immunotherapy', 'immunotherapy'],
  kits: ['Kits & Consumables', 'kits-consumables'],
  spt: ['SPT', 'spt'],
  lupin: ['Lupin', 'lupin'],
};
const STATUSES = new Set(['Confirmed', 'In process', 'Shipped', 'Delivered', 'Rejected', 'Returned', 'Saved']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = ['Order number', 'Order type', 'Saved date', 'Status', 'Action'];

function readPage(value) {
  if (!value || !Array.isArray(value.items) || value.items.length > 20 || value.limit !== 20
      || !(value.nextCursor === null || (typeof value.nextCursor === 'string' && value.nextCursor.length > 0 && value.nextCursor.length <= 512))
      || value.items.some((row) => !row || !Object.hasOwn(TYPES, row.kind)
        || !UUID.test(row.id) || typeof row.number !== 'string' || !row.number.trim()
        || !STATUSES.has(row.status)
        || !(row.date === null || (typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date))))) {
    throw new Error('Saved order information could not be read. Please retry.');
  }
  return { items: value.items, nextCursor: value.nextCursor };
}

function OrderPages({ doctorId }) {
  const date = useDate();
  const [cursors, setCursors] = useState([null]);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const cursor = cursors[page];
  const requestKey = JSON.stringify([doctorId, cursor, revision]);
  // Tag state so a render after navigation cannot show the previous page.
  const current = result?.key === requestKey ? result : null;
  const loading = !current || current.loading;

  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setResult({ key: requestKey, loading: true });
    (async () => {
      try {
        const value = readPage(await getDoctorOrders(doctorId, { limit: 20, cursor }, controller.signal));
        guard();
        if (!controller.signal.aborted) setResult({ key: requestKey, loading: false, ...value });
      } catch (cause) {
        if (controller.signal.aborted) return;
        try { guard(); } catch { return; }
        setResult({ key: requestKey, loading: false, error: cause.message || 'Orders are unavailable. Please retry.' });
      }
    })();
    return () => controller.abort();
  }, [doctorId, cursor, requestKey]);

  const refresh = () => { setPage(0); setCursors([null]); setRevision((value) => value + 1); };
  const next = () => {
    if (loading || !current?.nextCursor) return;
    setCursors((old) => [...old.slice(0, page + 1), current.nextCursor]);
    setPage((value) => value + 1);
  };
  return <section className="mrw-card mrw-do-section mrw-do-orders" aria-labelledby="doctor-orders-heading" aria-busy={loading}>
    <div className="mrw-do-orders-head"><h2 id="doctor-orders-heading">Orders</h2>
      <button type="button" className="admin-button admin-button--secondary" onClick={refresh} disabled={loading}>Refresh orders</button>
    </div>
    <p className="mrw-notice">Your saved orders for this Doctor, newest saved order date first. Up to 20 per page; use Next for more. SPT drafts and Kits supplied to an MR are excluded.</p>
    {loading ? <p role="status">Loading saved orders…</p>
      : current.error ? <div role="alert"><p>{current.error}</p><button type="button" className="admin-button" onClick={() => setRevision((value) => value + 1)}>Retry orders</button></div>
        : !current.items.length ? <p role="status">{page === 0 ? 'No saved orders for this Doctor in your MR scope.' : 'No orders remain on this page. Go back or refresh orders.'}</p>
          : <table className="mrw-table mrw-do-orders-table" role="table">
            <caption className="sr-only">Saved orders for this Doctor owned by your MR account. This is one page, not a full-history total.</caption>
            <thead role="rowgroup"><tr role="row">{HEADERS.map((label) => <th key={label} scope="col" role="columnheader">{label}</th>)}</tr></thead>
            <tbody role="rowgroup">{current.items.map((row) => {
              const fields = [
                <strong>{row.number}</strong>, TYPES[row.kind][0],
                row.date ? date(row.date) : 'Unavailable', statusPill(row.status),
                <Link className="admin-button admin-button--secondary" href={`/mr/orders/${TYPES[row.kind][1]}/${row.id}`}
                  aria-label={`View ${TYPES[row.kind][0]} order ${row.number}`}>View</Link>,
              ];
              return <tr key={`${row.kind}-${row.id}`} role="row">{fields.map((field, index) => <td key={HEADERS[index]} role="cell">
                <span className="mrw-do-order-label" aria-hidden="true">{HEADERS[index]}</span><div>{field}</div>
              </td>)}</tr>;
            })}</tbody>
          </table>}
    <nav className="mrw-do-orders-pages" aria-label="Doctor orders pagination">
      <button type="button" className="admin-button admin-button--secondary" disabled={loading || page === 0} onClick={() => setPage((value) => value - 1)}>Previous</button>
      <span role="status" aria-live="polite">Page {page + 1}{!loading && !current?.error && !current?.nextCursor ? ' · End of results' : ''}</span>
      <button type="button" className="admin-button admin-button--secondary" disabled={loading || Boolean(current?.error) || !current?.nextCursor} onClick={next}>Next</button>
    </nav>
  </section>;
}

export default function DoctorOrders({ doctorId }) {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  // Remount immediately on account/MR changes, before old promises can publish.
  const owner = contactReadScope(session.user);
  if (session.status !== 'authenticated') return <section className="mrw-card mrw-do-orders"><h2>Orders</h2><p role="status">Sign in to load saved orders.</p></section>;
  return <OrderPages key={`${owner}:${doctorId}`} doctorId={doctorId} />;
}
