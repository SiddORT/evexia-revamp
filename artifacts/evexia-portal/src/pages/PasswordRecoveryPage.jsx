import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import BrandMark from '../components/BrandMark.jsx';
import Field from '../components/auth/Field.jsx';
import { useAdminPreferences } from '../components/admin/adminPreferences.js';
import { forgetSessionAfterPasswordReset } from '../auth/adminSession.js';
import { recoveryToken, requestRecovery, resetPassword, validateReset } from '../services/passwordRecovery.js';
import '../entryTheme.css';
import '../recovery.css';

function scrubFragment() {
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

export default function PasswordRecoveryPage({ reset = false }) {
  const { theme } = useAdminPreferences();
  const [token, setToken] = useState(() => reset ? recoveryToken(window.location.hash) : '');
  const generation = useRef(0);
  const [kind, setKind] = useState(() =>
    new URLSearchParams(window.location.search).get('portal') === 'mr' ? 'mr' : 'admin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    document.title = `${reset ? 'Reset password' : 'Forgot password'} — EVEXIA`;
    function acceptLink() {
      if (!reset) return;
      const next = recoveryToken(window.location.hash);
      if (!next) {
        if (window.location.hash) {
          generation.current += 1;
          setToken(''); setDone(false); setBusy(false); setMessage(''); setFailed(false);
          setPassword(''); setConfirmation('');
          scrubFragment();
        }
        return;
      }
      generation.current += 1;
      setToken(next); setDone(false); setBusy(false); setMessage(''); setFailed(false);
      setPassword(''); setConfirmation('');
      scrubFragment();
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
    if (error) { setMessage(error); setFailed(true); return; }
    const epoch = generation.current;
    setMessage(''); setFailed(false); setBusy(true);
    try {
      const result = reset ? await resetPassword(token, password)
        : await requestRecovery(identifier, kind);
      if (epoch !== generation.current) return;
      if (reset) {
        setKind(result.identity_kind);
        forgetSessionAfterPasswordReset();
      }
      setMessage(result.message); setFailed(false); setDone(true);
    } catch (error) {
      if (epoch === generation.current) { setMessage(error.message); setFailed(true); }
    }
    finally {
      if (epoch === generation.current) { setPassword(''); setConfirmation(''); setBusy(false); }
    }
  }

  const invalidLink = reset && !token;

  return (
    <main className="auth-page app-shell entry-theme recovery-page" data-admin-theme={theme}>
      <img className="recovery-background"
        src={`${import.meta.env.BASE_URL}images/${kind === 'mr' ? 'mr' : 'admin'}-role.jpg`}
        alt="" aria-hidden="true" />
      <section className="recovery-card" aria-labelledby="recovery-title">
        <BrandMark />
        <h1 id="recovery-title">{reset ? 'Reset password' : 'Forgot password'}</h1>
        <p className="auth-form-wrap__intro">
          {reset ? 'Choose a new password. All existing sessions will be signed out.'
            : 'Enter your current account email or User ID. Staff should use their issued User ID.'}
        </p>
        {!reset && kind === 'admin' && (
          <p className="admin-recovery-callout" style={{ marginTop: -8, marginBottom: 20 }} data-testid="text-super-admin-recovery">
            Super Admin: Contact the tech team to reset your password.
          </p>
        )}
        {invalidLink ? (
          <div className="recovery-alert" role="alert">
            <strong>Link missing or invalid</strong>
            This recovery link is missing or invalid. Request a new link.
          </div>
        ) : !done && (
          <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy} data-testid="form-password-recovery">
            {reset ? <>
              <input type="text" name="username" autoComplete="username" value="" readOnly hidden />
              <Field id="new-password" type="password" label="New password" autoComplete="new-password"
                value={password} onChange={event => setPassword(event.target.value)} />
              <Field id="confirm-password" type="password" label="Confirm new password" autoComplete="new-password"
                value={confirmation} onChange={event => setConfirmation(event.target.value)} />
              <p className="recovery-hint">Use 12 to 128 characters. Longer passphrases are fine.</p>
            </> : <Field id="recovery-identifier" label="Email or User ID" autoComplete="username"
              value={identifier} onChange={event => setIdentifier(event.target.value)} />}
            <button className="submit-button" disabled={busy} type="submit">
              {busy ? 'Please wait…' : reset ? 'Reset password' : 'Send recovery link'}
            </button>
          </form>
        )}
        {message && (failed ? (
          <div className="recovery-alert" role="alert" data-testid="status-recovery-error">
            <strong>We could not complete that</strong>
            {message}
            {!/^Enter |match|characters/i.test(message) && (
              <> If this looks temporary, wait a few minutes and try again.</>
            )}
          </div>
        ) : (
          <div className="recovery-success" role="status" data-testid="status-recovery-success">
            <strong>{reset ? 'Password updated' : 'Request received'}</strong>
            {message}
          </div>
        ))}
        {done && !reset && (
          <p className="recovery-note">
            Request accepted does not mean delivered. If an eligible account matches, we will attempt to send a link. Check spam, and request a new link if nothing arrives.
          </p>
        )}
        <nav className="recovery-links" aria-label="Recovery navigation">
          {done && !reset && <button className="auth-back recovery-retry" type="button"
            onClick={() => { setDone(false); setMessage(''); }}>Request another link</button>}
          {reset && <Link className="auth-back" href={`/forgot-password?portal=${kind}`}>Request a new recovery link</Link>}
          <Link className="auth-back" href={kind === 'mr' ? '/mr' : '/admin/login'}>Back to sign in</Link>
        </nav>
      </section>
    </main>
  );
}
