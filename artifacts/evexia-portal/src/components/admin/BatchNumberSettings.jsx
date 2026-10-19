import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { loadPRBatchSettings, savePRBatchSettings } from '../../services/serverPurchaseReceived.js';

const same = (a, b) => a?.mode === b?.mode && a?.prefix === b?.prefix;

export default function BatchNumberSettings({ onGuardChange }) {
  const session = useAdminSession();
  const allowed = session?.user?.identity_kind === 'super_admin';
  const confirm = usePlatformConfirm();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [blocked, setBlocked] = useState(false);
  const state = useRef({});
  const sequence = useRef(0);
  const dirty = Boolean(draft && !same(saved, draft));
  state.current = { busy, dirty };
  const owner = session?.user?.id;

  async function load(keepDraft = false) {
    const seq = ++sequence.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await loadPRBatchSettings();
      if (seq !== sequence.current) return;
      setSaved(next);
      if (!keepDraft) setDraft({ mode: next.mode, prefix: next.prefix });
      setBlocked(false);
      if (keepDraft) setNotice('Saved settings loaded. Your edits are kept; compare and save against this version, or cancel to use saved settings.');
    } catch (cause) { if (seq === sequence.current) setError(cause.message); }
    finally { if (seq === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    setSaved(null); setDraft(null); setBlocked(false);
    if (allowed) load();
    return () => { sequence.current++; };
  }, [allowed, owner]);
  useEffect(() => {
    onGuardChange?.(async () => {
      if (state.current.busy) return false;
      const ok = !state.current.dirty || await confirm('Discard unsaved Batch Number Settings changes?');
      return ok && !state.current.busy;
    });
    return () => onGuardChange?.(null);
  }, [onGuardChange, confirm]);

  async function save(event) {
    event.preventDefault();
    if (busy || blocked || !saved || !dirty) return;
    if (!/^[A-Za-z0-9._-]{0,64}$/.test(draft.prefix)) { setError('Use up to 64 letters, digits, dots, underscores or hyphens for the prefix.'); return; }
    setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      const next = await savePRBatchSettings({ ...draft, expected_version: saved.version });
      if (seq !== sequence.current) return;
      setSaved(next); setDraft({ mode: next.mode, prefix: next.prefix });
      setNotice('Batch Number Settings saved. Existing drafts and saved receipts are unchanged.');
    } catch (cause) {
      if (seq !== sequence.current) return;
      setError(cause.message);
      if (cause.status === 409 || cause.ambiguous || !cause.status || cause.status >= 500) setBlocked(true);
    } finally { if (seq === sequence.current) setBusy(false); }
  }
  if (!allowed) return <section className="admin-panel admin-settings__section"><h2>Batch Number Settings</h2><p role="alert">Only the protected Super Admin can manage batch numbering.</p></section>;
  return <section className="admin-panel admin-settings__section">
    <h2>Batch Number Settings</h2>
    <p className="mr-form__hint">Shared defaults for new Purchase Received rows in all authenticated browsers. Every batch remains editable. PR document numbering is separate.</p>
    {busy && <p role="status">Loading or saving shared batch settings…</p>}
    {error && <div className="admin-feedback admin-feedback--error" role="alert">{error}</div>}
    {notice && <p className="admin-feedback" role="status">{notice}</p>}
    {saved && <p className="mr-form__hint">Loaded server version {saved.version}: {({ manual: 'Manual', system: 'System sequence', product: 'Product-based' })[saved.mode]}{saved.mode === 'system' ? ` · Prefix: ${saved.prefix || '(none)'}` : ''}. The controls below are your editable draft.</p>}
    <form onSubmit={save}>
      <fieldset disabled={busy || !draft} className="batch-settings-fields">
        <legend>Default batch mode</legend>
        {[['manual', 'Manual', 'Enter supplier batches yourself. A batch is required for every received row.'],
          ['system', 'System sequence', 'One shared counter across all products.'],
          ['product', 'Product-based', 'An independent sequence for each stable catalogue product UUID, across POs and PRs.']].map(([value, label, help]) =>
          <label className="batch-settings-choice" key={value}><input type="radio" name="pr-batch-mode" value={value} checked={draft?.mode === value} onChange={() => setDraft((d) => ({ ...d, mode: value }))} /><span><strong>{label}</strong><small>{help}</small></span></label>)}
        {draft?.mode === 'system' && <div className="po-field">
          <label htmlFor="pr-batch-prefix">Prefix (optional)</label>
          <input id="pr-batch-prefix" className="mr-form__control" value={draft.prefix} maxLength={64} onChange={(e) => setDraft((d) => ({ ...d, prefix: e.target.value }))} aria-describedby="pr-batch-prefix-help" />
          <p id="pr-batch-prefix-help" className="mr-form__hint">Up to 64 letters, digits, dots, underscores or hyphens. Include a separator if wanted.</p>
          <p>Format example: <code className="batch-settings-example">{draft.prefix}00000001</code> (not a reservation or the next available number).</p>
        </div>}
        {draft?.mode === 'product' && <p>Format: <code className="batch-settings-example">P-{'<32-character product UUID>'}-00000001</code>. The full UUID code remains stable when a product is renamed.</p>}
      </fieldset>
      <p className="mr-form__hint">Automatic suffixes start at 1 with at least eight digits, growing when needed. Changing mode or prefix never resets a counter. Unused allocations—including removed rows, abandoned drafts and manual overrides—can leave gaps. Numbering is not gapless. Reused supplier batches are allowed.</p>
      {blocked && <p role="alert">Load saved settings before saving again. Your edits will be kept for comparison.</p>}
      <div className="po-actions batch-settings-actions">
        <button type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={() => load(Boolean(draft))}>Load saved settings</button>
        <button type="button" className="admin-button admin-button--secondary" disabled={busy || !saved} onClick={() => { setDraft({ mode: saved.mode, prefix: saved.prefix }); setNotice('Unsaved edits cancelled.'); setError(''); }}>Cancel edits</button>
        <button type="submit" className="admin-button" disabled={busy || !dirty || blocked}>Save batch settings</button>
      </div>
    </form>
  </section>;
}
