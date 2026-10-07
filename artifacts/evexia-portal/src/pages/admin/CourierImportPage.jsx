import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { reviewCouriers, importCouriers, downloadCourierFile } from '../../services/serverCouriers.js';
import { sampleExcel } from '../../services/mockExcelImport.js';

export default function CourierImportPage() {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function run(commit) {
    if (!file || busy.current || (commit && !review?.valid)) return;
    busy.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (commit) {
        const result = await importCouriers(file, review.digest);
        setMessage(`${result.imported} courier partners imported into shared server records.`);
        setReview(null);
        setFile(null);
      } else {
        setReview(null);
        if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
        setReview(await reviewCouriers(file));
      }
    } catch (cause) {
      setError(cause.message);
      if (commit) setReview(null);
    } finally { busy.current = false; setPending(false); }
  }
  function sample(format) {
    const blob = format === 'csv' ? new Blob(['\uFEFFCourier Partner Name,Status\r\nExample Delivery,Active\r\n'],
      { type: 'text/csv;charset=utf-8' }) : sampleExcel('courier-partner');
    downloadCourierFile(blob, format);
  }
  return <AdminLayout title="Import Courier Partner data">
    <button className="admin-button admin-button--secondary" disabled={pending} onClick={() => navigate('/admin/masters/courier-partners')}>Back to Courier Partner Master</button>
    <div className="admin-page-head"><div><h1>Import Courier Partner data</h1>
      <p>Review a UTF-8 CSV or genuine .xlsx file, then explicitly confirm. Review saves nothing. Import creates records only and is all-or-nothing.</p>
      <p>Maximum 2 MiB and 1,000 records. Use Courier Partner Name/Status or the six-column CSV/Excel backup schema. Incoming audit values are ignored; the authenticated importer becomes the creator.</p>
      <p>Non-deleted names, including inactive partners, must be unique regardless of case or whitespace. No formulas, macros, external links or .xls files.</p>
      <p>This page uses shared server data. Old local storage stays untouched; explicitly import a previously exported CSV backup if needed. Exports allow 5,000 matches, but files above 1,000 rows must be split for import.</p>
    </div></div>
    <section className="admin-panel" style={{ padding: 24 }}>
      <div className="admin-toolbar">
        <button className="admin-button admin-button--secondary" onClick={() => sample('csv')}>Download CSV template</button>
        <button className="admin-button admin-button--secondary" onClick={() => sample('xlsx')}>Download Excel template</button>
      </div>
      <label>Courier CSV or Excel file<input type="file" accept=".csv,.xlsx" disabled={pending} onChange={(event) => {
        setFile(event.target.files?.[0] || null); setReview(null); setError(''); setMessage('');
      }} /></label>
      {file && <p>Selected: {file.name}</p>}
      <div className="admin-toolbar">
        <button className="admin-button" disabled={pending || !file} onClick={() => run(false)}>{pending ? 'Processing…' : 'Review file'}</button>
        {review && <button className="admin-button" disabled={pending || !review.valid} onClick={() => run(true)}>Confirm import of {review.rows.length} courier partners</button>}
      </div>
      {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
      {message && <p className="admin-feedback" role="status">{message}</p>}
      {review && <><p role="status">{review.valid ? 'All rows valid. Confirm to save.' : 'Nothing can be imported until all errors are corrected.'}</p>
        <div style={{ overflowX: 'auto' }}><table className="admin-table"><thead><tr><th>File row</th><th>Courier Partner Name</th><th>Status</th><th>Review errors</th></tr></thead>
          <tbody>{review.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.status}</td><td>{row.errors.join(' ') || 'Ready'}</td></tr>)}</tbody>
        </table></div></>}
    </section>
  </AdminLayout>;
}
