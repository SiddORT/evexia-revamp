import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import '../../mrInvoiceTemplate.css';
import {
  INVOICE_FIELDS, FIELD_LABELS, MULTILINE_FIELDS, fieldLimit, blankDetails, sameDetails, validateDetails, fieldErrorsFrom,
  isUncertain, loadInvoiceSettings, saveInvoiceSettings, reconcileInvoiceSave, readQRFile, describeQR,
} from '../../services/serverInvoiceSettings.js';
import InvoiceDetailsHistory from './InvoiceDetailsHistory.jsx';
import InvoiceQRInspectDialog from './InvoiceQRInspectDialog.jsx';

const GROUPS = [
  ['Issuer', 'Shown in the invoice header.', ['company_name', 'address', 'email', 'website', 'customer_care']],
  ['Statutory', 'Authored identifiers. Nothing is verified or assumed.', ['drug_licenses', 'gstin', 'pan']],
  ['Bank and payment', 'Bank name and account holder are separate values.', ['bank_name', 'account_holder', 'account_number', 'branch', 'ifsc', 'payment_on', 'upi_id']],
  ['Legal text', 'Administrator-authored. Not enforced as payment, return, interest or tax policy.', ['declaration', 'terms']],
];
const HINTS = { terms: 'One term per line. Lines are shown as a numbered list in the order written.', email: 'Optional. Example: accounts@example.in', website: 'Optional. Example: www.example.in' };
const KEEP_QR = Object.freeze({ action: 'keep', file: null });
const toDraft = (saved) => ({ ...blankDetails(), ...(saved ? saved.details : {}) });

