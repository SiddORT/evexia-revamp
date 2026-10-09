import { useCallback, useEffect, useRef, useState } from 'react';
import useDirectoryContinuation from './useDirectoryContinuation.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../auth/adminSession.js';
import { allDoctorMRChoices, bulkDoctors, contactDoctor, createDoctor, deleteDoctor, doctorFilters, editDoctor, getDoctor, listDoctors, statusDoctor } from '../services/serverDoctors.js';

export default function useDoctors(params = {}, detailId = null) {
  const [state, setState] = useState({ records: [], doctor: null, mrs: [], zones: [], states: [], total: 0, filtered: 0, loading: true, error: '', missingMR: false, missingZone: false });
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const continuation = useDirectoryContinuation(params);
  const requestKey = JSON.stringify(continuation.params);
  const retry = useCallback(() => { setRevision((n) => n + 1); }, []);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) setState({ records: [], doctor: null, mrs: [], zones: [], states: [], total: 0, filtered: 0, loading: false, error: 'Session identity changed.' });
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setState((old) => ({ ...old, loading: true }));
    async function load() {
      try {
        const [data, filters] = await Promise.all([
          detailId ? getDoctor(detailId, controller.signal) : listDoctors(JSON.parse(requestKey), controller.signal),
          doctorFilters(controller.signal),
        ]);
        const mrs = await allDoctorMRChoices(controller.signal, detailId ? data.mrId : undefined);
        guard();
        if (controller.signal.aborted) return;
        const zones = filters.zones;
        setState({ records: detailId ? [data] : data.items, doctor: detailId ? data : null, mrs, zones, ...filters,
          total: detailId ? 1 : data.total, filtered: detailId ? 1 : data.filtered,
          partial: !detailId && data.partial, scanned: data.scanned, nextCursor: data.nextCursor, loading: false, error: '' });
      } catch (cause) {
        if (controller.signal.aborted) return;
        try { guard(); } catch { return; }
        setState((old) => ({ ...old, loading: false, error: cause.message || 'Doctor service is unavailable.' }));
      }
    }
    void load();
    return () => controller.abort();
  }, [requestKey, detailId, revision]);
  async function apply(operation, message) {
    if (busy.current || state.loading || state.error) return { success: false, error: 'Wait for records to load or refresh before saving.' };
    busy.current = true; setPending(true);
    const guard = reportingIdentityGuard();
    try {
      const result = await operation();
      guard();
      if (!alive.current) return { success: false };
      setFeedback(message); retry();
      return { success: true, record: result };
    } catch (cause) {
      try { guard(); } catch { return { success: false, error: 'Session changed.' }; }
      if (alive.current && (cause.status === 409 || cause.ambiguous)) setState((old) => ({ ...old, error: `${cause.message} Review current records before retrying; your draft is preserved.` }));
      return { success: false, error: cause.message };
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const row = (id) => typeof id === 'object' ? id : state.records.find((record) => record.id === id);
  const selection = (ids) => ids.map(row);
  return { ...state, pending, feedback, retry, clearFeedback: () => setFeedback(''),
    continueSearch: () => continuation.next(state), restartSearch: () => { continuation.restart(); retry(); },
    add: (values) => apply(() => createDoctor(values), 'Doctor added successfully.'),
    edit: (id, values) => apply(() => editDoctor(row(id), values), 'Doctor updated successfully.'),
    changeStatus: (id, status) => apply(() => statusDoctor(row(id), status), 'Doctor status updated.'),
    remove: (id) => apply(() => deleteDoctor(row(id)), 'Doctor removed from normal use. Stored relationships remain.'),
    changeContactRequirement: (id, requirement) => apply(() => contactDoctor(row(id), requirement), 'Contact rule updated.'),
    changeVerification: (ids, value) => apply(() => bulkDoctors(selection(ids), 'verification', value), 'Verification updated.'),
    shiftMR: (ids, id) => apply(() => bulkDoctors(selection(ids), 'shift', id), 'MR assignment updated.'),
  };
}
