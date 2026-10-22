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
      <h2 id={`${id}-title`}>Send test email</h2>
      <p id={`${id}-help`}>Send <strong>{template.name}</strong>, saved version <strong>{template.version}</strong>, to one To address using the default Email SMTP configuration saved in Settings → Communication, including its saved credential and sender. No unsaved draft is included.</p>
      <p>The Email default must be SMTP with STARTTLS or TLS. API, Platform, security set to none, or unavailable settings prevent sending; there is no environment fallback. Password recovery and invitations still use the separately environment-configured SMTP transport.</p>
      <p>Server-controlled fictional samples are used. The subject is labelled TEST and action links cannot activate or recover accounts. SMTP acceptance does not confirm inbox delivery.</p>
      <form onSubmit={submit}>
        <label className="mt-field" htmlFor={`${id}-to`}><span>To email address</span>
          <input ref={input} id={`${id}-to`} type="email" required maxLength={320} autoComplete="off" value={recipient}
            disabled={busy || blocked} onChange={(e) => { setRecipient(e.target.value); setError(''); }}
            aria-invalid={!!error} aria-describedby={error ? `${id}-error` : `${id}-help`} /></label>
        {busy && <p role="status">Test attempt pending. Please do not submit again.</p>}
        {error && <p id={`${id}-error`} role="alert">{error}</p>}
        {result && <p role="status">{result.message} Attempt reference: {result.id}. Saved version: {template.version}.</p>}
        <div className="mt-row">
          <button type="submit" className="admin-button" disabled={busy || blocked}>{busy ? 'Sending test…' : 'Send saved version'}</button>
          <button ref={closeButton} type="button" className="admin-button admin-button--secondary" disabled={busy} onClick={close}>{result || blocked ? 'Close' : 'Cancel'}</button>
        </div>
      </form>
    </div>
  </dialog>;
}
