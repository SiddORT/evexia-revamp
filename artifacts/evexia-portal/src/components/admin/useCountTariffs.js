import { useEffect, useRef, useState } from 'react';
import { loadCountTariffs, appendCountTariff } from '../../services/serverCountTariffs.js';
import { catalogueRate } from '../../services/rates.js';
import { validDate } from '../../services/serverPricingRules.js';

const initial = (value) => Object.fromEntries([1, 2, 3].map((count) => {
  const rows = value.history.filter((r) => r.allergenCount === count).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return [count, { totalMrp: rows[0]?.totalMrp ?? value.suggestedUnitPrice ?? '', effectiveFrom: '' }];
}));
export default function useCountTariffs(categoryId, enabled, owner) {
  const [saved, setSaved] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const seq = useRef(0);
  const active = useRef(false);
  const latest = useRef({});
  latest.current = { drafts, attempt, baseline, saved };
  useEffect(() => {
    const controller = new AbortController();
    seq.current++; active.current = false; setSaved(null); setDrafts(null); setBaseline(null);
    setAttempt(null); setError(''); setNotice(''); setBlocked(false); setBusy(false);
    if (categoryId && enabled) reload(false, controller.signal);
    return () => { seq.current++; controller.abort(); };
  }, [categoryId, enabled, owner]);
  async function reload(keep = true, signal) {
    if (active.current || latest.current.attempt) return;
    const sequence = ++seq.current;
    active.current = true; setBusy(true); setError('');
    try {
      const value = await loadCountTariffs(categoryId, signal);
      if (sequence !== seq.current) return;
      setSaved(value); setBlocked(false);
      if (!keep || !latest.current.drafts) {
        const next = initial(value); setDrafts(next); setBaseline(next);
      }
      setNotice(keep ? 'Tariff history reloaded. Your edited amounts and dates were retained; compare with saved history before saving.' : '');
    } catch (cause) { if (sequence === seq.current && !signal?.aborted) { setError(cause.message); setBlocked(true); } }
    finally { if (sequence === seq.current) { active.current = false; setBusy(false); } }
  }
  async function save(count) {
    if (active.current || blocked || !saved || saved.categoryId !== categoryId) return;
    let body = attempt;
    if (!body) {
      const draft = drafts[count];
      if (!validDate(draft.effectiveFrom)) { setError('Enter an explicit valid Effective From date. No date is inferred.'); return; }
      try {
        body = Object.freeze({ categoryId, allergenCount: count, totalMrp: catalogueRate(draft.totalMrp.trim()),
          effectiveFrom: draft.effectiveFrom, expected_version: Math.max(0, ...saved.history.filter((r) => r.allergenCount === count).map((r) => r.version)),
          idempotencyKey: crypto.randomUUID() });
      } catch (cause) { setError(cause.message); return; }
    }
    const sequence = ++seq.current;
    active.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const row = await appendCountTariff(body);
      if (sequence !== seq.current) return;
      setSaved((old) => ({ ...old, history: [...old.history.filter((r) => r.id !== row.id), row] }));
      const next = { totalMrp: row.totalMrp, effectiveFrom: '' };
      setDrafts((old) => ({ ...old, [body.allergenCount]: next }));
      setBaseline((old) => ({ ...old, [body.allergenCount]: next }));
      setAttempt(null);
      setNotice(`Count ${body.allergenCount} tariff saved as version ${row.version}. Quantities were not saved by this action.`);
    } catch (cause) {
      if (sequence !== seq.current) return;
      if (cause.terminal) {
        setAttempt(null); setBlocked(true);
        setError(`${cause.message} This exact submission was durably rejected. Reload history and compare your retained draft before a new save.`);
      } else if (body === attempt || cause.ambiguous || cause.malformed || !cause.status || cause.status >= 500 || [408, 429].includes(cause.status)) {
        setAttempt(body); setError('Tariff save unconfirmed. Fields are locked. Retry the same submission to recover its original outcome; do not start another save.');
      } else {
        setError(cause.message);
        if (cause.status === 409) setBlocked(true);
      }
    } finally { if (sequence === seq.current) { active.current = false; setBusy(false); } }
  }
  const dirty = Boolean(drafts && JSON.stringify(drafts) !== JSON.stringify(baseline));
  // Do not render or submit the previous category's values during the render
  // before effect cleanup initializes the newly selected category.
  const scoped = saved?.categoryId === categoryId;
  return { saved: scoped ? saved : null, drafts: scoped ? drafts : null, busy, blocked, attempt, error, notice, dirty,
    locked: busy || Boolean(attempt), reload, save,
    edit: (count, field, value) => { if (!active.current && !attempt) { setDrafts((old) => ({ ...old, [count]: { ...old[count], [field]: value } })); setNotice(''); } },
    cancel: () => { if (!active.current && !attempt) { setDrafts(baseline); setError(''); setNotice('Tariff edits cancelled. Quantity edits are unchanged.'); } } };
}
