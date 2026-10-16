import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Menu, X, LayoutDashboard, Users, FlaskConical, Pill, ShoppingCart, CreditCard, UserRound, FileText, MessageSquare, ChevronDown, Info } from 'lucide-react';
import BrandMark from '../components/BrandMark.jsx';
import Dialog from '../components/admin/Dialog.jsx';
import { ADMIN_APPEARANCES, ADMIN_THEMES } from '../components/admin/adminTheme.js';
import { setAdminPreference, useAdminPreferences } from '../components/admin/adminPreferences.js';
import { resetDemo, doctor } from './doctorStore.js';
import { setNavigationGuard } from '../auth/navigationGuard.js';
import '../admin.css';
import { A, GuardContext } from './ui.jsx';
import { Forgot, Login } from './Entry.jsx';
import { Dashboard, DoseDetail, DoseForm, Doses, PatientDetail, PatientForm, Patients, TestDetail, TestForm, Tests } from './Care.jsx';
import { MyMR, OrderDetail, OrderForm, Orders, Payments } from './Commerce.jsx';
import { Feedback, Reports } from './Insight.jsx';
import './doctor.css';

const NAV = [
  ['Overview', [['Dashboard', '/doctor/home', LayoutDashboard]]],
  ['Care', [['Patients', '/doctor/patients', Users], ['Allergy Tests', '/doctor/tests', FlaskConical], ['Dosage & Reminders', '/doctor/doses', Pill]]],
  ['Commerce', [['Orders', '/doctor/orders', ShoppingCart], ['Payments', '/doctor/payments', CreditCard], ['My MR', '/doctor/mr', UserRound]]],
  ['Insight', [['Reports', '/doctor/reports', FileText], ['Feedback', '/doctor/feedback', MessageSquare]]],
];
const flat = NAV.flatMap(([, items]) => items);

function resolve(path) {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean).slice(1);
  const [a, b] = parts;
  const section = a || '';
  const out = { section, id: null, mode: 'list', ok: true };
  if (parts.length > 2) return { ...out, ok: false };
  if (b) { if (b === 'new') out.mode = 'new'; else out.mode = 'detail'; out.id = b; }
  const multi = ['patients', 'tests', 'doses', 'orders'];
  if (!multi.includes(a) && b) out.ok = false;
  if (!['', 'forgot-password', 'home', 'patients', 'tests', 'doses', 'orders', 'payments', 'mr', 'reports', 'feedback'].includes(section)) out.ok = false;
  return out;
}

function Screen({ r, go }) {
  const { section: s, mode, id } = r;
  if (s === 'home') return <Dashboard />;
  if (s === 'patients') return mode === 'new' ? <PatientForm go={go} /> : mode === 'detail' ? <PatientDetail id={id} /> : <Patients />;
  if (s === 'tests') return mode === 'new' ? <TestForm go={go} /> : mode === 'detail' ? <TestDetail id={id} /> : <Tests />;
  if (s === 'doses') return mode === 'new' ? <DoseForm go={go} /> : mode === 'detail' ? <DoseDetail id={id} /> : <Doses />;
  if (s === 'orders') return mode === 'new' ? <OrderForm go={go} /> : mode === 'detail' ? <OrderDetail id={id} /> : <Orders />;
  if (s === 'payments') return <Payments />;
  if (s === 'mr') return <MyMR />;
  if (s === 'reports') return <Reports />;
  return <Feedback />;
}

