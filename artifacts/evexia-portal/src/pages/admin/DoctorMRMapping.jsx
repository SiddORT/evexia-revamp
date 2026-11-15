import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Filter, History, MapPin, RefreshCw, Shuffle, Waypoints } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import MasterFilterReset from '../../components/admin/MasterFilterReset.jsx';
import StatusBadge from '../../components/admin/StatusBadge.jsx';
import TablePagination from '../../components/admin/TablePagination.jsx';
import DoctorMRSelect from '../../components/admin/DoctorMRSelect.jsx';
import { AreaDialog, HistoryDialog, MappingReferenceSelect, TransferDialog } from '../../components/admin/doctorMapping/MappingParts.jsx';
import { bulkDoctors, listDoctorMappings, setDoctorArea } from '../../services/serverDoctors.js';
import { reportingIdentityGuard } from '../../auth/adminSession.js';
import { useMasterActions } from '../../auth/useMasterActions.js';
import '../../doctor-list.css';
import '../../doctor-mr-mapping.css';

const EMPTY = { area: '', areaUnset: false, hq: '', zone: '', status: 'all', mr: '', doctor: '' };
const TABS = [{ id: 'doctor', label: 'Doctor-wise' }, { id: 'mr', label: 'MR-wise' }];
const RECONCILE = 'The result of the last save is uncertain or records changed. Reload the current records and review the Doctor’s assignment history before saving again. Your draft is kept.';

function MRMappingGroup({ group, selection, children }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <section className="doctor-mapping__group" aria-labelledby={`${id}-title`} data-testid={`group-mr-${group.id}`}>
    <header className="doctor-mapping__group-head">
      <div className="doctor-mapping__group-heading">
        <h2><button type="button" id={`${id}-title`} className="doctor-mapping__group-toggle" aria-expanded={expanded} aria-controls={`${id}-doctors`} aria-describedby={`${id}-description`}
          onClick={() => setExpanded((old) => !old)} data-testid={`button-toggle-mapping-group-${group.id}`}>
          <span className={group.id === 'missing' ? 'admin-record-missing' : ''}>{group.name}</span><ChevronDown size={18} aria-hidden="true" />
        </button></h2>
        <p id={`${id}-description`} className="doctor-mapping__hint">{group.mrStatus ? `MR status: ${group.mrStatus} · ` : ''}HQ: {group.hq || '—'} · Zones: {group.zones.length ? group.zones.join(', ') : '—'} · {group.rows.length} Doctor{group.rows.length === 1 ? '' : 's'} on this page</p>
      </div>
      {selection}
    </header>
    <div id={`${id}-doctors`} hidden={!expanded}>{children}</div>
  </section>;
}

