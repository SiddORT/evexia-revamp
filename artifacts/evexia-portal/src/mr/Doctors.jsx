import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ChevronDown, LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import SharedDoctorForm from '../components/admin/DoctorForm.jsx';
import DoctorImportPage from '../pages/admin/DoctorImportPage.jsx';
import TablePagination from '../components/admin/TablePagination.jsx';
import DirectorySearchStatus from '../components/admin/DirectorySearchStatus.jsx';
import useDoctors from '../hooks/useDoctors.js';
import useConfirmedNavigation from '../auth/useConfirmedNavigation.js';
import { usePlatformConfirm } from '../components/PlatformConfirmation.jsx';
import { Head, statusPill, useWs } from './common.jsx';

const dash = (value) => String(value ?? '').trim() || '--';

export function DoctorList() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [headquarterId, setHeadquarterId] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState('list');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  const filters = { query, status, ...(zoneId ? { zone_id: zoneId } : {}), ...(headquarterId ? { headquarter_id: headquarterId } : {}) };
  const data = useDoctors({ ...filters, limit: pageSize, offset: (page - 1) * pageSize });
  const pageCount = Math.max(1, Math.ceil((data.filtered || 0) / pageSize));
  useEffect(() => { if (!data.loading && !data.error && !data.partial && page > pageCount) setPage(pageCount); }, [data.loading, data.error, data.partial, page, pageCount]);
  const activeCount = [status, zoneId, headquarterId].filter(Boolean).length;
  const zones = data.zones || [];
  const headquarters = data.headquarters || [];
  const self = data.mrs?.[0];
  const serial = (index) => (data.partial ? index + 1 : (page - 1) * pageSize + index + 1);
  const reset = () => { setSearch(''); setQuery(''); setStatus(''); setZoneId(''); setHeadquarterId(''); setPage(1); };
  return <>
    <Head eyebrow="My Doctors" title="My Doctors" text="Your assigned doctors from the shared server directory." />
    <div className="mrw-bar mrw-doctor-bar">
      <button type="button" className="admin-button admin-button--secondary" onClick={data.retry} disabled={data.loading}>Refresh</button>
      <input type="search" maxLength={200} aria-label="Search doctors" placeholder="Search name, registration, clinic or contact" value={search} onChange={(event) => setSearch(event.target.value)} />
      <button type="button" className="admin-button admin-button--secondary mrw-filter-toggle" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="mrw-doctor-filters" data-testid="button-toggle-doctor-filters"><SlidersHorizontal size={15} aria-hidden="true" />Filters{activeCount > 0 && <span className="mrw-filter-count" aria-label={`${activeCount} active filters`}>{activeCount}</span>}<ChevronDown size={15} aria-hidden="true" /></button>
      <div className="mrw-choice mrw-doctor-view" role="group" aria-label="Doctor view">{[['list', 'List view', List], ['grid', 'Grid view', LayoutGrid]].map(([mode, label, Icon]) => <button key={mode} type="button" aria-label={label} title={label} aria-pressed={view === mode} onClick={() => setView(mode)}><Icon size={20} aria-hidden="true" /></button>)}</div>
    </div>
    <div id="mrw-doctor-filters" className="mrw-card mrw-filter-panel" hidden={!filtersOpen} role="region" aria-label="Doctor filters">
      <label className="mrw-field"><span>Zone</span><select className="admin-select" value={zoneId} onChange={(event) => { setZoneId(event.target.value); setPage(1); }}><option value="">All zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
      <label className="mrw-field"><span>Headquarter</span><select className="admin-select" value={headquarterId} onChange={(event) => { setHeadquarterId(event.target.value); setPage(1); }}><option value="">All headquarters</option>{headquarters.map((hq) => <option key={hq.id} value={hq.id}>{hq.name}</option>)}</select></label>
      <label className="mrw-field"><span>Status</span><select className="admin-select" aria-label="Doctor status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label className="mrw-field"><span>MR · self only</span><select className="admin-select" disabled aria-label="MR (yourself only)" value="self"><option value="self">{self?.name || 'You (self only)'}</option></select></label>
      <div className="mrw-filter-actions"><button type="button" className="admin-button admin-button--secondary" onClick={reset} disabled={!activeCount && !search}>Clear filters</button></div>
    </div>
    {data.error ? <div className="mrw-card" role="alert"><p>{data.error}</p><button className="admin-button" onClick={data.retry}>Retry loading doctors</button></div>
      : data.loading ? <p role="status">Loading doctors…</p>
        : !data.records.length ? <div className="mrw-card"><p>{data.partial ? 'No matches in this search section. Continue below.' : 'No assigned doctors match this scope.'}</p></div>
          : view === 'grid' ? <div className="mrw-grid">{data.records.map((doctor) => <Link className="mrw-card" key={doctor.id} href={`/mr/doctors/${doctor.id}`}><h2>{doctor.name}</h2><p>{dash(doctor.doctorNumber)} · {dash(doctor.registrationNumber)}</p><p>{dash(doctor.qualification)} · {dash(doctor.clinicName)}</p><p>{dash(doctor.phoneDisplay)} · {dash(doctor.emailDisplay)}</p><p>{dash(doctor.city)}, {dash(doctor.state)}</p>{statusPill(doctor.status)}</Link>)}</div>
            : <div className="mrw-card mrw-scroll" tabIndex={0} role="region" aria-label="Assigned doctor list"><table className="mrw-table mrw-doctor-table"><caption className="sr-only">{data.partial ? 'Serial numbers restart in each bounded search section.' : 'Assigned doctors, numbered across pages.'} Scroll horizontally to see every field.</caption><thead><tr><th scope="col">Sr. No.</th><th scope="col">Name</th><th scope="col">Phone No.</th><th scope="col">Email</th><th scope="col">Reg. No.</th><th scope="col">Qualification</th><th scope="col">Clinic Name</th><th scope="col">City</th><th scope="col">State</th><th scope="col">Status</th></tr></thead><tbody>{data.records.map((doctor, index) => <tr key={doctor.id}><td>{serial(index)}</td><td><Link href={`/mr/doctors/${doctor.id}`}>{dash(doctor.name)}</Link><div>{dash(doctor.doctorNumber)}</div></td><td>{dash(doctor.phoneDisplay)}</td><td>{dash(doctor.emailDisplay)}</td><td>{dash(doctor.registrationNumber)}</td><td>{dash(doctor.qualification)}</td><td>{dash(doctor.clinicName)}</td><td>{dash(doctor.city)}</td><td>{dash(doctor.state)}</td><td>{statusPill(doctor.status)}</td></tr>)}</tbody></table></div>}
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
      ['Clinic', doctor.clinicName], ['Phone', doctor.phoneDisplay], ['Alternate phone', doctor.alternatePhoneDisplay], ['Email', doctor.emailDisplay],
      ['Date of joining', doctor.dateOfJoining], ['Assigned MR', doctor.mrName], ['Zone', doctor.zoneName],
      ['Status', doctor.status], ['Verification', doctor.verification], ['Invoice type', doctor.invoiceType], ['GST number', doctor.gstNumber],
      ['Drug licence number', doctor.drugLicenceNumber], ['Order discount (%)', doctor.orderDiscount], ['Days limit', doctor.daysLimit],
      ['Payment limit', doctor.paymentLimit], ['Address', [doctor.addressLine1, doctor.addressLine2, doctor.landmark, doctor.city, doctor.state, doctor.pincode, doctor.country].filter(Boolean).join(', ')],
    ].map(([label, value]) => <div className="mrw-profile-field" key={label}><dt>{label}</dt><dd>{String(value ?? '').trim() || '--'}</dd></div>)}</dl></div>}
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
