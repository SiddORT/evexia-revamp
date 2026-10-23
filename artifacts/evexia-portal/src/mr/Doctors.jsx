import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import SharedDoctorForm from '../components/admin/DoctorForm.jsx';
import DoctorImportPage from '../pages/admin/DoctorImportPage.jsx';
import TablePagination from '../components/admin/TablePagination.jsx';
import DirectorySearchStatus from '../components/admin/DirectorySearchStatus.jsx';
import useDoctors from '../hooks/useDoctors.js';
import useConfirmedNavigation from '../auth/useConfirmedNavigation.js';
import { usePlatformConfirm } from '../components/PlatformConfirmation.jsx';
import { reportingIdentityGuard } from '../auth/adminSession.js';
import { downloadDoctorFile, exportDoctors } from '../services/serverDoctors.js';
import { Head, statusPill, useWs } from './common.jsx';

export function DoctorList() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const filters = { query, status };
  const data = useDoctors({ ...filters, limit: pageSize, offset: (page - 1) * pageSize });
  const pageCount = Math.max(1, Math.ceil((data.filtered || 0) / pageSize));
  useEffect(() => { if (!data.loading && !data.error && !data.partial && page > pageCount) setPage(pageCount); }, [data.loading, data.error, data.partial, page, pageCount]);
  async function download(format) {
    if (busy.current || data.loading || data.error || search.trim() !== query) return;
    busy.current = true; setExporting(true); setError('');
    const request = new AbortController(); controller.current = request;
    const guard = reportingIdentityGuard();
    try {
      const blob = await exportDoctors(filters, format, request.signal);
      guard(); if (!request.signal.aborted) downloadDoctorFile(blob, format);
    } catch (cause) {
      if (request.signal.aborted) return;
      try { guard(); } catch { return; }
      setError(cause.message || 'Export failed.');
    } finally { busy.current = false; if (!request.signal.aborted) setExporting(false); }
  }
  return <>
    <Head eyebrow="My Doctors" title="My Doctors" text="Your assigned doctors from the shared server directory.">
      <Link href="/mr/doctors/new" className="admin-button">Add Doctor</Link>
      <Link href="/mr/doctors/import" className="admin-button admin-button--secondary">Import CSV / Excel</Link>
      {['csv', 'xlsx'].map((format) => <button type="button" className="admin-button admin-button--secondary" key={format} disabled={exporting || data.loading || Boolean(data.error) || search.trim() !== query} onClick={() => download(format)}>Export {format.toUpperCase()}</button>)}
    </Head>
    <div className="mrw-bar">
      <input type="search" maxLength={200} aria-label="Search doctors" placeholder="Search name, registration, clinic or contact" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="admin-select" aria-label="Doctor status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      <button type="button" className="admin-button admin-button--secondary" onClick={data.retry} disabled={data.loading}>Refresh</button>
      <div className="mrw-choice" aria-label="Doctor view">{['list', 'grid'].map((mode) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === 'list' ? 'List view' : 'Grid view'}</button>)}</div>
    </div>
    {error && <p className="mrw-alert" role="alert">{error}</p>}
    {data.error ? <div className="mrw-card" role="alert"><p>{data.error}</p><button className="admin-button" onClick={data.retry}>Retry loading doctors</button></div>
      : data.loading ? <p role="status">Loading doctors…</p>
        : !data.records.length ? <div className="mrw-card"><p>{data.partial ? 'No matches in this search section. Continue below.' : 'No assigned doctors match this scope.'}</p></div>
          : view === 'grid' ? <div className="mrw-grid">{data.records.map((doctor) => <Link className="mrw-card" key={doctor.id} href={`/mr/doctors/${doctor.id}`}><h2>{doctor.name}</h2><p>{doctor.doctorNumber} · {doctor.registrationNumber}</p><p>{doctor.qualification} · {doctor.clinicName}</p><p>{doctor.phone || doctor.email}</p>{statusPill(doctor.status)}</Link>)}</div>
            : <div className="mrw-card mrw-scroll" tabIndex={0} role="region" aria-label="Assigned doctor list"><table className="mrw-table"><thead><tr><th>Doctor</th><th>Registration</th><th>Clinic / Qualification</th><th>Contact</th><th>Status</th></tr></thead><tbody>{data.records.map((doctor) => <tr key={doctor.id}><td><Link href={`/mr/doctors/${doctor.id}`}>{doctor.name}</Link><div>{doctor.doctorNumber}</div></td><td>{doctor.registrationNumber}</td><td>{doctor.clinicName || '—'}<div>{doctor.qualification}</div></td><td>{doctor.phone || '—'}<div>{doctor.email}</div></td><td>{statusPill(doctor.status)}</td></tr>)}</tbody></table></div>}
    {!data.error && !data.loading && (data.partial
      ? <DirectorySearchStatus count={data.records.length} scanned={data.scanned} nextCursor={data.nextCursor} loading={data.loading} onNext={data.continueSearch} onRestart={data.restartSearch} />
      : <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={data.filtered} total={data.total} label="doctors" onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />)}
  </>;
}

