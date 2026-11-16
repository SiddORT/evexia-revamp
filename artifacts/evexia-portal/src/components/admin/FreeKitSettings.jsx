import { useEffect, useRef, useState } from 'react';
import { request } from '../../services/serverKits.js';
import { getSession } from '../../auth/adminSession.js';
import { setNavigationGuard } from '../../auth/navigationGuard.js';

const blank = { mrCap: '', mrPeriod: 'financial_year', doctorCap: '', doctorPeriod: 'month' };
function checked(value) {
  const valid = Number.isSafeInteger(value?.version) && value.version >= 0
    && value.configured === (value.version > 0) && (!value.configured || ['mr', 'doctor'].every((key) =>
      Number.isSafeInteger(value.caps?.[`${key}Cap`]) && value.caps[`${key}Cap`] >= 0
      && ['financial_year', 'month'].includes(value.caps?.[`${key}Period`])));
  if (!valid) { const cause = new Error('The saved settings response could not be confirmed. Keep your entries and retry unchanged.'); cause.ambiguous = true; throw cause; }
  return value;
}

export default function FreeKitSettings() {
  const [saved, setSaved] = useState(null), [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef(null), sending = useRef(false);
  const owner = useRef(getSession().user?.id).current;
  useEffect(() => {
    const controller = new AbortController();
    request('/free-kit-settings', { signal: controller.signal }).then(checked).then((value) => {
      setSaved(value);
      if (value.caps) setDraft(Object.fromEntries(Object.entries(value.caps).map(([key, v]) => [key, String(v)])));
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!busy && !uncertain) return undefined;
    const leave = setNavigationGuard(() => { setError('Keep Settings open and retry the unchanged save to confirm its outcome.'); return true; });
    const unload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => { leave(); window.removeEventListener('beforeunload', unload); };
  }, [busy, uncertain]);
  async function load() {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { setSaved(checked(await request('/free-kit-settings'))); setNotice('Loaded saved settings below; your draft is unchanged. Compare before saving.'); }
    catch (cause) { setError(cause.message); }
    finally { sending.current = false; setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    if (sending.current || !saved) return;
    if (!owner || getSession().user?.id !== owner) { setError('The signed-in account changed. Return with the original account.'); return; }
    if (!pending.current && !['mrCap', 'doctorCap'].every((key) => /^(0|[1-9]\d*)$/.test(draft[key])
      && Number(draft[key]) <= 2147483647)) { setError('Enter both caps as nonnegative whole order counts. Zero permits no free orders.'); return; }
    pending.current ||= { ...draft, mrCap: Number(draft.mrCap), doctorCap: Number(draft.doctorCap),
      expected_version: saved.version, idempotencyKey: crypto.randomUUID() };
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const value = checked(await request('/free-kit-settings', { body: pending.current }));
      if (value.confirmedRequest !== pending.current.idempotencyKey) { const cause = new Error('The settings save could not be confirmed. Retry unchanged.'); cause.ambiguous = true; throw cause; }
      setSaved(value); pending.current = null; setUncertain(false); setNotice('Free kit limits saved. Existing marks and consumed slots are unchanged.');
    } catch (cause) {
      const unknown = Boolean(cause.ambiguous) || !cause.status || cause.status >= 500;
      setUncertain(unknown); setError(cause.message);
      if (!unknown) pending.current = null;
    } finally { sending.current = false; setBusy(false); }
  }
  return <section className="admin-panel admin-settings__section" aria-labelledby="free-kit-settings-heading">
    <h2 id="free-kit-settings-heading">Free KIT Order Limits</h2>
    <p>Shared protected settings. Both independent caps must allow another order. Zero allows none; blank is not unlimited.
      Counts use saved order identities and dates in Asia/Kolkata. Financial years run April–March; months are calendar months.</p>
    {saved && <p role="status">{saved.configured
      ? `Saved revision ${saved.version}: Per MR ${saved.caps.mrCap} / ${saved.caps.mrPeriod === 'month' ? 'Month' : 'Financial year'}; Per Doctor ${saved.caps.doctorCap} / ${saved.caps.doctorPeriod === 'month' ? 'Month' : 'Financial year'}.`
      : 'Not configured. Free marking is blocked until both caps and periods are explicitly saved.'}</p>}
    <form onSubmit={save}>
      <fieldset disabled={busy || uncertain || !saved}><legend>Independent order-count caps</legend>
        <div className="admin-settings__grid">{[['mr', 'Per MR'], ['doctor', 'Per Doctor']].map(([key, label]) => <div key={key}>
          <label htmlFor={`free-${key}-cap`}>{label}</label>
          <input id={`free-${key}-cap`} type="text" inputMode="numeric" required value={draft[`${key}Cap`]}
            onChange={(event) => setDraft((v) => ({ ...v, [`${key}Cap`]: event.target.value }))} />
          <label htmlFor={`free-${key}-period`}>{label} counting period</label>
          <select id={`free-${key}-period`} value={draft[`${key}Period`]}
            onChange={(event) => setDraft((v) => ({ ...v, [`${key}Period`]: event.target.value }))}>
            <option value="financial_year">Financial year</option><option value="month">Month</option>
          </select>
        </div>)}</div>
      </fieldset>
      <p>Every permanent mark consumes one slot in each applicable period, even after rejection. Lowering a cap never rewrites history or refunds slots.</p>
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <button type="button" className="admin-button admin-button--secondary" disabled={busy || uncertain} onClick={load}>Load saved for comparison</button>
      <button type="submit" className="admin-button" disabled={busy || !saved}>{busy ? 'Saving…' : uncertain ? 'Retry unchanged save' : 'Save free-kit limits'}</button>
    </form>
  </section>;
}
