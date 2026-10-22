import { useEffect, useId, useRef, useState } from 'react';
import { sendEmailTemplateTest } from '../../services/emailTemplates.js';
import './messageTemplates.css';

export default function EmailTemplateTestDialog({ template, onClose, onBusyChange }) {
  const id = useId(), dialog = useRef(null), input = useRef(null), closeButton = useRef(null), lock = useRef(false);
  const alive = useRef(true), busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  const [recipient, setRecipient] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [result, setResult] = useState(null), [blocked, setBlocked] = useState(false);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement, d = dialog.current;
    d.showModal(); input.current?.focus();
    return () => { alive.current = false; d.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (busy) dialog.current?.focus(); }, [busy]);
  useEffect(() => { if (!busy && blocked) closeButton.current?.focus(); }, [busy, blocked]);
  const close = () => { if (!lock.current) onClose(); };
  const submit = async (e) => {
    e.preventDefault();
    if (lock.current || blocked) return;
    if (!recipient || /[\x00-\x20\x7f-\x9f<>,;]/.test(recipient) || !input.current.checkValidity()) {
      setError('Enter one valid email address only.'); input.current.focus(); return;
    }
    lock.current = true; setBusy(true); busyCallback.current(true); setError('');
    try {
      const outcome = await sendEmailTemplateTest(template, recipient);
      if (alive.current) { setResult(outcome); setBlocked(true); }
    } catch (err) {
      if (alive.current) {
        // Transport loss, unreadable responses and session changes cannot prove
        // that SMTP was never reached. Never replay, even after a new login.
        const rejected = [403, 404, 409, 422, 429].includes(err.status);
        setError(rejected ? err.message : 'Test submission outcome is uncertain. Check protected Email Logs before any new explicit send. Nothing will be automatically retried.');
        setBlocked(err.status !== 422);
      }
    } finally {
      lock.current = false;
      if (alive.current) { setBusy(false); busyCallback.current(false); }
    }
  };
  const trap = (e) => {
    if (e.key !== 'Tab') return;
    const targets = [...dialog.current.querySelectorAll('button,input')].filter((el) => !el.disabled);
    if (!targets.length) { e.preventDefault(); dialog.current.focus(); return; }
    if ((e.shiftKey && document.activeElement === targets[0]) || (!e.shiftKey && document.activeElement === targets.at(-1))) {
      e.preventDefault(); (e.shiftKey ? targets.at(-1) : targets[0])?.focus();
    }
  };
  return <dialog ref={dialog} tabIndex={-1} className="mt-test-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}
    onKeyDown={trap} onCancel={(e) => { e.preventDefault(); close(); }}>
    <div className="mt">
      <header className="mt-test-dialog__header">
        <h2 id={`${id}-title`}>Send test email</h2>
        <p className="mt-test-dialog__summary"><strong>{template.name}</strong><span>Saved version {template.version}</span></p>
        <p id={`${id}-help`}>Send this saved version to one recipient. No unsaved draft is included.</p>
      </header>
      <form onSubmit={submit}>
        <label className="mt-field" htmlFor={`${id}-to`}><span>To email address</span>
          <input ref={input} id={`${id}-to`} type="email" required maxLength={320} autoComplete="off" value={recipient}
            disabled={busy || blocked} onChange={(e) => { setRecipient(e.target.value); setError(''); }}
            aria-invalid={!!error} aria-describedby={error ? `${id}-error` : `${id}-recipient-help`} />
          <small id={`${id}-recipient-help`}>Enter one email address only.</small>
        </label>
        <section className="mt-test-dialog__info" aria-labelledby={`${id}-info-title`}>
          <h3 id={`${id}-info-title`}>Transport &amp; test safety</h3>
          <ul>
            <li><strong>Saved SMTP only.</strong> Uses the default Email SMTP configuration in Settings → Communication, including its saved credential and sender, with TLS or STARTTLS. API, Platform, security set to none, or unavailable settings block sending; there is no environment fallback.</li>
            <li><strong>Separate account transport.</strong> Password recovery and invitations retain their separately environment-configured SMTP transport.</li>
            <li><strong>Fictional content.</strong> Server-controlled samples are used, the subject is labelled TEST, and inert action links cannot activate or recover accounts.</li>
            <li><strong>Delivery limitation.</strong> SMTP acceptance does not confirm inbox delivery.</li>
          </ul>
        </section>
        {busy && <div className="mt-test-dialog__outcome mt-test-dialog__outcome--pending" role="status">
          <p>Test attempt pending. Please do not submit again.</p>
        </div>}
        {error && <div id={`${id}-error`} className="mt-test-dialog__outcome mt-test-dialog__outcome--error" role="alert">
          <p>{error}</p>
        </div>}
        {result && <div className={`mt-test-dialog__outcome mt-test-dialog__outcome--${result.status}`} role="status">
          <p>{result.message}</p>
          <dl className="mt-test-dialog__metadata">
            <div><dt>Attempt reference</dt><dd>{result.id}</dd></div>
            <div><dt>Saved version</dt><dd>{template.version}</dd></div>
          </dl>
        </div>}
        <div className="mt-row mt-test-dialog__actions">
          <button type="submit" className="admin-button" disabled={busy || blocked}>{busy ? 'Sending test…' : 'Send saved version'}</button>
          <button ref={closeButton} type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={close}>{result || blocked ? 'Close' : 'Cancel'}</button>
        </div>
      </form>
    </div>
  </dialog>;
}