export default function DoctorMRMapping() {
  const can = useMasterActions('doctor');
  const [filters, setFilters] = useState(EMPTY);
  const [tab, setTab] = useState('doctor');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ items: [], total: 0, filtered: 0, loading: true, error: '' });
  const [mrs, setMrs] = useState([]);
  const [selected, setSelected] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [transferDraft, setTransferDraft] = useState({ mrId: '', reason: '', reviewed: false });
  const [areaDrafts, setAreaDrafts] = useState({});
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reconcile, setReconcile] = useState(false);
  const busy = useRef(false);
  const tabRefs = useRef([]);
  const limit = Math.min(pageSize, 100);

  const params = { area_id: filters.areaUnset ? 'unset' : filters.area, headquarter_id: filters.hq, zone_id: filters.zone, status: filters.status, mr_id: filters.mr, doctor_id: filters.doctor, limit, offset: (page - 1) * limit };
  const key = JSON.stringify(params);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setData((old) => ({ ...old, loading: true, error: '' }));
    listDoctorMappings(JSON.parse(key), controller.signal).then((result) => {
      guard(); if (controller.signal.aborted) return;
      setData({ items: result.items || [], total: result.total || 0, filtered: result.filtered ?? result.total ?? 0, loading: false, error: '' });
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      try { guard(); } catch { return; }
      setData((old) => ({ ...old, items: [], loading: false, error: cause.message || 'Mappings could not be loaded.' }));
    });
    return () => controller.abort();
  }, [key, revision]);
  useEffect(() => { setSelected((old) => old.filter((id) => data.items.some((row) => row.id === id))); }, [data.items]);

  const hydrateMRs = (items) => setMrs((old) => [...items, ...old.filter((row) => !items.some((item) => item.id === row.id))]);
  const pageCount = Math.max(1, Math.ceil(data.filtered / limit));
  const set = (patch) => { setFilters((old) => ({ ...old, ...patch })); setPage(1); setSelected([]); };
  const activeFilterCount = [filters.area || filters.areaUnset, filters.hq, filters.zone, filters.status !== 'all', filters.mr, filters.doctor].filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;
  const reload = () => { setRevision((n) => n + 1); setReconcile(false); setActionError(''); };
  const selectedRows = data.items.filter((row) => selected.includes(row.id));
  const toggle = (id, on) => setSelected((old) => on ? [...new Set([...old, id])] : old.filter((value) => value !== id));
  const groups = useMemo(() => {
    const map = new Map();
    for (const row of data.items) {
      const id = row.mrId || 'missing';
      if (!map.has(id)) map.set(id, { id, name: row.mrName || 'Missing MR', mrStatus: row.mrStatus, hq: row.headquarterName, zones: row.zoneNames || [], rows: [] });
      map.get(id).rows.push(row);
    }
    return [...map.values()];
  }, [data.items]);
  const locked = pending || data.loading || Boolean(data.error) || reconcile;

  async function run(operation, message) {
    if (busy.current) return false;
    busy.current = true; setPending(true); setActionError('');
    const guard = reportingIdentityGuard();
    try {
      await operation(); guard();
      setFeedback(message); setDialog(null); setSelected([]); setRevision((n) => n + 1);
      return true;
    } catch (cause) {
      try { guard(); } catch {
        setReconcile(true); setDialog(null); setActionError(RECONCILE);
        return false;
      }
      const rejectedAssignment = cause.status === 409 && ['mr_assignment', 'doctor_assignment', 'doctor_area'].includes(cause.code);
      const uncertain = cause.ambiguous || !cause.status || (cause.status === 409 && !rejectedAssignment);
      if (uncertain) { setReconcile(true); setDialog(null); setActionError(`${cause.message || 'Save result unknown.'} ${RECONCILE}`); }
      else setActionError(cause.message || 'The change could not be saved.');
      return false;
    } finally { busy.current = false; setPending(false); }
  }
  async function transfer(moving) {
    if (await run(() => bulkDoctors(moving, 'shift', transferDraft.mrId, transferDraft.reason.trim()), `${moving.length} Doctor${moving.length === 1 ? '' : 's'} transferred. Linked Patients moved with them.`)) setTransferDraft({ mrId: '', reason: '', reviewed: false });
  }
  async function saveArea(doctor) {
    const draft = areaDrafts[doctor.id];
    if (await run(() => setDoctorArea(doctor, draft.areaId || null, draft.reason.trim()), `Doctor Area saved for ${doctor.name}.`)) setAreaDrafts((old) => { const next = { ...old }; delete next[doctor.id]; return next; });
  }
  function openTransfer(rows) {
    setActionError(''); setFeedback('');
    setDialog({ type: 'transfer', rows });
  }
  function onTabKey(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % 2 : event.key === 'ArrowLeft' ? (index + 1) % 2 : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setTab(TABS[next].id); tabRefs.current[next]?.focus();
  }

  const areaCell = (row) => <span className={row.areaId ? '' : 'doctor-mapping__muted'} data-testid={`text-doctor-area-${row.id}`}>{row.areaName ? <>{row.areaName}{row.areaHeadquarterName && <small> Area HQ: {row.areaHeadquarterName}</small>}</> : 'Area not set'}</span>;
  const mrCell = (row) => <span className="doctor-mapping__stack"><strong className={row.mrName ? '' : 'admin-record-missing'}>{row.mrName || 'Missing MR'}</strong>{row.mrStatus && <small>MR status: {row.mrStatus}</small>}</span>;
  const geoCell = (row) => <span className="doctor-mapping__stack"><span>HQ: {row.headquarterName || '—'}</span><span>Zones: {row.zoneNames?.length ? row.zoneNames.join(', ') : '—'}</span></span>;
  const rowActions = (row) => <div className="doctor-mapping__actions">
    {can.edit && <button type="button" className="admin-button admin-button--secondary doctor-mapping__small" disabled={locked} onClick={() => openTransfer([row])} data-testid={`button-transfer-${row.id}`}><Shuffle size={14} aria-hidden="true" /> Change MR</button>}
    {can.edit && <button type="button" className="admin-button admin-button--secondary doctor-mapping__small" disabled={locked} onClick={() => { setActionError(''); setAreaDrafts((old) => old[row.id] ? old : { ...old, [row.id]: { areaId: row.areaId || '', reason: '' } }); setDialog({ type: 'area', row }); }} data-testid={`button-area-${row.id}`}><MapPin size={14} aria-hidden="true" /> Doctor Area</button>}
    <button type="button" className="admin-button admin-button--secondary doctor-mapping__small" onClick={() => setDialog({ type: 'history', row })} data-testid={`button-history-${row.id}`}><History size={14} aria-hidden="true" /> History</button>
  </div>;
  const check = (row) => can.edit && <input type="checkbox" className="doctor-master__check" checked={selected.includes(row.id)} disabled={locked} onChange={(event) => toggle(row.id, event.target.checked)} aria-label={`Select ${row.name}`} data-testid={`checkbox-mapping-${row.id}`} />;
  const doctorCell = (row) => <span className="doctor-mapping__stack"><strong>{row.name}</strong><small>{row.doctorNumber || 'No number'}</small></span>;

  if (!can.view && !can.read) return <AdminLayout title="Doctor MR Mapping"><div className="admin-empty" role="alert"><strong>Doctor MR Mapping is not available</strong><p>Your role does not include Doctor view permission.</p></div></AdminLayout>;

  return <AdminLayout title="Doctor MR Mapping">
    <div className="doctor-mapping">
      <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Care network</p><h1>Doctor MR Mapping</h1>
        <p className="admin-page-head__description">Each Doctor has one current MR. Transfers move linked Patients and are recorded with a reason; saved orders and financial records stay unchanged.</p></div>
        <button type="button" className="admin-button admin-button--secondary" disabled={data.loading || pending} onClick={reload} data-testid="button-refresh-mappings"><RefreshCw size={15} aria-hidden="true" /> Reload current records</button></div>
      {feedback && !reconcile && <div className="admin-feedback" role="status" data-testid="status-mapping-feedback">{feedback}</div>}
      {actionError && !dialog && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-mapping-error">{actionError}
        {reconcile && <div className="doctor-mapping__reconcile"><button type="button" className="admin-button admin-button--secondary" onClick={reload} data-testid="button-reconcile">I will review — reload current records</button></div>}</div>}

      <section className="admin-panel doctor-mapping__filters" aria-label="Mapping filters">
        <details className="doctor-master__filters">
          <summary data-testid="button-toggle-mapping-filters"><Filter size={15} aria-hidden="true" /> Filter records{hasFilters && ` · ${activeFilterCount} active`}<ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="doctor-mapping__filter-grid">
          <div className="admin-filter"><MappingReferenceSelect refKind="area" id="mapping-filter-area" label="Doctor Area" value={filters.area} onChange={(area) => set({ area, areaUnset: false })} />
            <label className="doctor-mapping__inline"><input type="checkbox" checked={filters.areaUnset} onChange={(event) => set({ areaUnset: event.target.checked, area: '' })} data-testid="checkbox-filter-area-unset" /> Only Doctors with Area not set</label></div>
          <div className="admin-filter"><MappingReferenceSelect refKind="headquarter" id="mapping-filter-hq" label="Current MR HQ" value={filters.hq} onChange={(hq) => set({ hq })} /></div>
          <div className="admin-filter"><MappingReferenceSelect refKind="zone" id="mapping-filter-zone" label="Current MR Zone" value={filters.zone} onChange={(zone) => set({ zone })} /></div>
          <div className="admin-filter"><label className="doctor-mapping__label" htmlFor="mapping-filter-status">Doctor status</label>
            <select id="mapping-filter-status" className="admin-select" value={filters.status} onChange={(event) => set({ status: event.target.value })} data-testid="select-mapping-status"><option value="all">All Doctors</option><option value="active">Active Doctors</option><option value="inactive">Inactive Doctors</option></select></div>
          <div className="admin-filter"><DoctorMRSelect id="mapping-filter-mr" label="Current MR" labelClassName="doctor-mapping__label" required={false} value={filters.mr} onHydrate={hydrateMRs} onChange={(mr) => set({ mr })} testId="select-mapping-mr" /></div>
          <div className="admin-filter"><MappingReferenceSelect refKind="doctor" id="mapping-filter-doctor" label="Doctor" value={filters.doctor} onChange={(doctor) => set({ doctor })} /></div>
        </div>
        </details>
        <MasterFilterReset disabled={!hasFilters} onClick={() => set(EMPTY)} testId="button-reset-mapping-filters" />
      </section>

      <section className="admin-panel" aria-label="Doctor MR mappings">
        <div className="doctor-mapping__tabs" role="tablist" aria-label="Mapping view">
          {TABS.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`mapping-tab-${item.id}`} aria-controls="mapping-panel" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
            className={`doctor-mapping__tab${tab === item.id ? ' doctor-mapping__tab--active' : ''}`} onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKey(event, index)} data-testid={`tab-mapping-${item.id}`}>{item.label}</button>)}
        </div>
        {can.edit && selectedRows.length > 0 && <div className="doctor-master__bulk" role="group" aria-label="Selected Doctors">
          <span className="doctor-master__bulk-label" data-testid="text-mapping-selected">{selectedRows.length} selected on this page</span>
          <button type="button" className="admin-button" disabled={locked} onClick={() => openTransfer(selectedRows)} data-testid="button-transfer-selected"><Shuffle size={15} aria-hidden="true" /> Transfer to another MR</button>
          <button type="button" className="doctor-master__text-button" onClick={() => setSelected([])} data-testid="button-clear-mapping-selection">Clear selection</button></div>}
        <div id="mapping-panel" role="tabpanel" aria-labelledby={`mapping-tab-${tab}`} tabIndex={0} className="doctor-mapping__panel">
          {data.error ? <div className="admin-empty" role="alert"><span className="admin-empty__icon"><Waypoints size={21} aria-hidden="true" /></span><strong>Mappings could not be loaded</strong><p>{data.error}</p><button type="button" className="admin-button" onClick={reload} data-testid="button-retry-mappings">Retry</button></div>
            : data.loading ? <div className="doctor-mapping__skeleton" role="status" aria-label="Loading mappings"><span /><span /><span /><span /></div>
              : !data.items.length ? <div className="admin-empty" data-testid="status-mapping-empty"><span className="admin-empty__icon"><Waypoints size={21} aria-hidden="true" /></span><strong>{hasFilters ? 'No Doctors match these filters' : 'No Doctors yet'}</strong><p>{hasFilters ? 'Change or reset the filters.' : 'Doctors appear here once added in Doctor Master.'}</p></div>
                : tab === 'doctor' ? <ul className="doctor-mapping__rows" aria-label="Doctors">
                  <li className="doctor-mapping__row doctor-mapping__row--head" aria-hidden="true"><span /><span>Doctor</span><span>Doctor Area</span><span>Current MR</span><span>MR HQ / Zones</span><span>Doctor status</span><span>Actions</span></li>
                  {data.items.map((row) => <li key={row.id} className="doctor-mapping__row" data-testid={`row-mapping-${row.id}`}>
                    <span>{check(row)}</span><span>{doctorCell(row)}</span><span data-label="Doctor Area">{areaCell(row)}</span><span data-label="Current MR">{mrCell(row)}</span><span data-label="MR HQ / Zones">{geoCell(row)}</span>
                    <span data-label="Doctor status"><StatusBadge status={row.status} id={row.id} kind="mapping" /></span><span>{rowActions(row)}</span></li>)}</ul>
                  : <div className="doctor-mapping__groups">
                    <p className="doctor-mapping__hint" role="note">Groups show only Doctors on this page. An MR’s group may continue on other pages.</p>
                    {groups.map((group) => {
                      const ids = group.rows.map((row) => row.id);
                      const all = ids.every((id) => selected.includes(id));
                      return <MRMappingGroup key={group.id} group={group} selection={can.edit && <label className="doctor-mapping__inline"><input type="checkbox" checked={all} disabled={locked} aria-label={`Select group on this page: ${group.name}`} onChange={(event) => setSelected((old) => event.target.checked ? [...new Set([...old, ...ids])] : old.filter((id) => !ids.includes(id)))} data-testid={`checkbox-group-${group.id}`} /> Select group on this page</label>}>
                        <ul className="doctor-mapping__group-list">{group.rows.map((row) => <li key={row.id} className="doctor-mapping__group-row">
                          <span>{check(row)}</span>{doctorCell(row)}<span data-label="Doctor Area">{areaCell(row)}</span><StatusBadge status={row.status} id={row.id} kind="mapping-group" />{rowActions(row)}</li>)}</ul>
                      </MRMappingGroup>;
                    })}</div>}
        </div>
        {!data.error && !data.loading && <TablePagination page={page} pageSize={limit} pageCount={pageCount} filtered={data.filtered} total={data.total} label="Doctors" onPageChange={(n) => { setPage(n); setSelected([]); }} onPageSizeChange={(n) => { setPageSize(Math.min(n, 100)); setPage(1); setSelected([]); }} testId="text-mapping-count" />}
      </section>

      {dialog?.type === 'transfer' && <TransferDialog doctors={dialog.rows} draft={transferDraft} onDraft={setTransferDraft} mrs={mrs} onHydrate={hydrateMRs} pending={pending} error={actionError} onConfirm={transfer} onClose={() => { if (!pending) { setDialog(null); setActionError(''); } }} />}
      {dialog?.type === 'area' && <AreaDialog doctor={dialog.row} draft={areaDrafts[dialog.row.id] || { areaId: '', reason: '' }} onDraft={(draft) => setAreaDrafts((old) => ({ ...old, [dialog.row.id]: draft }))} pending={pending} error={actionError} onConfirm={() => saveArea(dialog.row)} onClose={() => { if (!pending) { setDialog(null); setActionError(''); } }} />}
      {dialog?.type === 'history' && <HistoryDialog doctor={dialog.row} onClose={() => setDialog(null)} />}
    </div>
  </AdminLayout>;
}