function Profile({ prefs, onExit }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const set = (k, v) => setAdminPreference(k, v, { recordActivity: false });
  return (
    <div className="admin-profile dr-profile" ref={ref}>
      <button type="button" className="admin-profile__trigger" aria-label="Doctor profile and appearance" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <span className="admin-profile__avatar" aria-hidden="true">MS</span><span className="admin-profile__name dr-hide-sm">{doctor.name}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && <div className="admin-dropdown__menu admin-profile__menu dr-menu" data-admin-theme={prefs.theme} data-admin-appearance={prefs.appearance}>
        <div className="admin-profile__identity"><strong>{doctor.name}</strong><span>{doctor.clinic}</span><span>{doctor.specialty}</span></div>
        <div className="admin-dropdown__separator" />
        <fieldset className="dr-pref"><legend>Theme</legend>{Object.entries(ADMIN_THEMES).map(([k, l]) => <label key={k}><input type="radio" name="dr-theme" checked={prefs.theme === k} onChange={() => set('theme', k)} /> {typeof l === 'string' ? l : l.label || k}</label>)}</fieldset>
        <fieldset className="dr-pref"><legend>Appearance</legend>{Object.entries(ADMIN_APPEARANCES).map(([k, l]) => <label key={k}><input type="radio" name="dr-app" checked={prefs.appearance === k} onChange={() => set('appearance', k)} /> {l}</label>)}</fieldset>
        <p className="dr-fine">Appearance is saved in this browser and shared with other EVEXIA portal screens here. Nothing else is stored.</p>
        <div className="admin-dropdown__separator" />
        <button type="button" className="admin-dropdown__item admin-dropdown__item--danger" onClick={() => { setOpen(false); onExit(); }}>Exit demo</button>
      </div>}
    </div>
  );
}

