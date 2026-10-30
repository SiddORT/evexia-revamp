import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { useAdminDateFormatters } from './adminPreferences.js';
import { getInHouseStock, RESERVE_NOTE } from '../../services/inHouseStock.js';

export function InHouseFacts({ record, date, timestamp }) {
  const rows = [
    ['Allergen', record.allergenName], ['Category', record.categoryName || 'Uncategorised'],
    ['Concentration', record.concentration], ['Quantity (ml)', `${record.quantity} ${record.unit}`],
    ['Expiry', <>{date(record.expiryDate)} {record.expired && <strong className="mr-form__error" style={{ display: 'inline' }}>Expired</strong>}</>],
    ['Location', record.locationName], ['Batch', record.batch || 'Not recorded'], ['Notes', record.notes || 'None'],
    ...(record.actor ? [['Recorded by', record.actor], ['Recorded', timestamp(record.createdAt)]] : []),
  ];
  return <dl className="inhouse-facts" style={{ display: 'grid', gridTemplateColumns: 'minmax(110px,max-content) 1fr', gap: '6px 14px', margin: 0 }}>
    {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt style={{ fontWeight: 600 }}>{k}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere', whiteSpace: k === 'Notes' ? 'pre-wrap' : undefined }} data-testid={`text-in-house-${k.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd></div>)}
  </dl>;
}

export default function InHouseStockDialog({ id, initial, onClose }) {
  const { date, timestamp } = useAdminDateFormatters();
  const [record, setRecord] = useState(initial || null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (initial && tick === 0) return undefined;
    const c = new AbortController(); setError('');
    getInHouseStock(id, c.signal).then(setRecord).catch((e) => { if (!c.signal.aborted) setError(e.message || 'Details could not be loaded.'); });
    return () => c.abort();
  }, [id, initial, tick]);
  return <Dialog eyebrow="Inventory / In-house stock" title={record ? record.allergenName : 'In-house stock entry'} description={RESERVE_NOTE} onClose={onClose}
    footer={<button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-close-in-house">Close</button>}>
    {error ? <div className="admin-empty" role="alert"><strong>Details could not be loaded</strong><p>{error}</p><button type="button" className="admin-button" onClick={() => setTick((t) => t + 1)}>Try again</button></div>
      : record ? <InHouseFacts record={record} date={date} timestamp={timestamp} /> : <p role="status">Loading details…</p>}
  </Dialog>;
}