export default function InvoiceDetailsSettings({ onGuardChange }) {
  const session = useAdminSession();
  const allowed = session?.user?.identity_kind === 'super_admin';
  const owner = session?.user?.id;
  const confirm = usePlatformConfirm();
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [qr, setQr] = useState(KEEP_QR);
  const [qrError, setQrError] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | uncertain | stale | compare
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [notice, setNotice] = useState('');
  const [historyKey, setHistoryKey] = useState(0);
  const [inspect, setInspect] = useState(null);
  const pending = useRef(null); // immutable { requestId, body } while a save outcome is unknown
  const sequence = useRef(0);
  const qrSequence = useRef(0);
  const state = useRef({});
  const dirty = Boolean(draft && saved && (!sameDetails(draft, saved.details) || qr.action !== 'keep'));
  state.current = { busy: busy || qrLoading, dirty, uncertain: phase === 'uncertain' };

  function resetQR() { qrSequence.current++; setQrLoading(false); setQr(KEEP_QR); setQrError(''); }

  async function load(keepDraft = false) {
    if (state.current.busy || pending.current) return;
    state.current.busy = true;
    const seq = ++sequence.current;
    setBusy(true); setLoadError(''); setError(''); setNotice('');
    try {
      const next = await loadInvoiceSettings();
      if (seq !== sequence.current) return;
      setSaved(next);
      if (keepDraft) {
        setPhase('compare');
        setNotice('Current saved details loaded. Your edits are kept below. Compare them with the saved values, then save again or cancel your edits.');
      } else { setDraft(toDraft(next)); resetQR(); setFields({}); setPhase('idle'); }
    } catch (cause) {
      if (seq === sequence.current) setLoadError(cause?.message || 'Saved Invoice Details could not be loaded.');
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }

  useEffect(() => {
    state.current.busy = false; pending.current = null;
    setSaved(null); setDraft(null); resetQR(); setInspect(null); setFields({}); setError(''); setNotice(''); setLoadError(''); setPhase('idle');
    if (allowed) load();
    return () => { sequence.current++; qrSequence.current++; };
  }, [allowed, owner]);

  useEffect(() => {
    onGuardChange?.(async () => {
      if (state.current.busy) return false;
      if (state.current.uncertain || pending.current) {
        setError('A save outcome is still unknown. Check the save outcome before leaving Invoice Details.');
        return false;
      }
      const ok = !state.current.dirty || await confirm('Discard unsaved Invoice Details changes?');
      return ok && !state.current.busy && !state.current.uncertain;
    });
    return () => onGuardChange?.(null);
  }, [onGuardChange, confirm]);

  function edit(field, value) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setFields((previous) => ({ ...previous, [field]: '' }));
    setNotice('');
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || state.current.busy || pending.current) return;
    const seq = ++qrSequence.current;
    state.current.busy = true; setQrLoading(true);
    setQrError(''); setFields((previous) => ({ ...previous, qr: '' }));
    try {
      const image = await readQRFile(file);
      if (seq === qrSequence.current) setQr({ action: 'replace', file: image });
    } catch (cause) {
      if (seq === qrSequence.current) setQrError(cause?.message || 'This image could not be used.');
    } finally {
      if (seq === qrSequence.current) { state.current.busy = false; setQrLoading(false); }
    }
  }

  async function save(event) {
    event.preventDefault();
    if (state.current.busy || pending.current || !saved || !dirty || phase === 'uncertain' || phase === 'stale') return;
    const invalid = validateDetails(draft);
    setFields(invalid); setError(''); setNotice('');
    if (Object.keys(invalid).length) { setError('Check the highlighted fields. Nothing was sent.'); return; }
    const body = Object.freeze({
      expected_version: saved.version, request_id: crypto.randomUUID(),
      details: Object.freeze({ ...draft }), qr_action: qr.action,
      qr_data: qr.action === 'replace' ? Object.freeze({ content_type: qr.file.content_type, base64: qr.file.base64 }) : null,
    });
    pending.current = Object.freeze({ requestId: body.request_id, body });
    state.current.busy = true; setBusy(true);
    const seq = ++sequence.current;
    try {
      const next = await saveInvoiceSettings(body);
      if (seq !== sequence.current) return;
      pending.current = null;
      setSaved(next); setDraft(toDraft(next)); resetQR(); setPhase('idle');
      setNotice(next.version === saved.version ? 'No changes were needed; the saved version is unchanged.' : `Invoice Details saved as version ${next.version}.`);
      setHistoryKey((key) => key + 1);
    } catch (cause) {
      if (seq !== sequence.current) return;
      if (cause?.status === 409) {
        pending.current = null; setPhase('stale');
        setError('These details were changed elsewhere. Your edits are kept. Load the current saved details to compare before saving again.');
      } else if (cause?.status === 422) {
        pending.current = null;
        const mapped = fieldErrorsFrom(cause);
        setFields(mapped);
        setError(Object.keys(mapped).length ? 'Some fields were not accepted. Check the highlighted fields.' : 'The details were not accepted. Check the values and try again.');
      } else if (isUncertain(cause)) {
        setPhase('uncertain');
        setError('The save outcome is unknown. Your edits are kept and nothing will be resent automatically. Check the save outcome before continuing.');
      } else {
        pending.current = null;
        setError(cause?.message || 'Invoice Details could not be saved. Your edits are kept.');
      }
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }

  async function reconcile() {
    const request = pending.current;
    if (!request || state.current.busy) return;
    state.current.busy = true; setBusy(true); setError(''); setNotice('');
    const seq = ++sequence.current;
    try {
      const result = await reconcileInvoiceSave(request.requestId);
      if (seq !== sequence.current) return;
      pending.current = null;
      setSaved(result.saved);
      if (result.outcome === 'committed') {
        setHistoryKey((key) => key + 1);
        const own = result.committed_version;
        // Only clear the retained draft when our own commit is still the current version.
        // QR bytes are re-encoded server-side, so digests are not compared to the selection.
        if (own !== null && own === result.saved.version && sameDetails(draft, result.saved.details)) {
          setDraft(toDraft(result.saved)); resetQR(); setPhase('idle');
          setNotice(`The earlier save was committed as version ${own}.`);
          return;
        }
        setNotice(own !== null && own !== result.saved.version
          ? `The earlier save was committed as version ${own}. Another save has since made version ${result.saved.version} current. Your edits are kept; compare below, then save again or cancel your edits.`
          : `The earlier save was committed${own !== null ? ` as version ${own}` : ''}. The current saved values (version ${result.saved.version}) differ from your edits. Compare below, then save again or cancel your edits.`);
      } else {
        setNotice('The earlier save was cancelled and not applied. Your edits are kept. Compare with the current saved details, then save again if you still want them.');
      }
      setPhase('compare');
    } catch (cause) {
      if (seq !== sequence.current) return;
      setError(`${cause?.message || 'The save outcome could not be checked.'} Your edits are kept; check the outcome again.`);
    } finally {
      if (seq === sequence.current) { state.current.busy = false; setBusy(false); }
    }
  }

  async function cancelEdits() {
    if (state.current.busy) return;
    if (pending.current) { setError('Check the save outcome first. Cancelling now could hide an unresolved save.'); return; }
    if (dirty && !await confirm('Discard unsaved Invoice Details changes?')) return;
    if (state.current.busy || pending.current) return;
    setDraft(toDraft(saved)); resetQR(); setFields({}); setError(''); setPhase('idle'); setNotice('Unsaved edits cancelled.');
  }

  if (!allowed) {
    return <section className="admin-panel admin-settings__section"><h2>Invoice Details</h2>
      <p role="alert">Only the protected Super Admin can view or manage Invoice Details and their change history.</p></section>;
  }

  const locked = phase === 'uncertain' || phase === 'stale';
  const changedFields = draft && saved ? INVOICE_FIELDS.filter((field) => draft[field] !== saved.details[field]) : [];

  return <div className="invd">
    <section className="admin-panel admin-settings__section" aria-busy={busy || qrLoading}>
      <h2>Invoice Details</h2>
      <p>Shared across sessions and devices. These saved details supply the issuer, license, bank, payment and legal sections of MR invoice template samples. Every field is optional; blank fields stay blank on samples. Nothing is prefilled.</p>
      {busy && <p role="status">{pending.current ? 'Saving or checking the save outcome…' : 'Loading shared Invoice Details…'}</p>}
      {qrLoading && <p role="status">Validating the selected QR image…</p>}
      {loadError && <div className="admin-feedback admin-feedback--error" role="alert">{loadError}
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-retry-invoice-details" disabled={busy} onClick={() => load(Boolean(draft))}>Retry loading</button></div>}
      {error && <p className="admin-feedback admin-feedback--error" role="alert" data-testid="status-invoice-error">{error}</p>}
      {notice && <p className="admin-feedback" role="status" data-testid="status-invoice-notice">{notice}</p>}
      {!saved && busy && <div className="invd-skeleton" aria-hidden="true" />}
      {saved && <div className="invd-saved" data-testid="text-invoice-saved-version">
        <strong>Last loaded saved details · Version {saved.version}</strong>
        <p>{saved.configured ? `Saved ${saved.updated_at ? new Date(saved.updated_at).toLocaleString() : ''}. QR: ${describeQR(saved.qr)}.` : 'Not configured yet. No company, legal, bank or payment information has been assumed.'}</p>
      </div>}

      {phase === 'uncertain' && <div className="admin-feedback admin-feedback--error" role="alert">
        <p>Request {pending.current?.requestId.slice(0, 8)}… is unresolved. Checking asks the server whether it was applied and cancels it if it never arrived. It is never resent.</p>
        <button type="button" className="admin-button" data-testid="button-reconcile-invoice" disabled={busy} onClick={reconcile}>Check save outcome</button>
      </div>}
      {phase === 'stale' && <div className="admin-feedback admin-feedback--error" role="alert">
        <button type="button" className="admin-button" data-testid="button-load-compare" disabled={busy} onClick={() => load(true)}>Load current saved details to compare</button>
      </div>}
      {phase === 'compare' && saved && draft && <div className="invd-saved">
        <strong>Saved version {saved.version} compared with your edits</strong>
        {changedFields.length === 0 && qr.action === 'keep' ? <p>Your edits match the saved details.</p> : <div className="invd-scroll" tabIndex={0} role="region" aria-label="Saved Invoice Details compared with your edits"><table className="invd-compare">
          <thead><tr><th scope="col">Field</th><th scope="col">Saved</th><th scope="col">Your edit</th></tr></thead>
          <tbody>
            {changedFields.map((field) => <tr key={field}><th scope="row">{FIELD_LABELS[field]}</th>
              <td>{saved.details[field] || <span className="invd-blank">(blank)</span>}</td><td>{draft[field] || <span className="invd-blank">(blank)</span>}</td></tr>)}
            {qr.action !== 'keep' && <tr><th scope="row">{FIELD_LABELS.qr}</th><td>{describeQR(saved.qr)}</td><td>{qr.action === 'remove' ? 'Remove QR' : 'Replace with selected image'}</td></tr>}
          </tbody></table></div>}
      </div>}
    </section>

    <form onSubmit={save} noValidate className="admin-panel admin-settings__section">
      {!draft && !busy && <p>No saved details have been loaded. Retry loading to enable editing.</p>}
      <fieldset disabled={busy || qrLoading || !draft || locked} className="invd-groups" style={{ border: 0, padding: 0, margin: 0 }}>
        {GROUPS.map(([title, help, keys]) => <fieldset key={title} className="invd-group">
          <legend>{title}</legend>
          <p>{help}</p>
          <div className="invd-grid">{keys.map((key) => {
            const multi = MULTILINE_FIELDS.includes(key);
            const Tag = multi ? 'textarea' : 'input';
            const value = draft?.[key] ?? '';
            const describedBy = [HINTS[key] && `invd-${key}-hint`, `invd-${key}-count`, fields[key] && `invd-${key}-error`].filter(Boolean).join(' ');
            return <div key={key} className={`invd-field${multi ? ' invd-field--wide' : ''}`}>
              <label htmlFor={`invd-${key}`}>{FIELD_LABELS[key]}</label>
              <Tag id={`invd-${key}`} className="admin-input" value={value} maxLength={fieldLimit(key)} rows={multi ? (key === 'terms' ? 8 : 3) : undefined}
                type={multi ? undefined : key === 'email' ? 'email' : 'text'} autoComplete="off" spellCheck={multi}
                aria-invalid={Boolean(fields[key])} aria-describedby={describedBy} data-testid={`input-invoice-${key}`}
                onChange={(event) => edit(key, multi ? event.target.value : event.target.value.replace(/[\r\n]/g, ''))} />
              {HINTS[key] && <small id={`invd-${key}-hint`}>{HINTS[key]}</small>}
              <small id={`invd-${key}-count`} className="invd-count">{value.length.toLocaleString()} / {fieldLimit(key).toLocaleString()}</small>
              {fields[key] && <span id={`invd-${key}-error`} className="admin-feedback--error">{fields[key]}</span>}
            </div>;
          })}</div>
        </fieldset>)}

        <fieldset className="invd-group">
          <legend>Payment QR image</legend>
          <p id="invd-qr-help">Optional PNG or JPEG, up to 512 KiB and 32 to 2048 pixels per side. Stored privately with this configuration version. Template samples never show it.</p>
          <div className="invd-qr">
            <div>
              <p>Saved: {describeQR(saved?.qr)}</p>
              {saved?.qr && <button type="button" className="admin-button admin-button--secondary" data-testid="button-inspect-saved-qr" onClick={() => setInspect(saved.qr.version)}>Inspect saved QR</button>}
            </div>
            {qr.action === 'replace' && <figure style={{ margin: 0 }}>
              <img src={qr.file.dataUrl} alt="Selected replacement QR image" data-testid="img-selected-qr" />
              <figcaption>{qr.file.width} × {qr.file.height} px · {(qr.file.size / 1024).toFixed(1)} KiB · not saved yet</figcaption>
            </figure>}
            {qr.action === 'remove' && <p data-testid="text-qr-remove">The saved QR will be removed when you save. History keeps the old image as evidence.</p>}
          </div>
          <div className="invd-actions" style={{ marginTop: 10 }}>
            <label className="admin-button admin-button--secondary invd-file-choice">
              {saved?.qr || qr.action === 'replace' ? 'Choose replacement image' : 'Choose QR image'}
              <input type="file" accept="image/png,image/jpeg" className="sr-only" aria-describedby="invd-qr-help" data-testid="input-invoice-qr" onChange={chooseFile} />
            </label>
            {saved?.qr && qr.action !== 'remove' && <button type="button" className="admin-button admin-button--secondary" data-testid="button-remove-qr" onClick={() => { setQr({ action: 'remove', file: null }); setQrError(''); }}>Remove saved QR</button>}
            {qr.action !== 'keep' && <button type="button" className="admin-button admin-button--secondary" data-testid="button-undo-qr" onClick={resetQR}>Undo QR change</button>}
          </div>
          {(qrError || fields.qr) && <p className="admin-feedback admin-feedback--error" role="alert">{qrError || fields.qr}</p>}
        </fieldset>
      </fieldset>

      <div className="invd-actions" style={{ marginTop: 16 }}>
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-reload-invoice-details"
          disabled={busy || qrLoading || phase === 'uncertain'} onClick={() => load(dirty)}>{dirty ? 'Load saved details to compare' : 'Reload saved details'}</button>
        <button type="button" className="admin-button admin-button--secondary" data-testid="button-cancel-invoice-details"
          disabled={busy || qrLoading || !saved || (!dirty && phase === 'idle')} onClick={cancelEdits}>Cancel edits</button>
        <button type="submit" className="admin-button" data-testid="button-save-invoice-details" disabled={busy || qrLoading || !dirty || locked}>
          {phase === 'compare' ? 'Save my edits as new version' : 'Save Invoice Details'}</button>
      </div>
    </form>

    <InvoiceDetailsHistory refreshKey={historyKey} owner={owner} />
    {inspect && <InvoiceQRInspectDialog version={inspect} onClose={() => setInspect(null)} />}
  </div>;
}
