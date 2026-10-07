import { useCallback, useEffect, useRef, useState } from 'react';
import { getSession, reportingIdentityGuard, subscribeSession } from '../auth/adminSession.js';
import { createPatient, editPatient, getPatient, listPatients, patientMRChoices, statusPatient } from '../services/serverPatients.js';

const EMPTY = { records: [], mrs: [], zones: [], total: 0, filtered: 0, loading: true, error: '', sessionEpoch: 0 };
export default function usePatients(params = {}, detailId = null) {
  const [state, setState] = useState(EMPTY);
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const requestKey = JSON.stringify(params);
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id !== owner) {
        setState((old) => ({ ...EMPTY, sessionEpoch: old.sessionEpoch + 1, loading: false, error: 'Session identity changed.' }));
        setFeedback('');
      }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const guard = reportingIdentityGuard();
    setState((old) => ({ ...old, loading: true }));
    async function load() {
      try {
        const [data, mrs] = await Promise.all([
          detailId ? getPatient(detailId, controller.signal) : listPatients(JSON.parse(requestKey), controller.signal),
          patientMRChoices(controller.signal),
        ]);
        guard();
        if (controller.signal.aborted) return;
        const zones = [...new Map(mrs.filter((mr) => mr.zoneId).map((mr) => [mr.zoneId, { id: mr.zoneId, name: mr.zoneName }])).values()];
        setState((old) => ({ records: detailId ? [data] : data.items, mrs, zones, sessionEpoch: old.sessionEpoch,
          total: detailId ? 1 : data.total, filtered: detailId ? 1 : data.filtered, loading: false, error: '' }));
      } catch (cause) {
        if (controller.signal.aborted) return;
        try { guard(); } catch { return; }
        setState((old) => ({ ...old, loading: false, error: cause.message || 'Patient service is unavailable.' }));
      }
    }
    void load();
    return () => controller.abort();
  }, [requestKey, detailId, revision]);
  async function apply(operation, message) {
    if (busy.current || state.loading || state.error) return { success: false, error: 'Wait for records or refresh before saving.' };
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
      if (alive.current && (cause.status === 409 || cause.ambiguous)) setState((old) => ({ ...old, error: `${cause.message} Review current server records before retrying; your draft is preserved.` }));
      return { success: false, error: cause.message };
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const row = (id) => typeof id === 'object' ? id : state.records.find((record) => record.id === id);
  return { ...state, pending, feedback, retry, clearFeedback: () => setFeedback(''),
    add: (values) => apply(() => createPatient(values), 'Patient added successfully.'),
    edit: (id, values) => apply(() => editPatient(row(id), values), 'Patient updated successfully.'),
    changeStatus: (id, status) => apply(() => statusPatient(row(id), status), 'Patient status updated.'),
  };
}
