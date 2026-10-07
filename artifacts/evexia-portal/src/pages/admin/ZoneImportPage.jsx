import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { reviewZones, importZones } from '../../services/serverZones.js';
import { sampleExcel } from '../../services/mockExcelImport.js';

export default function ZoneImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function run(commit) {
    if (!file || busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (commit) {
        const result = await importZones(file, review.digest);
        setMessage(`${result.imported} zones imported into shared server records.`);
        setReview(null);
        setFile(null);
      } else {
        setReview(null);
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        setReview(await reviewZones(file));
      }
    } catch (cause) {
      setError(cause.message);
      if (commit) setReview(null); // Conflict/ambiguous save always requires a fresh review.
    } finally { busy.current = false; setPending(false); }
  }
  function sample(format) {
    const blob = format === 'csv' ? new Blob(['\uFEFFZone Name,Status\r\nSample Zone,Active\r\n'], { type: 'text/csv;charset=utf-8' }) : sampleExcel('zone');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `evexia-zone-sample.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <AdminLayout title="Import Zone data">
    <button className="admin-button admin-button--secondary" disabled={pending} onClick={() => navigate('/admin/masters/zones')}>Back to Zone Master</button>
    <div className="admin-page-head"><div><h1>Import Zone data</h1>
      <p>Review a UTF-8 CSV or genuine .xlsx file, then explicitly confirm. Review saves nothing. Import creates records only and is all-or-nothing.</p>
      <p>Maximum 2 MiB and 1,000 records. Use Zone Name/Status or the six-column backup schema. Incoming audit values are ignored. Non-deleted names, including inactive zones, must be unique.</p>
      <p>These are shared server zones. MR, Doctor, Patient and Sales Target demo assignments continue using their untouched browser-local zone dataset.</p>
    </div></div>
    <section className="admin-panel" style={{ padding: 24 }}>
      <div className="admin-toolbar">
        <button className="admin-button admin-button--secondary" onClick={() => sample('csv')}>Download CSV sample</button>
        <button className="admin-button admin-button--secondary" onClick={() => sample('xlsx')}>Download Excel sample</button>
      </div>
      <label>Zone CSV or Excel file<input type="file" accept=".csv,.xlsx" disabled={pending} onChange={(event) => {
        setFile(event.target.files?.[0] || null); setReview(null); setError(''); setMessage('');
      }} /></label>
      {file && <p>Selected: {file.name}</p>}
      <div className="admin-toolbar">
        <button className="admin-button" disabled={pending || !file} onClick={() => run(false)}>{pending ? 'Processing…' : 'Review file'}</button>
        {review && <button className="admin-button" disabled={pending || !review.valid} onClick={() => run(true)}>Confirm import of {review.rows.length} zones</button>}
      </div>
      {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
      {message && <p className="admin-feedback" role="status">{message}</p>}
      {review && <><p role="status">{review.valid ? 'All rows valid. Confirm to save.' : 'Nothing can be imported until all errors are corrected.'}</p>
        <div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th>File row</th><th>Zone Name</th><th>Status</th><th>Review errors</th></tr></thead>
          <tbody>{review.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.status}</td><td>{row.errors.join(' ') || 'Ready'}</td></tr>)}</tbody>
        </table></div></>}
    </section>
  </AdminLayout>;
}
