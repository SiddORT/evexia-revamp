import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import BrandMark from '../components/BrandMark.jsx';
import Field from '../components/auth/Field.jsx';
import { forgetSessionAfterPasswordReset } from '../auth/adminSession.js';
import { recoveryToken, requestRecovery, resetPassword, validateReset } from '../services/passwordRecovery.js';
import '../entryTheme.css';

export default function PasswordRecoveryPage({ reset = false }) {
  const [token, setToken] = useState(() => reset ? recoveryToken(window.location.hash) : '');
  const generation = useRef(0);
  const [kind, setKind] = useState(() =>
    new URLSearchParams(window.location.search).get('portal') === 'mr' ? 'mr' : 'admin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    document.title = `${reset ? 'Reset password' : 'Forgot password'} — EVEXIA`;
    function acceptLink() {
      if (!reset) return;
      const next = recoveryToken(window.location.hash);
      if (!next) return;
      generation.current += 1;
      setToken(next); setDone(false); setBusy(false); setMessage('');
      setPassword(''); setConfirmation('');
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
    acceptLink();
    window.addEventListener('hashchange', acceptLink);
    window.addEventListener('popstate', acceptLink);
    return () => {
      generation.current += 1;
      window.removeEventListener('hashchange', acceptLink);
      window.removeEventListener('popstate', acceptLink);
    };
  }, [reset]);

  async function submit(event) {
    event.preventDefault();
    if (busy || done) return;
    const error = reset ? validateReset(password, confirmation)
      : !identifier.trim() ? 'Enter your email or User ID.' : '';
    if (error) { setMessage(error); return; }
    const epoch = generation.current;
    setMessage(''); setBusy(true);
    try {
      const result = reset ? await resetPassword(token, password)
        : await requestRecovery(identifier, kind);
      if (epoch !== generation.current) return;
      if (reset) {
        setKind(result.identity_kind);
        forgetSessionAfterPasswordReset();
      }
      setMessage(result.message); setDone(true);
    } catch (error) { if (epoch === generation.current) setMessage(error.message); }
    finally {
      if (epoch === generation.current) { setPassword(''); setConfirmation(''); setBusy(false); }
    }
  }

  return (
    <main className="auth-page app-shell entry-theme" data-admin-theme="light">
      <section className="auth-panel" style={{ width: '100%', minHeight: '100vh' }}>
        <div className="auth-form-wrap">
          <BrandMark />
          <h1>{reset ? 'Reset password' : 'Forgot password'}</h1>
          <p className="auth-form-wrap__intro">
            {reset ? 'Choose a new password. All existing sessions will be signed out.'
              : 'Enter your current account email or User ID. Staff should use their issued User ID.'}
          </p>
          {reset && !token ? (
            <p role="alert">This recovery link is missing or invalid. Request a new link.</p>
          ) : !done && (
            <form className="auth-form" onSubmit={submit} noValidate data-testid="form-password-recovery">
              {reset ? <>
                <input type="text" name="username" autoComplete="username" value="" readOnly hidden />
                <Field id="new-password" type="password" label="New password" autoComplete="new-password"
                  value={password} onChange={event => setPassword(event.target.value)} />
                <Field id="confirm-password" type="password" label="Confirm new password" autoComplete="new-password"
                  value={confirmation} onChange={event => setConfirmation(event.target.value)} />
              </> : <Field id="recovery-identifier" label="Email or User ID" autoComplete="username"
                value={identifier} onChange={event => setIdentifier(event.target.value)} />}
              <button className="submit-button" disabled={busy} type="submit">
                {busy ? 'Please wait…' : reset ? 'Reset password' : 'Send recovery link'}
              </button>
            </form>
          )}
          {message && <p className="form-message" role="status">{message}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, marginTop: 20 }}>
            {reset && <Link className="auth-back" href={`/forgot-password?portal=${kind}`}>Request a new recovery link</Link>}
            <Link className="auth-back" href={kind === 'mr' ? '/mr' : '/admin/login'}>Back to sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
