import { useState } from 'react';
import { Eye, EyeOff, ArrowLeft, ArrowRight, ShieldAlert } from 'lucide-react';
import BrandMark from '../components/BrandMark.jsx';
import { A, Field, Notice, describe, useDirty, useGuard, useTimers } from './ui.jsx';

export const DEMO_EMAIL = 'doctor@example.invalid';
export const DEMO_PASSWORD = 'demo-only-pass';

function Art() {
  return (
    <svg className="dr-art" viewBox="0 0 360 300" role="img" aria-label="Illustration of a calm allergy-care leaf and pollen motif">
      <circle cx="180" cy="150" r="118" className="dr-art__ring" />
      <circle cx="180" cy="150" r="84" className="dr-art__ring dr-art__ring--b" />
      <path d="M180 252 C176 190 178 140 180 70" className="dr-art__stem" />
      <path d="M180 190 C130 190 108 150 112 118 C150 120 178 146 180 190Z" className="dr-art__leaf" />
      <path d="M180 150 C226 150 252 112 248 80 C210 84 182 108 180 150Z" className="dr-art__leaf dr-art__leaf--b" />
      {[[110, 70], [262, 120], [96, 200], [270, 214], [226, 44], [150, 34]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5 + (i % 3) * 2} className="dr-art__pollen" style={{ animationDelay: `${i * 0.4}s` }} />)}
    </svg>
  );
}

export function Login({ go }) {
  const guard = useGuard();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const later = useTimers();
  useDirty(false);
  function submit(event) {
    event.preventDefault();
    if (busy) return;
    const next = {};
    if (!email.trim()) next.email = 'Enter the fictional demo email shown above.';
    else if (email.trim().toLowerCase() !== DEMO_EMAIL) next.email = `Only ${DEMO_EMAIL} works in this preview.`;
    if (!password) next.password = 'Enter the demo-only password shown above.';
    else if (password !== DEMO_PASSWORD) next.password = 'That is not the demo-only password.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    later(() => go('/doctor/home'), 700);
  }
  return (
    <main className="dr-entry">
      <section className="dr-entry__visual" aria-hidden="false">
        <p className="dr-entry__kicker">Allergy-care workspace preview</p>
        <h2>Quiet tools for careful clinics.</h2>
        <Art />
        <p className="dr-entry__attr">Preview built within the EVEXIA Life Sciences portal.</p>
      </section>
      <section className="dr-entry__panel">
        <BrandMark />
        <h1>IMMUNO PORTAL</h1>
        <Notice><ShieldAlert size={14} aria-hidden="true" /> Demo only. This is not real sign-in. Do not enter real credentials or patient information.</Notice>
        <button type="button" className="admin-button dr-enter" onClick={() => guard.go('/doctor/home')} data-testid="button-enter-demo">Enter demo workspace <ArrowRight size={16} aria-hidden="true" /></button>
        <p className="dr-or"><span>or preview the sign-in form</span></p>
        <dl className="dr-creds"><div><dt>Demo email</dt><dd>{DEMO_EMAIL}</dd></div><div><dt>Demo password</dt><dd>{DEMO_PASSWORD}</dd></div></dl>
        <form onSubmit={submit} noValidate className="dr-form">
          <Field id="dr-email" label="Email" error={errors.email}>
            <input id="dr-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={describe('dr-email', errors.email)} />
          </Field>
          <Field id="dr-password" label="Password" error={errors.password}>
            <span className="dr-pass">
              <input id="dr-password" type={show ? 'text' : 'password'} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} aria-describedby={describe('dr-password', errors.password)} />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </span>
          </Field>
          <button type="submit" className="admin-button admin-button--secondary" disabled={busy} aria-busy={busy}>{busy ? 'Opening demo...' : 'Continue to demo'}</button>
          <p className="dr-fine">Continuing opens the fictional workspace. It is demo entry, not verified authentication, and nothing is stored.</p>
        </form>
        <A to="/doctor/forgot-password" className="dr-link">Forgot password?</A>
      </section>
    </main>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  useDirty(email.trim() !== '' && !done);
  function submit(event) {
    event.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@example\.invalid$/.test(v)) { setError('Use a fictional address ending in @example.invalid.'); return; }
    setError(''); setDone(true);
  }
  return (
    <main className="dr-entry dr-entry--single">
      <section className="dr-entry__panel">
        <BrandMark />
        <h1>Forgot password</h1>
        <Notice>Demo only. No email is sent and no password is changed.</Notice>
        {done ? (
          <div className="dr-ack" role="status" data-testid="forgot-ack">
            <strong>Acknowledged in this preview</strong>
            <p>For {email.trim()}: no email was sent and no password was changed. There is no real account to recover.</p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="dr-form">
            <Field id="dr-forgot" label="Fictional email" error={error} hint="Only addresses ending in @example.invalid are accepted.">
              <input id="dr-forgot" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describe('dr-forgot', error, true)} />
            </Field>
            <button type="submit" className="admin-button">Show acknowledgement</button>
          </form>
        )}
        <A to="/doctor" className="dr-link"><ArrowLeft size={14} aria-hidden="true" /> Back to login</A>
      </section>
    </main>
  );
}
