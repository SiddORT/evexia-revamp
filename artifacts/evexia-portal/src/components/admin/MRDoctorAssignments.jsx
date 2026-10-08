import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { mrAssociatedDoctors } from '../../services/serverMRs.js';
import { useMasterActions } from '../../auth/useMasterActions.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import TablePagination from './TablePagination.jsx';

export default function MRDoctorAssignments({ mr }) {
  const can = useMasterActions('doctor');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState({ items: [], total: 0, filtered: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setLoading(true);
    mrAssociatedDoctors(mr.id, { limit: pageSize, offset: (page - 1) * pageSize }, controller.signal)
      .then((result) => { guard(); if (!controller.signal.aborted) { setData(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) { setData({ items: [], total: 0, filtered: 0 }); setError(cause.message); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mr.id, page, pageSize, revision]);
  const pageCount = Math.max(1, Math.ceil(data.filtered / pageSize));
  useEffect(() => { if (!loading && !error && page > pageCount) setPage(pageCount); }, [loading, error, page, pageCount]);
  return <div>
    <button type="button" className="admin-button admin-button--secondary" disabled={loading} onClick={() => setRevision((n) => n + 1)}>Refresh assignments</button>
    {loading ? <p role="status">Loading assigned doctors…</p> : error ? <p role="alert">{error}</p> : <>
      <p data-testid="text-mr-doctor-count">{data.filtered} live assigned {data.filtered === 1 ? 'doctor' : 'doctors'}</p>
      {data.items.length ? <ul>{data.items.map((doctor) => <li key={doctor.id}>{can.edit ? <Link href={`/admin/masters/doctors/${doctor.id}`}>{doctor.name}</Link> : doctor.name} · {doctor.registrationNumber} · {doctor.status} · {doctor.zoneName || 'Missing Zone'}</li>)}</ul> : <p>No live doctors assigned to this MR.</p>}
      <TablePagination page={page} pageSize={pageSize} pageCount={pageCount} filtered={data.filtered} total={data.filtered} label="assigned doctors" onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
    </>}
  </div>;
}