export function DoctorDetail({ id }) {
  const data = useDoctors({}, id);
  const doctor = data.doctor;
  return <>
    <Head title={doctor && !data.error ? doctor.name : 'Doctor profile'} text="Read-only shared directory record. Demo orders and payments are not linked."><Link className="admin-button admin-button--secondary" href="/mr/doctors">Back to My Doctors</Link></Head>
    {data.loading ? <p role="status">Loading doctor…</p> : data.error ? <div role="alert" className="mrw-card"><p>{data.error}</p><button className="admin-button" onClick={data.retry}>Retry</button></div> : doctor && <div className="mrw-card"><dl className="mrw-dl">{[
      ['Doctor number', doctor.doctorNumber], ['Registration number', doctor.registrationNumber], ['Qualification', doctor.qualification],
      ['Clinic', doctor.clinicName], ['Phone', doctor.phone], ['Alternate phone', doctor.alternatePhone], ['Email', doctor.email],
      ['Date of joining', doctor.dateOfJoining], ['Assigned MR', doctor.mrName], ['Zone', doctor.zoneName],
      ['Status', doctor.status], ['Verification', doctor.verification], ['Invoice type', doctor.invoiceType], ['GST number', doctor.gstNumber],
      ['Drug licence number', doctor.drugLicenceNumber], ['Order discount (%)', doctor.orderDiscount], ['Days limit', doctor.daysLimit],
      ['Payment limit', doctor.paymentLimit], ['Address', [doctor.addressLine1, doctor.addressLine2, doctor.landmark, doctor.city, doctor.state, doctor.pincode, doctor.country].filter(Boolean).join(', ')],
    ].map(([label, value]) => <div className="mrw-profile-field" key={label}><dt>{label}</dt><dd>{String(value ?? '').trim() || '—'}</dd></div>)}</dl></div>}
  </>;
}

export function DoctorForm() {
  const data = useDoctors({ limit: 1 });
  const [, navigate] = useLocation();
  const { setFlash } = useWs();
  const confirm = usePlatformConfirm();
  const [draft, setDraft] = useState({ dirty: false, busy: false });
  const saved = useRef(false);
  const [revision, setRevision] = useState(0);
  const [mounted, setMounted] = useState(false);
  const fixed = useRef(null);
  useConfirmedNavigation(() => saved.current ? { dirty: false, busy: false } : draft, 'Discard your unsaved Doctor draft?');
  useEffect(() => { if (!data.loading && !data.error && data.mrs[0] && !mounted) { fixed.current = data.mrs[0]; setMounted(true); } }, [data.loading, data.error, data.mrs, mounted]);
  async function refresh() {
    if (draft.busy || (mounted && !await confirm('Discard this draft and reload your current MR assignment?', { actionLabel: 'Discard and reload' }))) return;
    setMounted(false); fixed.current = null; setDraft({ dirty: false, busy: false }); setRevision((value) => value + 1); data.retry();
  }
  async function save(values) {
    const result = await data.add(values);
    if (result.success) { saved.current = true; setFlash('Doctor added successfully to the shared directory.', '/mr/doctors'); navigate('/mr/doctors'); }
    return result;
  }
  return <>
    <Head title="Add Doctor" text="Shared Doctor form. Assigned MR is fixed to your saved MR identity." />
    {data.error && <div className="mrw-alert" role="alert"><p>{data.error} Your draft is preserved. Saving is blocked.</p><button className="admin-button" onClick={refresh}>Reload assignment and records</button></div>}
    {!mounted ? !data.error && <p role="status">Loading your MR assignment…</p> : <section className="admin-panel doctor-form-page"><SharedDoctorForm key={revision} mrs={[fixed.current]} fixedMR={fixed.current} onDraftChange={setDraft} blocked={data.loading || Boolean(data.error)} onSave={save} onClose={() => navigate('/mr/doctors')} onRefresh={refresh} /></section>}
  </>;
}

export function DoctorImport() { return <DoctorImportPage mr />; }
