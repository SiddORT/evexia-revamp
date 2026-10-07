import { useState } from 'react';
import { useLocation } from 'wouter';
import MRBoundary from '../auth/MRBoundary.jsx';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { changeMrPassword, logoutAdmin } from '../auth/adminSession.js';
import BrandMark from '../components/BrandMark.jsx';
import Field from '../components/auth/Field.jsx';
import '../mr.css';

function Home() {
  const { user } = useAdminSession();
  const [, navigate] = useLocation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (next.length < 12 || next.length > 128) { setMessage('Use a new password of 12 to 128 characters.'); return; }
    if (next !== confirm) { setMessage('New passwords do not match.'); return; }
    setBusy(true); setMessage('');
    try {
      await changeMrPassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      await logoutAdmin();
      navigate('/mr', { replace: true });
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); setCurrent(''); setNext(''); setConfirm(''); }
  }
  async function signOut() { await logoutAdmin(); navigate('/mr', { replace: true }); }
  return <main className="mr-home" data-testid="page-mr-home">
    <BrandMark />
    <h1>MR workspace</h1>
    <p data-testid="text-mr-account">Signed in as <strong>{user?.username || user?.email}</strong></p>
    <form className="auth-form" onSubmit={submit} noValidate data-testid="form-mr-password">
      <h2>Change password</h2>
      <Field id="mr-current" label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      <Field id="mr-new" label="New password (12 to 128 characters)" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      <Field id="mr-confirm" label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      {message && <div className="form-message" role="alert">{message}</div>}
      <button className="submit-button" type="submit" disabled={busy} data-testid="button-change-password">{busy ? 'Saving…' : 'Change password and sign out'}</button>
    </form>
    <button type="button" className="admin-button admin-button--secondary" onClick={signOut} data-testid="button-mr-signout">Sign out</button>
  </main>;
}
export default function MRHome() { return <MRBoundary><Home /></MRBoundary>; }
