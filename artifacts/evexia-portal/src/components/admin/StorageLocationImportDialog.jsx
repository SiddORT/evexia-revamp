import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { reviewLocations, importLocations, downloadLocationFile } from '../../services/serverLocations.js';
import { sampleExcel } from '../../services/mockExcelImport.js';

export default function StorageLocationImportDialog({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(commit) {
    if (!file || busy.current || (commit && !review?.valid)) return;
    busy.current = true;
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('File exceeds 2 MiB.');
      if (commit) {
        const result = await importLocations(file, review.digest);
        if (!alive.current) return;
        setMessage(`${result.imported} storage locations saved to the shared database.`);
        setReview(null);
        setFile(null);
        onSaved();
      } else {
        setReview(null);
        const result = await reviewLocations(file);
        if (alive.current) setReview(result);
      }
    } catch (cause) {
      if (alive.current) { setError(cause.message); if (commit) setReview(null); }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  function sample(format) {
    downloadLocationFile(format === 'csv'
      ? new Blob(['\uFEFFStorage Location,Address,Status\r\nExample supply room,Building A Ground floor,active\r\n'], { type: 'text/csv;charset=utf-8' })
      : sampleExcel('storage-location'), format);
  }
  return <Dialog title="Import storage locations" eyebrow="Storage Location Master"
    description="Review saves nothing. Confirm to create shared database records; the entire batch succeeds or nothing is saved."
    onClose={() => { if (!busy.current) onClose(); }} className="admin-import-dialog"
    footer={<>
      <button className="admin-button admin-button--secondary" disabled={pending} onClick={onClose}>Close</button>
      <button className="admin-button" disabled={pending || !file} onClick={() => run(false)}>{pending ? 'Processing…' : 'Review file'}</button>
      {review && <button className="admin-button" disabled={pending || !review.valid} onClick={() => run(true)} data-testid="button-confirm-storage-import">Confirm import of {review.rows.length} locations</button>}
    </>}>
    <div className="admin-category-import">
      <p>CSV or genuine .xlsx only, up to 2 MiB and 1,000 records. Exact headers: Storage Location,Address,Status; or add Created By,Created At,Updated By,Updated At in that order. Incoming audit values are ignored. No ID, version or deletion columns, formulas, macros or external links.</p>
      <p>Names must be unique across active and inactive records. Old browser records stay untouched: explicitly choose a legacy CSV backup to import.</p>
      <div className="admin-toolbar">
        <button className="admin-button admin-button--secondary" onClick={() => sample('csv')}>Download CSV template</button>
        <button className="admin-button admin-button--secondary" onClick={() => sample('xlsx')}>Download Excel template</button>
      </div>
      <label className="admin-category-import__file">Choose CSV or Excel file<input type="file" accept=".csv,.xlsx" disabled={pending} data-testid="input-storage-import" onChange={(event) => {
        setFile(event.target.files?.[0] || null); setReview(null); setError(''); setMessage('');
      }} /></label>
      {error && <p className="admin-feedback admin-feedback--error" role="alert">{error}</p>}
      {message && <p className="admin-feedback" role="status">{message}</p>}
      {review && <><p role="status">{review.valid ? 'All rows valid. Confirm to save.' : 'Correct every row error before importing. Nothing was saved.'}</p>
        <div style={{ overflowX: 'auto', maxHeight: 350 }}><table className="admin-table"><thead><tr><th>Row</th><th>Storage Location</th><th>Address</th><th>Status</th><th>Review errors</th></tr></thead>
          <tbody>{review.rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name}</td><td>{row.address}</td><td>{row.status}</td><td>{row.errors.join(' ') || 'Ready'}</td></tr>)}</tbody>
        </table></div></>}
    </div>
  </Dialog>;
}
