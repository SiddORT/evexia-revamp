import { downloadBlob } from '../../services/downloads.js';
import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterImportTabs from '../../components/admin/MasterImportTabs.jsx';
import { EXCEL_TEMPLATES, readExcelRows, reviewExcel, sampleExcel } from '../../services/mockExcelImport.js';
import '../../excel-import.css';
import AccessDenied from '../../components/admin/AccessDenied.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { hasZonePermission } from '../../auth/capabilities.js';
import ZoneImportPage from './ZoneImportPage.jsx';
import CourierImportPage from './CourierImportPage.jsx';
import StorageLocationImportPage from './StorageLocationImportPage.jsx';
import DesignationImportPage from './DesignationImportPage.jsx';

const routes = { zone: '/admin/masters/zones', 'courier-partner': '/admin/masters/courier-partners', mr: '/admin/masters/mrs', doctor: '/admin/masters/doctors' };

export default function MasterExcelImportPage({ kind }) {
  return kind === 'zone' ? <ZoneImportGate /> : kind === 'courier-partner' ? <CourierImportPage /> : kind === 'storage-location' ? <StorageLocationImportPage /> : kind === 'designation' ? <DesignationImportPage /> : <PreviewExcelImportPage kind={kind} />;
}

function ZoneImportGate() {
  const { user } = useAdminSession();
  return hasZonePermission(user, 'zone.import') ? <ZoneImportPage /> : <AccessDenied title="Import Zone" heading="Zone import is not permitted" testId="status-zone-import-denied" message="Your role does not include the Import permission under Masters > Zone." />;
}

function PreviewExcelImportPage({ kind }) {
  const [, navigate] = useLocation();
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState('');
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const template = EXCEL_TEMPLATES[kind];
  if (!template) return <AdminLayout title="Import Excel"><div className="admin-empty" role="alert">Unknown master. Choose a master from the directory.</div></AdminLayout>;

  async function downloadSample() {
    setMessage('');
    try {
      await downloadBlob(sampleExcel(kind), `evexia-${kind}-sample.xlsx`, { source: kind === 'courier-partner' ? 'courier' : kind, kind: 'sample', format: 'XLSX' });
    } catch (error) {
      setMessage(error.message || 'Could not prepare the sample Excel file.');
    }
  }

  async function upload() {
    if (!file) return;
    const current = ++sequence.current;
    setReport(null);
    setMessage('');
    setReading(true);
    try {
      const rows = await readExcelRows(file);
      const entries = reviewExcel(kind, rows);
      if (current === sequence.current) setReport({ entries, name: file.name });
    } catch (error) {
      if (current === sequence.current) setMessage(error.message || 'Could not review this Excel file.');
    } finally {
      if (current === sequence.current) setReading(false);
    }
  }

  const valid = report?.entries.filter((row) => !row.errors.length) || [];
  const invalid = report?.entries.filter((row) => row.errors.length) || [];
  return <AdminLayout title={`Import ${template.title} Excel`}>
    <div className="excel-import">
      <button type="button" className="excel-import__back" onClick={() => navigate(routes[kind])}><ArrowLeft size={16} aria-hidden="true" /> Back to {template.title} Master</button>
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Masters / Excel import preview</p>
          <h1>Import {template.title} data</h1>
          <p className="admin-page-head__description">Download a sample, choose an Excel workbook and review each row. This preview does not save records.</p>
        </div>
        <span className="excel-import__mock">UI preview · Nothing will be saved</span>
      </div>

      <MasterImportTabs kind={kind} />

      <div className="excel-import__steps">
        <section className="excel-import__card" aria-labelledby="excel-sample-title">
          <span className="excel-import__number">01</span>
          <div className="excel-import__icon"><FileSpreadsheet size={23} aria-hidden="true" /></div>
          <h2 id="excel-sample-title">Download sample Excel</h2>
          <p>Start with the column names and an example row. Keep the first worksheet and column order unchanged.</p>
          <div className="excel-import__columns"><strong>Expected columns</strong><span>{template.columns.join(' · ')}</span></div>
          <button type="button" className="admin-button admin-button--secondary" onClick={downloadSample} data-testid={`button-download-${kind}-sample`}><Download size={16} aria-hidden="true" /> Download sample .xlsx</button>
        </section>
        <section className="excel-import__card" aria-labelledby="excel-upload-title">
          <span className="excel-import__number">02</span>
          <div className="excel-import__icon"><Upload size={23} aria-hidden="true" /></div>
          <h2 id="excel-upload-title">Upload &amp; review</h2>
          <p>Choose an .xlsx file (up to 2 MB). Uploading checks its rows for this mock preview; it does not add records.</p>
          <label className="excel-import__picker">
            <FileSpreadsheet size={19} aria-hidden="true" />
            <span>{file ? file.name : 'Choose Excel file'}</span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => {
              sequence.current++;
              setFile(event.target.files?.[0] || null);
              setReport(null);
              setMessage('');
            }} data-testid={`input-${kind}-excel`} />
          </label>
          <button type="button" className="admin-button" disabled={!file || reading} onClick={upload} data-testid={`button-upload-${kind}-excel`}>{reading ? 'Reviewing…' : 'Upload & review'}</button>
        </section>
      </div>
      {message && <div className="admin-feedback admin-feedback--error" role="alert">{message}</div>}
      {report && <section className="excel-import__report" aria-labelledby="excel-report-title" aria-live="polite" data-testid={`${kind}-excel-report`}>
        <div className="excel-import__report-head"><div><p className="admin-page-head__eyebrow">Upload summary</p><h2 id="excel-report-title">{report.name}</h2><p>Preview only — no rows were imported or saved.</p></div>
          <div className="excel-import__totals"><span className="excel-import__valid"><CheckCircle2 size={17} aria-hidden="true" /> {valid.length} valid</span><span className="excel-import__invalid"><XCircle size={17} aria-hidden="true" /> {invalid.length} invalid</span></div>
        </div>
        <div className="excel-import__results">
          <div><h3>Valid data <span>{valid.length}</span></h3>{valid.length ? valid.map((row) => <details key={row.line} className="excel-import__row"><summary>Row {row.line} · {row.values[0]} <span>Valid</span></summary><dl>{template.columns.map((column, index) => <div key={column}><dt>{column}</dt><dd>{row.values[index] || '—'}</dd></div>)}</dl></details>) : <p>No valid rows in this upload.</p>}</div>
          <div><h3>Invalid data <span>{invalid.length}</span></h3>{invalid.length ? invalid.map((row) => <details key={row.line} open className="excel-import__row excel-import__row--invalid"><summary>Row {row.line} · {row.values[0] || '(unnamed)'} <span>{row.errors.length} error{row.errors.length === 1 ? '' : 's'}</span></summary><ul>{row.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></details>) : <p>No errors found. This is still a mock preview; nothing has been saved.</p>}</div>
        </div>
      </section>}
    </div>
  </AdminLayout>;
}