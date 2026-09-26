import { useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import { CSV_COLUMNS } from '../../services/mrs.js';
import { ZONE_COLUMNS, readImportSnapshots, reviewImport } from '../../services/masterImport.js';

export default function MasterImportDialog({ kind, onImport, onClose }) {
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const isMR = kind === 'mr';
  const label = isMR ? 'MR' : 'zone';
  const columns = isMR ? CSV_COLUMNS.map(([, name]) => name) : ZONE_COLUMNS;
  const errors = review?.entries.filter((entry) => entry.errors.length) || [];
  const valid = review?.entries.length - errors.length || 0;

  function close() { sequence.current++; onClose(); }
  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setReview(null);
    setMessage('');
    if (!file) return;
    const current = ++sequence.current;
    if (!/\.csv$/i.test(file.name) || file.size > 2_000_000) {
      setMessage('Choose a .csv file smaller than 2 MB.');
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      if (current !== sequence.current) return;
      const snapshots = readImportSnapshots();
      const entries = reviewImport(kind, text, snapshots);
      setReview({ entries, snapshots, fileName: file.name });
    } catch (error) {
      if (current === sequence.current) setMessage(error.message || 'Could not read this CSV file.');
    } finally {
      if (current === sequence.current) setReading(false);
    }
  }
  function confirm() {
    setMessage('');
    const result = onImport(review.entries, review.snapshots);
    if (result.success) close();
    else setMessage(result.error);
  }
  return <Dialog title={`Import ${label} CSV`} eyebrow={`${label} Master`} description={`Add ${label} records to this browser only. Existing records are never replaced.`} onClose={close} className="admin-import-dialog"
    footer={<><button type="button" className="admin-button admin-button--secondary" onClick={close}>Cancel</button><button type="button" className="admin-button" disabled={!review || !valid || errors.length > 0 || reading || Boolean(message)} onClick={confirm} data-testid={`button-confirm-${kind}-import`}>Import {valid} {label}{valid === 1 ? '' : 's'}</button></>}>
    <div className="admin-import">
      <p><strong>CSV columns (exact order):</strong> {columns.join(', ')}.</p>
      <p>{isMR
        ? 'Use the Export CSV file as a template. Dates use YYYY-MM-DD; statuses use active or inactive. Assigned Zone must match an active saved zone. Reporting Manager may match a saved MR or another row in this file. Leave optional manager, Address Line 2 and numeric limits blank if needed. IDs, audit fields, passwords and other columns are not accepted.'
        : 'Template: Zone Name,Status. For example: Central Zone,active. Status must be active or inactive. IDs, audit fields, passwords and other columns are not accepted.'}</p>
      <label className="admin-import__file">Choose a local CSV file<input type="file" accept=".csv,text/csv" onChange={choose} data-testid={`input-${kind}-import`} /></label>
      {reading && <p role="status">Reading CSV…</p>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      {review && <div className="admin-import__review" aria-live="polite">
        <p><strong>{review.fileName}</strong> — {valid} valid row{valid === 1 ? '' : 's'}, {errors.length} row{errors.length === 1 ? '' : 's'} with errors. {errors.length ? 'Correct the file and choose it again; nothing has been saved.' : 'Review the rows, then confirm to add them.'}</p>
        <div className="admin-import__rows" role="list" aria-label="CSV rows">
          {review.entries.map((entry) => <div role="listitem" className={entry.errors.length ? 'admin-import__row admin-import__row--error' : 'admin-import__row'} key={entry.line}>
            {entry.values ? <details><summary>Line {entry.line}: {entry.values.name || '(unnamed)'} — {entry.errors.length ? `${entry.errors.length} error${entry.errors.length === 1 ? '' : 's'}` : 'Ready to add'}</summary>
              <dl>{columns.map((column, index) => <div key={column}><dt>{column}</dt><dd>{entry.values[isMR ? CSV_COLUMNS[index][0] : index ? 'status' : 'name'] || '—'}</dd></div>)}</dl>
            </details> : <strong>Line {entry.line}: malformed row</strong>}
            {entry.errors.length > 0 && <ul>{entry.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
          </div>)}
        </div>
      </div>}
    </div>
  </Dialog>;
}