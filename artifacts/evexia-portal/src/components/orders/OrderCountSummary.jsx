import './orderCountSummary.css';

// Counts come from the ownership-scoped server aggregate, never the visible page.
const STATUS_CARDS = [
  ['Confirmed', 'Confirmed'], ['In process', 'In process'],
  ['In shipping', 'Shipped'], ['Delivered', 'Delivered'],
  ['Rejected', 'Rejected'], ['Returned', 'Returned'],
];
export default function OrderCountSummary({ total, counts, loading }) {
  const available = Number.isSafeInteger(total) && total >= 0
    && counts && typeof counts === 'object' && !Array.isArray(counts)
    && [...STATUS_CARDS.map(([, key]) => key), 'Approved'].every((status) => !Object.hasOwn(counts, status)
      || (Number.isSafeInteger(counts[status]) && counts[status] >= 0));
  const state = loading ? 'Loading order counts…' : !available ? 'Order counts unavailable.' : '';
  const cards = [['All orders', total], ...STATUS_CARDS.map(([label, key]) => [
    label, (counts?.[key] ?? 0) + (key === 'In process' ? (counts?.Approved ?? 0) : 0),
  ])];

  return <section className="order-count-summary" aria-label="Order counts by status" aria-busy={loading}>
    <p className="order-count-summary__state" role="status" aria-live="polite">{state}</p>
    <div className="order-count-summary__cards">
      {cards.map(([label, count]) => <div className="order-count-summary__card" key={label}>
        <strong>{state ? <><span aria-hidden="true">—</span><span className="order-count-summary__hidden">{loading ? 'Loading' : 'Unavailable'}</span></> : count}</strong>
        <span>{label}</span>
      </div>)}
    </div>
  </section>;
}