export default function DoctorPortal() {
  const [path, setLoc] = useLocation();
  const prefs = useAdminPreferences();
  const dirtyRef = useRef(false);
  const nativeConfirmRef = useRef(false);
  const [pending, setPending] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  const navRef = useRef(null);
  const menuRef = useRef(null);
  const locRef = useRef(setLoc);
  locRef.current = setLoc;
  const guard = useMemo(() => ({
    dirtyRef,
    nativeConfirmRef,
    go(to, force) {
      if (!force && dirtyRef.current) {
        if (!nativeConfirmRef.current) { setPending({ to }); return; }
        if (!window.confirm('Discard this unsaved demo payment draft?')) return;
      }
      dirtyRef.current = false; locRef.current(to);
    },
    run(action) {
      if (dirtyRef.current) {
        if (!nativeConfirmRef.current) { setPending({ action }); return; }
        if (!window.confirm('Discard this unsaved demo payment draft?')) return;
        dirtyRef.current = false;
      }
      action();
    },
  }), []);
  const go = (to) => guard.go(to, true);

  useEffect(() => {
    const before = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    // The shared navigation infrastructure installs its history listener before
    // Wouter. It contains no authentication or business data.
    const release = setNavigationGuard((request) => {
      if (!dirtyRef.current) return false;
      // A payment already lives in a dialog. Use native confirmation rather
      // than stack two modal focus traps or discard its entered amount.
      if (nativeConfirmRef.current) {
        if (!window.confirm('Discard this unsaved demo payment draft?')) return true;
        dirtyRef.current = false; return false;
      }
      setPending({ request }); return true;
    });
    window.addEventListener('beforeunload', before);
    return () => { release(); window.removeEventListener('beforeunload', before); };
  }, [path]);

  useEffect(() => {
    setNavOpen(false);
    window.scrollTo?.(0, 0);
    document.getElementById('dr-main')?.focus({ preventScroll: true });
    document.title = 'IMMUNO PORTAL · EVEXIA demo';
  }, [path]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const change = () => { setCompact(media.matches); setNavOpen(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!navOpen || !compact) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    navRef.current?.querySelector('button')?.focus();
    const key = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault(); setNavOpen(false);
        // The trigger's workspace is inert until React commits the close.
        requestAnimationFrame(() => menuRef.current?.focus());
      }
      if (event.key === 'Tab') {
        const controls = [...navRef.current.querySelectorAll('button,a[href]')].filter((node) => node.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', key); };
  }, [navOpen, compact]);

  const r = resolve(path);
  const exit = () => guard.run(() => { resetDemo(); guard.go('/doctor', true); });
  const isEntry = r.section === '' || r.section === 'forgot-password';
  const current = flat.find(([, to]) => path.startsWith(to));
  const wrap = (children) => (
    <GuardContext.Provider value={guard}>
      <div className="admin-shell dr-root" data-admin-theme={prefs.theme} data-admin-appearance={prefs.appearance}>
        {children}
        {pending && <Dialog eyebrow="Unsaved changes" title="Discard this draft?" description="You have entered information that has not been saved. Leaving will discard it." onClose={() => setPending(null)}
          footer={<><button type="button" className="admin-button admin-button--secondary" onClick={() => setPending(null)}>Keep editing</button>
            <button type="button" className="admin-button admin-button--danger" onClick={() => {
              const next = pending; setPending(null); dirtyRef.current = false;
              if (next.action) next.action();
              else if (next.request?.kind === 'raw') {
                window.history.pushState(null, '', next.request.href);
                window.dispatchEvent(new PopStateEvent('popstate'));
              } else if (next.request?.kind === 'run') next.request.run();
              else setLoc(next.to || next.request?.href);
            }}>Discard and leave</button></>}><span /></Dialog>}
      </div>
    </GuardContext.Provider>
  );

  if (isEntry && r.ok) return wrap(r.section === '' ? <Login go={go} /> : <Forgot />);

  return wrap(
    <div className="dr-app">
      <a href="#dr-main" className="dr-skip">Skip to content</a>
      <aside ref={navRef} className={`dr-sidebar dr-noprint${navOpen ? ' is-open' : ''}`} id="dr-nav" aria-label="Doctor navigation panel" role={compact && navOpen ? 'dialog' : undefined} aria-modal={compact && navOpen ? true : undefined} inert={compact && !navOpen ? true : undefined}>
        <div className="dr-sidebar__brand"><BrandMark /><button type="button" className="admin-icon-button dr-close" aria-label="Close navigation" onClick={() => { setNavOpen(false); requestAnimationFrame(() => menuRef.current?.focus()); }}><X size={18} /></button></div>
        <p className="dr-sidebar__title">IMMUNO PORTAL</p>
        <nav aria-label="Doctor navigation" className="admin-nav">
          {NAV.map(([group, items]) => <div className="admin-nav__group" key={group}><p className="admin-nav__group-heading">{group}</p>
            {items.map(([label, to, Icon]) => { const active = path.startsWith(to); return <A key={to} to={to} className={`admin-nav__item${active ? ' admin-nav__item--active' : ''}`} aria-current={active ? 'page' : undefined}><Icon size={17} aria-hidden="true" /><span className="admin-nav__label">{label}</span></A>; })}</div>)}
        </nav>
      </aside>
      {navOpen && <div className="dr-scrim dr-noprint" onClick={() => { setNavOpen(false); requestAnimationFrame(() => menuRef.current?.focus()); }} />}
      <div className="admin-workspace" inert={compact && navOpen ? true : undefined}>
        <header className="admin-header dr-chrome dr-noprint">
          <div className="admin-header__left">
            <button ref={menuRef} type="button" className="admin-header__menu dr-menu-btn" aria-label="Open navigation" aria-expanded={navOpen} aria-controls="dr-nav" onClick={() => setNavOpen(true)}><Menu size={20} /></button>
            <span className="admin-header__label dr-hide-sm">IMMUNO PORTAL</span><span className="admin-header__divider dr-hide-sm" />
            <nav aria-label="Breadcrumb" className="admin-header__page">{current ? current[0] : 'Not found'}{r.mode === 'new' ? ' / New' : r.mode === 'detail' ? ' / Record' : ''}</nav>
          </div>
          <div className="admin-header__actions"><Profile prefs={prefs} onExit={exit} /></div>
        </header>
        <main className="admin-content" id="dr-main" tabIndex={-1}>
          <p className="admin-preview-notice dr-notice-bar dr-noprint"><Info size={13} aria-hidden="true" /> Local demo: all names and records are fictional and held in memory. They reset when you reload or exit. Nothing is sent or saved on a server.</p>
          {r.ok ? <Screen key={path} r={r} go={go} /> : (
            <div className="admin-panel"><div className="admin-empty" role="status"><strong>Page not found</strong><p>This demo page does not exist.</p><p><A to="/doctor/home" className="admin-button">Go to dashboard</A></p></div></div>)}
        </main>
      </div>
    </div>
  );
}
