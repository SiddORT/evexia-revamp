import { useEffect, useState } from 'react';
import Dialog from './Dialog.jsx';
import { getSession, subscribeSession } from '../../auth/adminSession.js';

// One-time secrets live only in props/state of this mounted dialog. They are
// dropped on close, unmount, logout or identity change. Never stored or downloaded.
export default function CredentialReveal({ credentials, title = 'Copy these credentials now', onClose }) {
  const [copied, setCopied] = useState('');
  const [hidden, setHidden] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => { const s = getSession(); if (s.user?.id !== owner || s.status === 'anonymous') onClose(); });
  }, [onClose]);
  async function copy(text, key) {
    try { await navigator.clipboard.writeText(text); setCopied(key); } catch { setCopied('failed'); }
  }
  const all = credentials.map((c) => `${c.userId}\t${c.password}`).join('\n');
  return <Dialog title={title} eyebrow="Shown once" description="These passwords are not stored in a retrievable form and cannot be shown again. If one is lost, use Reset password on that MR." onClose={() => { if (acknowledged) onClose(); }}
    footer={<>
      <label className="remember"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} data-testid="checkbox-credentials-saved" /> I have copied these credentials</label>
      <button type="button" className="admin-button" disabled={!acknowledged} onClick={onClose} data-testid="button-close-credentials">Close and discard</button>
    </>}>
    <div className="mr-credentials" data-testid="panel-mr-credentials">
      <div className="mr-credentials__actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => setHidden((v) => !v)} data-testid="button-toggle-credentials">{hidden ? 'Reveal passwords' : 'Hide passwords'}</button>
        <button type="button" className="admin-button admin-button--secondary" onClick={() => copy(all, 'all')} data-testid="button-copy-all-credentials">Copy all</button>
        {copied && <span role="status">{copied === 'failed' ? 'Copy was blocked. Reveal and copy manually.' : 'Copied to clipboard.'}</span>}
      </div>
      <ul className="mr-credentials__list">
        {credentials.map((c) => <li key={c.userId}><strong>{c.userId}</strong>
          <code data-testid={`text-credential-${c.userId}`}>{hidden ? '••••••••••••' : c.password}</code>
          <button type="button" className="mr-form__preview-action" onClick={() => copy(c.password, c.userId)}>Copy</button></li>)}
      </ul>
    </div>
  </Dialog>;
}
