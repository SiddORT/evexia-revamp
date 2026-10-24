import { useState } from 'react';
import { loginAdmin } from './adminSession.js';

// Fresh password authentication only: never recover a revoked bearer through a
// newer shared cookie. AdminBoundary binds retained children to their owner ID.
export default function DraftSignIn({ message }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await loginAdmin(identifier, password, false); }
    catch (cause) { setError(cause.message || 'Sign-in failed. Your hidden draft is still in this tab.'); }
    finally { setPassword(''); setBusy(false); }
  }
  return <section className="portal-verification-error">
    <h1>Sign in again to recover this draft</h1>
    <p role="alert">{message || 'Your session ended or this account no longer has workspace access.'}</p>
    <p>Your editor remains hidden in this tab. A fresh sign-in to the same account can recover it if access is restored. Signing in to a different account, reloading or leaving this page discards the retained editor.</p>
    <form onSubmit={submit}>
      <label htmlFor="draft-signin-identifier">Email, employee code or mobile</label>
      <input id="draft-signin-identifier" className="mr-form__control" autoComplete="username" required value={identifier} disabled={busy} onChange={(event) => setIdentifier(event.target.value)} />
      <label htmlFor="draft-signin-password">Password</label>
      <input id="draft-signin-password" className="mr-form__control" type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button className="admin-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in and check access'}</button>
    </form>
  </section>;
}
