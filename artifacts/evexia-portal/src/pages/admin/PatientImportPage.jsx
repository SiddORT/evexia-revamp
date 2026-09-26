import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Download, Upload } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import usePatients from '../../hooks/usePatients.js';
import { patientTemplateCSV, readPatientSnapshots, reviewPatientCSV } from '../../services/patients.js';
import '../../mr.css';
import '../../patient.css';

const LIST = '/admin/masters/patients';
function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([patientTemplateCSV()], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'evexia-patient-template.csv';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function PatientImportPage() {
  const [, navigate] = useLocation();
  const { error, retry, importRows } = usePatients();
  const [review, setReview] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  async function selectFile(event) {
    setReview(null); setMessage('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setMessage('Choose a CSV file (.csv).'); return; }
    if (file.size > 2_000_000) { setMessage('CSV is too large. Import up to 1,000 records in a file under 2 MB.'); return; }
    setBusy(true);
    try {
      const snapshot = readPatientSnapshots();
      if (error) throw new Error('Refresh records before reviewing a new CSV.');
      const entries = reviewPatientCSV(await file.text(), snapshot);
      const latest = readPatientSnapshots();
      if (['records', 'doctors', 'mrs', 'zones'].some((key) => JSON.stringify(snapshot[key]) !== JSON.stringify(latest[key]))) throw new Error('Records changed while reading the file. Refresh and choose it again.');
      setReview({ entries, snapshot, name: file.name });
    } catch (cause) { setMessage(cause.message || 'Could not read this CSV.'); }
    finally { setBusy(false); }
  }
  function refresh() {
    retry(); setReview(null); setMessage('');
    if (fileRef.current) fileRef.current.value = '';
  }
  function confirm() {
    if (!review || busy) return;
    setBusy(true);
    const result = importRows(review.entries, review.snapshot);
    setBusy(false);
    if (result.success) navigate(`${LIST}?saved=imported`);
    else { setMessage(`${result.error} Nothing was imported. Refresh records and review the CSV again.`); setReview(null); }
  }
  const invalid = review?.entries.filter((entry) => entry.errors.length).length || 0;
  return <AdminLayout title="Import patients">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Patients / CSV import</p><h1>Import patients</h1><p className="admin-page-head__description">Review every row before saving. This browser-local preview is not suitable for real patient or health information.</p></div>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST)}><ArrowLeft size={16} /> Back to Patient Master</button></div>
    <section className="admin-panel patient-import" aria-label="Import patient CSV">
      <div className="patient-import__intro"><h2>Patient CSV</h2><p>Download the template or use an exported Patient Master CSV. Keep the headers in order. Leave Patient ID blank for a new ID, or retain exported IDs when moving records to a clean directory. Doctor ID must identify a saved doctor, or supply their unique registration number. Existing IDs and invalid assignments are rejected; nothing is overwritten.</p>
        <button type="button" className="admin-button admin-button--secondary" onClick={downloadTemplate} data-testid="button-patient-template"><Download size={16} /> Download CSV template</button>
      </div>
      <div className="patient-import__picker"><label htmlFor="patient-csv">Choose CSV file</label><input id="patient-csv" ref={fileRef} type="file" accept=".csv,text/csv" onChange={selectFile} disabled={Boolean(error) || busy} data-testid="input-patient-csv" /></div>
      {error && <div className="admin-feedback admin-feedback--error" role="alert">{error} <button type="button" className="admin-button admin-button--secondary" onClick={refresh}>Refresh records</button></div>}
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message} <button type="button" className="admin-button admin-button--secondary" onClick={refresh}>Refresh and review again</button></div>}
      {review && <div className="patient-import__review">
        <h2>Review {review.name}</h2>
        <p role="status">{review.entries.length} row{review.entries.length === 1 ? '' : 's'} · {invalid} with errors. {invalid ? 'Fix the CSV and choose it again; no rows have been saved.' : 'All rows are valid. Confirm to save the entire batch.'}</p>
        <div className="admin-table-scroll" role="region" aria-label="CSV row review" tabIndex={0}><table className="admin-table"><thead><tr><th scope="col">Line</th><th scope="col">Patient ID</th><th scope="col">Patient</th><th scope="col">Result</th></tr></thead><tbody>{review.entries.map((entry) => <tr key={entry.line}><td>{entry.line}</td><td>{entry.id || '—'}</td><td>{entry.fields?.name || '—'}</td><td>{entry.errors.length ? <span className="admin-mr-missing">{entry.errors.join(' · ')}</span> : 'Ready to import'}</td></tr>)}</tbody></table></div>
        <div className="patient-import__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => { setReview(null); if (fileRef.current) fileRef.current.value = ''; }}>Cancel review</button><button type="button" className="admin-button" disabled={Boolean(invalid) || busy || Boolean(error)} onClick={confirm} data-testid="button-confirm-patient-import"><Upload size={16} /> Confirm import of {review.entries.length} patients</button></div>
      </div>}
    </section>
  </AdminLayout>;
}