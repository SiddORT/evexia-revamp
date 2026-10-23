import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { LogOut, Menu, Settings as Cog, User, X } from 'lucide-react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { interceptNavigation } from '../auth/navigationGuard.js';
import { logoutAdmin } from '../auth/adminSession.js';
import BrandMark from '../components/BrandMark.jsx';
import { useAdminPreferences } from '../components/admin/adminPreferences.js';
import { createWorkspace } from '../services/mrWorkspaceDemo.js';
import '../admin.css';
import './mrWorkspace.css';
import { Empty, WsContext } from './common.jsx';
import { Dashboard, Settings, Targets } from './Screens.jsx';
import { DoctorDetail, DoctorForm, DoctorImport, DoctorList } from './Doctors.jsx';
import LiveOrders from './LiveOrders.jsx';
import { PaymentDetail, PaymentForm, PaymentList } from './Payments.jsx';

const NAV = [['Dashboard', '/mr/home', 'home'], ['Doctors', '/mr/doctors', 'doctors'], ['Orders', '/mr/orders', 'orders'], ['Targets', '/mr/targets', 'targets'], ['Payments', '/mr/payments', 'payments']];
const dec = (s) => { try { return decodeURIComponent(s); } catch { return ''; } };

function Provider({ owner, children }) {
  const [state, setState] = useState(() => createWorkspace(owner));
  const [flash, setFlashState] = useState(null);
  const [path] = useLocation();
  const ref = useRef(state);
  ref.current = state;
  const apply = useCallback((fn) => {
    try { const next = fn(ref.current); ref.current = next; setState(next); return { ok: true, state: next }; }
    catch (e) { return { ok: false, message: e?.message || 'Could not complete this demo action.' }; }
  }, []);
  const pathRef = useRef(path);
  pathRef.current = path;
  const setFlash = useCallback((text, to) => setFlashState({ text, path: to, born: pathRef.current }), []);
  useEffect(() => { setFlashState((f) => (f && path !== (f.path ?? f.born) ? null : f)); }, [path]);
  const clearFlash = useCallback(() => setFlashState(null), []);
  return <WsContext.Provider value={{ state, apply, flash, setFlash, clearFlash }}>{children}</WsContext.Provider>;
}

function Routes() {
  const [path] = useLocation();
  const seg = path.replace(/\/+$/, '').split('/').slice(2).map(dec);
  const [a, b, c] = seg;
  if (seg.length === 0 || (a === 'home' && !b)) return <Dashboard />;
  if (a === 'doctors') { if (!b) return <DoctorList />; if (b === 'new' && !c) return <DoctorForm />; if (b === 'import' && !c) return <DoctorImport />; if (!c) return <DoctorDetail key={b} id={b} />; }
  if (a === 'orders') return <LiveOrders />;
  if (a === 'targets' && !b) return <Targets />;
  if (a === 'payments') { if (!b) return <PaymentList />; if (b === 'new' && !c) return <PaymentForm />; if (!c) return <PaymentDetail id={b} />; }
  if (a === 'settings' && !b) return <Settings />;
  return <div className="mrw-card"><Empty title="Page not found" text="That MR page does not exist." to="/mr/home" action="Go to dashboard" /></div>;
}

function Shell() {
  const { user } = useAdminSession();
  const { theme, appearance } = useAdminPreferences();
  const [path, navigate] = useLocation();
  const { flash, setFlash } = useContextFlash();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  const btnRef = useRef(null);
  const menuBtnRef = useRef(null);
  const mainRef = useRef(null);
  const first = useRef(true);
  useEffect(() => { if (menu) menuRef.current?.querySelector('[role="menuitem"]')?.focus(); }, [menu]);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); menuBtnRef.current?.focus(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  function menuKeys(e) {
    const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    const to = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault(); items[to].focus();
  }
  useEffect(() => { setOpen(false); setMenu(false); if (first.current) { first.current = false; return; } mainRef.current?.querySelector('h1')?.focus(); }, [path]);
  useEffect(() => {
    if (!menu) return undefined;
    const down = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false); };
    const key = (e) => { if (e.key === 'Escape') { setMenu(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [menu]);
  function signOut() {
    if (interceptNavigation({ kind: 'run', run: signOutNow })) return;
    return signOutNow();
  }
  async function signOutNow() {
    await logoutAdmin();
    navigate('/mr', { replace: true });
  }
  const id = user?.username || user?.email;
  const active = (k) => (k === 'home' ? path === '/mr/home' || path === '/mr' : path.startsWith(`/mr/${k}`));
  return <div className="admin-shell mrw" data-admin-theme={theme} data-admin-appearance={appearance}>
    <header className="mrw-top"><div className="mrw-top__bar">
      <Link href="/mr/home" className="mrw-brand" aria-label="EVEXIA MR dashboard"><BrandMark /></Link>
      <nav id="mrw-nav" className="mrw-nav" data-open={open} aria-label="MR navigation">{NAV.map(([l, h, k]) => <Link key={k} href={h} aria-current={active(k) ? 'page' : undefined} data-testid={`link-nav-${k}`}>{l}</Link>)}</nav>
      <button type="button" ref={menuBtnRef} className="mrw-icon-btn" aria-expanded={open} aria-controls="mrw-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)} data-testid="button-mobile-menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
      <div className="mrw-profile" ref={menuRef}>
        <button type="button" ref={btnRef} className="mrw-avatar" aria-haspopup="menu" aria-expanded={menu} aria-label="Profile menu" onClick={() => setMenu(!menu)} data-testid="button-profile-menu"><User size={20} aria-hidden="true" /></button>
        {menu && <div className="mrw-menu" role="menu" aria-label="Profile" onKeyDown={menuKeys}>
          <div className="mrw-menu__id" data-testid="text-mr-account">Signed in as<strong>{id}</strong></div>
          <Link href="/mr/settings" role="menuitem" data-testid="link-settings"><Cog size={16} aria-hidden="true" /> Settings</Link>
          <button type="button" role="menuitem" onClick={signOut} data-testid="button-mr-signout"><LogOut size={16} aria-hidden="true" /> Logout</button>
        </div>}
      </div>
    </div></header>
    <div className="mrw-demo" data-testid="text-demo-notice">Doctors, Immunotherapy, Kits &amp; Consumables, SPT and Lupin orders: live shared records. Dashboard, Targets and Payments: separate fictional demos that reset on reload; not linked to live Doctors or orders.</div>
    <main className="mrw-main" ref={mainRef} data-testid="page-mr-home">
      {flash && <div className="mrw-flash" role="status" data-testid="text-flash">{flash.text}<button type="button" className="admin-button admin-button--secondary" onClick={() => setFlash(null)}>Dismiss</button></div>}
      <Routes />
    </main>
  </div>;
}

function useContextFlash() {
  const ctx = useContext(WsContext);
  return { flash: ctx.flash, setFlash: () => ctx.clearFlash() };
}

export default function MRWorkspace() {
  const { user } = useAdminSession();
  const owner = String(user?.id ?? user?.username ?? user?.email ?? '');
  return <Provider key={owner} owner={owner}><Shell /></Provider>;
}
