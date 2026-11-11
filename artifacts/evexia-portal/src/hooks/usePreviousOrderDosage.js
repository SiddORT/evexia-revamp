import { useEffect, useRef, useState } from 'react';
import { getSession, subscribeSession } from '../auth/adminSession.js';
import { previousOrderDosage } from '../services/serverImmunotherapy.js';

const identity = () => {
  const user = getSession().user;
  return JSON.stringify([user?.id, user?.identity_kind, user?.mr_id]);
};

// Suggestions are one-time empty-field assistance. They never refresh editor
// values, replay after a manual choice, or participate in the save contract.
export default function usePreviousOrderDosage({ patientId, enabled, blocked, busy, setValues, initialDosage }) {
  const [lookup, setLookup] = useState(null);
  const [revision, setRevision] = useState(0);
  const owner = useRef(identity());
  const generation = useRef(0);
  const manual = useRef(Boolean(initialDosage));
  const current = useRef(null);
  current.current = { patientId, enabled, blocked };

  // Called synchronously by patient changes, before an old response can run.
  function changePatient() {
    generation.current += 1;
    manual.current = false;
    setLookup(null);
  }
  function chooseDosage(dosage) {
    manual.current = true;
    setValues((values) => ({ ...values, dosage }));
  }

  useEffect(() => subscribeSession(() => {
    if (identity() !== owner.current) {
      generation.current += 1;
      manual.current = true;
      setLookup(null);
    }
  }), []);

  useEffect(() => {
    if (!enabled || !patientId || identity() !== owner.current) return undefined;
    const controller = new AbortController();
    const version = ++generation.current;
    const valid = () => !controller.signal.aborted && generation.current === version
      && current.current.patientId === patientId && identity() === owner.current;
    setLookup({ patientId, state: 'loading' });
    previousOrderDosage(patientId, controller.signal).then((data) => {
      if (!valid()) return;
      setLookup(data);
      if (!data.suggestedDosage) return;
      setValues((values) => valid() && current.current.enabled && !current.current.blocked
        && !busy.current && !manual.current && values.patientId === patientId && !values.dosage
        ? { ...values, dosage: data.suggestedDosage } : values);
    }).catch(() => {
      if (valid()) setLookup({ patientId, state: 'error' });
    });
    return () => controller.abort();
  }, [patientId, enabled, revision]);

  return {
    lookup: enabled && identity() === owner.current && lookup?.patientId === patientId ? lookup : null,
    changePatient,
    chooseDosage,
    retry: () => setRevision((value) => value + 1),
  };
}
