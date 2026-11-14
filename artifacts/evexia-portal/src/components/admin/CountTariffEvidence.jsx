import { useEffect, useState } from 'react';
import DataTable from './DataTable.jsx';
import { loadCountTariffs } from '../../services/serverCountTariffs.js';
import { formatAdminDate, useAdminPreferences } from './adminPreferences.js';

export default function CountTariffEvidence({ categoryId }) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const prefs = useAdminPreferences();
  useEffect(() => {
    const ctl = new AbortController(); setBusy(true); setValue(null); setError('');
    loadCountTariffs(categoryId, ctl.signal)
      .then((result) => { if (!ctl.signal.aborted) setValue(result); })
      .catch((cause) => { if (!ctl.signal.aborted) setError(cause.message); })
      .finally(() => { if (!ctl.signal.aborted) setBusy(false); });
    return () => ctl.abort();
  }, [categoryId, retry]);
  const columns = [
    { key: 'count', label: 'Historical count', render: (r) => r.allergenCount },
    { key: 'rate', label: 'Total Suborder MRP (INR)', render: (r) => `₹${r.totalMrp}` },
    { key: 'date', label: 'Effective From', render: (r) => formatAdminDate(r.effectiveFrom, prefs) || r.effectiveFrom },
    { key: 'version', label: 'Version / attribution', render: (r) => <>{r.version}<small>Actor {r.actorId}</small><small>Recorded {r.recordedAt}</small></> },
  ];
  return <div className="pricing-combination-history"><p>Retained category/count evidence has no specific member or dosage identity. It is not converted, suggested or copied into combination prices. Existing order-price consumers remain unchanged.</p>
    {error ? <div role="alert"><p>{error}</p><button className="admin-button" onClick={() => setRetry((n) => n + 1)}>Retry count evidence</button></div>
      : <DataTable rows={value?.history || []} columns={columns} rowKey={(r) => r.id} loading={busy}
        label="Historical count tariff evidence" empty={<p>No count tariff history.</p>} />}
  </div>;
}
