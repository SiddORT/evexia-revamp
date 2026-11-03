import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { FilePlus2, UserPlus, Wallet } from 'lucide-react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { interceptNavigation } from '../auth/navigationGuard.js';
import { changeMrPassword, logoutAdmin } from '../auth/adminSession.js';
import { mrDisplayIdentity } from '../auth/displayIdentity.js';
import Field from '../components/auth/Field.jsx';
import { DATE_FORMATS, setAdminPreference, useAdminPreferences } from '../components/admin/adminPreferences.js';
import { ADMIN_APPEARANCES, ADMIN_THEMES } from '../components/admin/adminTheme.js';
import { Empty, Head, useDate, useWs } from './common.jsx';
import { useSalesAchievement } from './useSalesAchievement.js';
import { SalesSummary, SalesRules } from './SalesAchievement.jsx';
export { default as Targets } from './SalesAchievement.jsx';

export function Dashboard() {
  const { user } = useAdminSession();
  const { state } = useWs();
  const date = useDate();
  const report = useSalesAchievement();
  const who = user?.display_name || 'there';
  return <>
    <section className="mrw-hero" aria-labelledby="mrw-greet">
      <p className="mrw-eyebrow">{report.data ? `Financial year ${report.data.startYear}–${report.data.startYear + 1}` : 'Current financial year'} · Saved sales achievement</p>
      <h1 id="mrw-greet" tabIndex={-1} data-testid="heading-mr-page">Welcome back, {who}</h1>
      <p>Your current saved target and approved orders, separate from demo Payments and activity.</p>
      <div className="mrw-actions"><Link href="/mr/targets" className="admin-button">View targets and order contributions</Link>
        <button className="admin-button admin-button--secondary" onClick={report.refresh}>Refresh sales</button></div>
    </section>
    <SalesSummary report={report} percentageTestId="text-sales-percentage" />
    <SalesRules />
    <div className="mrw-actions">
      <Link href="/mr/doctors/new" className="admin-button" data-testid="link-shortcut-onboard"><UserPlus size={16} aria-hidden="true" /> Add live Doctor</Link>
      <Link href="/mr/orders" className="admin-button" data-testid="link-shortcut-order"><FilePlus2 size={16} aria-hidden="true" /> Live orders</Link>
      <Link href="/mr/payments/new" className="admin-button" data-testid="link-shortcut-payment"><Wallet size={16} aria-hidden="true" /> Add demo payment</Link>
    </div>
    <div className="mrw-card"><h2>Recent demo activity</h2><p className="mrw-notice">These fictional events do not track live Doctors or saved orders.</p>{state.activity.length === 0 ? <Empty title="No demo activity yet" text="Live Doctors and orders are managed separately and do not update these demo figures." /> :
      <ul className="mrw-list">{state.activity.slice(0, 6).map((a) => <li key={a.id}>{a.href.startsWith('/mr/payments/') ? <Link href={a.href}><span>{a.label}</span><small>{date(a.date)}</small></Link> : <div className="mrw-line"><span>{a.label}</span><small>{date(a.date)}</small></div>}</li>)}</ul>}</div>
  </>;
}

export function Settings() {
  const { user } = useAdminSession();
  const prefs = useAdminPreferences();
  const [, navigate] = useLocation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pref = (k, v) => setAdminPreference(k, v, { recordActivity: false });
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
  async function signOutNow() { await logoutAdmin(); navigate('/mr', { replace: true }); }
  function signOut() { if (!interceptNavigation({ kind: 'run', run: signOutNow })) return signOutNow(); }
  const choice = (key, map) => <div className="mrw-choice" role="group" aria-label={key === 'theme' ? 'Theme' : 'Appearance'}>{Object.entries(map).map(([v, l]) => <button key={v} type="button" aria-pressed={prefs[key] === v} onClick={() => pref(key, v)} data-testid={`button-${key}-${v}`}>{l}</button>)}</div>;
  return <>
    <Head eyebrow="Settings" title="Settings" />
    <div className="mrw-settings-identity"><strong>{mrDisplayIdentity(user).name}</strong><span>{mrDisplayIdentity(user).account}</span></div>
    <div className="mrw-split">
      <div className="mrw-card"><h2>Appearance</h2>
        <div className="mrw-stack">{choice('theme', ADMIN_THEMES)}{choice('appearance', ADMIN_APPEARANCES)}
          <div className="mrw-field"><label htmlFor="mr-date-format">Date format</label><select className="admin-select" id="mr-date-format" value={prefs.dateFormat} onChange={(e) => pref('dateFormat', e.target.value)}>{Object.entries(DATE_FORMATS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <p className="mrw-notice" data-testid="text-pref-persistence">Saved only in this browser, not on your account. These appearance settings are shared with the Admin portal in this browser, so changing them here may change Admin too.</p></div></div>
      <form className="mrw-card auth-form" onSubmit={submit} noValidate data-testid="form-mr-password">
        <h2>Change password</h2>
        <Field id="mr-current" label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <Field id="mr-new" label="New password (12 to 128 characters)" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <Field id="mr-confirm" label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {message && <div className="form-message" role="alert">{message}</div>}
        <button className="submit-button" type="submit" disabled={busy} data-testid="button-change-password">{busy ? 'Saving…' : 'Change password and sign out'}</button>
      </form>
    </div>
    <div><button type="button" className="admin-button admin-button--secondary" onClick={signOut} data-testid="button-settings-signout">Sign out</button></div>
  </>;
}
