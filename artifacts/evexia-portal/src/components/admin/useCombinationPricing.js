import { useEffect, useRef, useState } from 'react';
import { exactCombinationRate, generateCombinations, saveCombinationBatch } from '../../services/serverCombinationPricing.js';
import { validDate } from '../../services/serverPricingRules.js';

const blank = () => ({ edits: {}, copyRate: null, effectiveFrom: '' });
export default function useCombinationPricing(scope, owner) {
  const identity = JSON.stringify([owner, scope]);
  const [page, setPage] = useState(null);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState({ query: '', offset: 0, limit: 25 });
  const [reload, setReload] = useState(0);
  const baseline = useRef(null);
  const scoped = useRef(identity);
  const seq = useRef(0);
  const active = useRef(false);
  const saving = useRef(false);
  const latest = useRef({});
  latest.current = { draft, attempt, page, blocked, identity, scope, view };
  useEffect(() => {
    scoped.current = identity;
    baseline.current = null;
    setPage(null); setDraft(blank()); setAttempt(null); setBlocked(false); setError(''); setNotice('');
    setView({ query: '', offset: 0, limit: 25 });
    return () => { seq.current++; };
  }, [identity]);
  const scopeId = scope?.categoryId;
  useEffect(() => {
    if (!scopeId) return undefined;
    const ctl = new AbortController();
    const sequence = ++seq.current;
    active.current = true; setBusy(true); setError('');
    const timer = setTimeout(async () => {
      try {
        const value = await generateCombinations({ ...scope, ...view }, ctl.signal);
        if (sequence !== seq.current) return;
        const old = baseline.current;
        if (old && (old.eligibilityVersion !== value.eligibilityVersion || old.scopeVersion !== value.scopeVersion)) {
          setBlocked(true);
          setError('Master eligibility or saved rates changed. Your draft has not been applied to the new scope. Review saved history, then explicitly discard the draft and reload before a new save.');
          return;
        }
        baseline.current = value;
        setPage({ ...value, identity });
      } catch (cause) {
        if (!ctl.signal.aborted && sequence === seq.current) { setError(cause.message); setPage(null); }
      } finally {
        if (sequence === seq.current) { active.current = false; setBusy(false); }
      }
    }, view.query ? 250 : 0);
    return () => { clearTimeout(timer); ctl.abort(); seq.current++; };
  }, [identity, view.query, view.offset, view.limit, reload]);
  function edit(key, value) {
    if (active.current || latest.current.attempt || latest.current.blocked) return;
    setDraft((old) => ({ ...old, edits: { ...old.edits, [key]: value } })); setNotice('');
  }
  function date(value) {
    if (!active.current && !latest.current.attempt) setDraft((old) => ({ ...old, effectiveFrom: value }));
  }
  function copy(value) {
    if (active.current || latest.current.attempt || latest.current.blocked) return;
    const copyRate = exactCombinationRate(value);
    // Supersedes every per-key override across pages; never a search-derived scope.
    setDraft((old) => ({ ...old, edits: {}, copyRate })); setNotice('Copy rate applied to the entire generated scope in this draft only. Save is still required.');
  }
  function reset() {
    if (active.current || latest.current.attempt) return;
    baseline.current = null; setDraft(blank()); setBlocked(false); setPage(null); setError(''); setNotice('');
    setReload((n) => n + 1);
  }
  async function save() {
    if (active.current || scoped.current !== latest.current.identity) return;
    const state = latest.current;
    let pending = state.attempt;
    if (!pending) {
      if (state.blocked || !state.page || state.page.identity !== identity) return;
      if (!validDate(state.draft.effectiveFrom)) { setError('Enter an explicit valid Effective From date.'); return; }
      try {
        const edits = Object.entries(state.draft.edits)
          .filter(([, value]) => state.draft.copyRate !== null || value.trim() !== '').map(([key, value]) => ({
          memberIds: key.split(','), totalMrp: exactCombinationRate(value),
        }));
        if (!edits.length && state.draft.copyRate === null) { setError('Enter at least one explicit rate or apply Copy rate to all.'); return; }
        const body = { ...scope, eligibilityVersion: baseline.current.eligibilityVersion,
          scopeVersion: baseline.current.scopeVersion, effectiveFrom: state.draft.effectiveFrom,
          copyRate: state.draft.copyRate, edits, idempotencyKey: crypto.randomUUID() };
        // Freeze the exact JSON body before the first request; retries reuse it.
        pending = Object.freeze({ body: JSON.parse(JSON.stringify(body)),
          versions: { ...state.page.rowVersions },
          keys: body.copyRate !== null ? [...state.page.scopeKeys] : edits.map((e) => e.memberIds.join(',')) });
      } catch (cause) { setError(cause.message); return; }
    }
    const sequence = ++seq.current;
    active.current = true; saving.current = true; setBusy(true); setError(''); setNotice('');
    latest.current.attempt = pending; setAttempt(pending);
    try {
      const value = await saveCombinationBatch(pending.body, pending.keys, pending.versions, owner);
      if (sequence !== seq.current) return;
      latest.current.attempt = null; setAttempt(null);
      baseline.current = null; setDraft(blank()); setPage(null); setBlocked(false);
      setNotice(`${value.saved.length} dated combination rate${value.saved.length === 1 ? '' : 's'} saved atomically. Current order quotation and saved orders are unchanged.`);
      setReload((n) => n + 1);
    } catch (cause) {
      if (sequence !== seq.current) return;
      if (cause.terminal) {
        latest.current.attempt = null; setAttempt(null); setBlocked(true);
        setError(`${cause.message} The exact submission was durably rejected; nothing in this batch was saved. Your draft is retained.`);
      } else if (state.attempt || cause.ambiguous || cause.malformed || !cause.status || cause.status >= 500 || [408, 429].includes(cause.status)) {
        setError('Save outcome is unknown. Editing and navigation are locked. Retry the same submission to recover its original atomic outcome.');
      } else {
        latest.current.attempt = null; setAttempt(null);
        setError(cause.message);
        if (cause.status === 409) setBlocked(true);
      }
    } finally {
      if (sequence === seq.current) { active.current = false; saving.current = false; setBusy(false); }
    }
  }
  const dirty = Object.keys(draft.edits).length > 0 || draft.copyRate !== null || Boolean(draft.effectiveFrom);
  return { page: page?.identity === identity ? page : null, draft, busy, attempt, blocked, error, notice,
    locked: busy || Boolean(attempt), dirty, view, edit, date, copy, reset, save,
    retry: () => { if (!active.current && !latest.current.attempt) setReload((n) => n + 1); },
    changeView: (value) => {
      if (saving.current || latest.current.attempt || latest.current.blocked) return;
      // Invalidate synchronously, before effect cleanup can run: no late search
      // result may be mistaken for the new filter/page.
      seq.current++;
      active.current = true; setBusy(true);
      setView((old) => ({ ...old, ...value }));
    },
    getGuardState: () => ({ busy: active.current, uncertain: Boolean(latest.current.attempt),
      blocked: Boolean(latest.current.attempt),
      dirty: Object.keys(latest.current.draft.edits).length > 0 || latest.current.draft.copyRate !== null
        || Boolean(latest.current.draft.effectiveFrom) }),
  };
}
