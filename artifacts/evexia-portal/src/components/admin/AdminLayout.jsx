import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Activity, Check, ChevronDown, LayoutDashboard, LayoutGrid, LogOut, MapPinned, Menu, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, X } from 'lucide-react';
import BrandMark from '../BrandMark.jsx';
import { ADMIN_THEMES, readAdminTheme, saveAdminTheme } from './adminTheme.js';
import '../../admin.css';

const SIDEBAR_PREFERENCE_KEY = 'evexia.admin.sidebar.collapsed';

export default function AdminLayout({ title, children }) {
  const [location, navigate] = useLocation();
  const [mastersOpen, setMastersOpen] = useState(location.startsWith('/admin/masters'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === 'true'; }
    catch { return false; }
  });
  const [theme, setTheme] = useState(readAdminTheme);
  const menuRef = useRef(null);
  const sidebarRef = useRef(null);
  const restoreMenuFocusRef = useRef(false);
  const isCollapsed = sidebarCollapsed && !compact;

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(next)); }
    catch { /* The toggle still works if browser storage is unavailable. */ }
  }

  function changeTheme(next) {
    if (!Object.hasOwn(ADMIN_THEMES, next)) return;
    setTheme(next);
    saveAdminTheme(next);
  }

  function closeDrawer(restoreFocus = true) {
    restoreMenuFocusRef.current = restoreFocus;
    setDrawerOpen(false);
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const onChange = () => {
      setCompact(media.matches);
      if (!media.matches) {
        restoreMenuFocusRef.current = false;
        setDrawerOpen(false);
      }
    };
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    restoreMenuFocusRef.current = false;
    setDrawerOpen(false);
    if (location.startsWith('/admin/masters')) setMastersOpen(true);
  }, [location]);

  useEffect(() => {
    if (compact && drawerOpen) {
      sidebarRef.current?.querySelector('[data-testid="link-admin-dashboard"]')?.focus();
    } else if (restoreMenuFocusRef.current) {
      restoreMenuFocusRef.current = false;
      if (compact) menuRef.current?.focus();
    }
  }, [compact, drawerOpen]);

  useEffect(() => {
    if (!compact || !drawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      } else if (event.key === 'Tab') {
        const controls = [...sidebarRef.current.querySelectorAll('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          .filter((element) => element.getClientRects().length > 0);
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !sidebarRef.current.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [compact, drawerOpen]);

  return (
    <div className={`admin-shell${isCollapsed ? ' admin-shell--collapsed' : ''}`} data-admin-theme={theme}>
      {drawerOpen && compact && <button type="button" className="admin-backdrop" aria-label="Close navigation" tabIndex={-1} onClick={() => closeDrawer()} data-testid="button-close-navigation-backdrop" />}
      <aside ref={sidebarRef} id="admin-navigation" className={`admin-sidebar${drawerOpen ? ' admin-sidebar--open' : ''}`} aria-label="Admin navigation" aria-hidden={compact && !drawerOpen} inert={compact && !drawerOpen ? true : undefined} role={compact && drawerOpen ? 'dialog' : undefined} aria-modal={compact && drawerOpen ? true : undefined}>
        <div className="admin-sidebar__brand">
          <Link href="/admin" aria-label="EVEXIA Admin Dashboard" title={isCollapsed ? 'EVEXIA Dashboard' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-brand"><BrandMark /><span className="admin-sidebar__mark" aria-hidden="true"><Activity size={20} /></span></Link>
          <button type="button" className="admin-sidebar__collapse" aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!isCollapsed} aria-controls="admin-navigation" title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar} data-testid="button-toggle-sidebar">{isCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}</button>
          <button type="button" className="admin-sidebar__close" aria-label="Close menu" onClick={() => closeDrawer()} data-testid="button-close-navigation"><X size={19} /></button>
        </div>
        <div className="admin-sidebar__caption">Workspace</div>
        <nav className="admin-nav" aria-label="Primary">
          <Link href="/admin" className={`admin-nav__item${location === '/admin' ? ' admin-nav__item--active' : ''}`} aria-label="Dashboard" title={isCollapsed ? 'Dashboard' : undefined} aria-current={location === '/admin' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-dashboard">
            <LayoutDashboard size={17} aria-hidden="true" /><span className="admin-nav__label">Dashboard</span>
          </Link>
          <button type="button" className={`admin-nav__item${location.startsWith('/admin/masters') ? ' admin-nav__item--active' : ''}`} aria-label="Masters" title={isCollapsed ? 'Expand Masters' : undefined} aria-expanded={mastersOpen || isCollapsed} aria-controls="admin-masters-subnav" onClick={() => { if (isCollapsed) { toggleSidebar(); setMastersOpen(true); } else setMastersOpen((open) => !open); }} data-testid="button-toggle-masters">
            <PanelsTopLeft size={17} aria-hidden="true" /><span className="admin-nav__label">Masters</span><ChevronDown size={15} className={`admin-nav__chevron${mastersOpen ? ' admin-nav__chevron--open' : ''}`} aria-hidden="true" />
          </button>
          {(mastersOpen || isCollapsed) && (
            <div id="admin-masters-subnav" className="admin-nav__sub">
              <Link href="/admin/masters" className={`admin-nav__item${location === '/admin/masters' ? ' admin-nav__item--active' : ''}`} aria-label="All masters" title={isCollapsed ? 'All masters' : undefined} aria-current={location === '/admin/masters' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-masters"><LayoutGrid size={16} aria-hidden="true" /><span className="admin-nav__label">All masters</span></Link>
              <Link href="/admin/masters/zones" className={`admin-nav__item${location === '/admin/masters/zones' ? ' admin-nav__item--active' : ''}`} aria-label="Zone Master" title={isCollapsed ? 'Zone Master' : undefined} aria-current={location === '/admin/masters/zones' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-zones"><MapPinned size={16} aria-hidden="true" /><span className="admin-nav__label">Zone Master</span></Link>
            </div>
          )}
        </nav>
        <div className="admin-sidebar__foot">EVEXIA Life Sciences<br />Admin workspace · Preview</div>
      </aside>
      <div className="admin-workspace" inert={compact && drawerOpen ? true : undefined} aria-hidden={compact && drawerOpen}>
        <header className="admin-header">
          <div className="admin-header__left">
            <button ref={menuRef} type="button" className="admin-header__menu" aria-label="Open navigation" aria-controls="admin-navigation" aria-expanded={drawerOpen} onClick={() => { restoreMenuFocusRef.current = false; setDrawerOpen(true); }} data-testid="button-open-navigation"><Menu size={20} /></button>
            <span className="admin-header__label">Admin workspace</span>
            <span className="admin-header__divider" aria-hidden="true" />
            <span className="admin-header__page">{title}</span>
          </div>
          <div className="admin-header__actions">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="admin-theme__trigger" aria-label={`Theme: ${ADMIN_THEMES[theme]}`} data-testid="button-admin-theme">
                <span className="admin-theme__label">Theme</span>
                <span className="admin-theme__current" data-testid="text-admin-theme">{ADMIN_THEMES[theme]}</span>
                <span className="admin-theme__short" aria-hidden="true">{theme === 'classic' ? 'Classic' : 'Modern'}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="admin-theme__menu" data-admin-theme={theme} align="end" sideOffset={10} aria-label="Theme">
                <DropdownMenu.Label className="admin-theme__menu-label">Theme</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={theme} onValueChange={changeTheme}>
                  {Object.entries(ADMIN_THEMES).map(([value, label]) => (
                    <DropdownMenu.RadioItem key={value} value={value} className="admin-theme__option" data-testid={`option-admin-theme-${value}`}>
                      <span className={`admin-theme__swatches admin-theme__swatches--${value}`} aria-hidden="true"><i /><i /></span>
                      {label}
                      <DropdownMenu.ItemIndicator className="admin-theme__check"><Check size={15} aria-hidden="true" /></DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <div className="admin-profile">
              <DropdownMenu.Trigger asChild>
                <button type="button" className="admin-profile__trigger" aria-label="Admin User profile menu" data-testid="button-admin-profile">
                  <span className="admin-profile__avatar" aria-hidden="true">AU</span>
                  <span className="admin-profile__name">Admin User</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="admin-profile__menu" data-admin-theme={theme} align="end" sideOffset={10}>
                  <DropdownMenu.Label className="admin-profile__identity">
                    <strong>Admin User</strong><span>admin@evexia.com</span>
                  </DropdownMenu.Label>
                  <DropdownMenu.Separator className="admin-profile__separator" />
                  <DropdownMenu.Item className="admin-profile__signout" onSelect={() => navigate('/admin/login')} data-testid="link-admin-sign-out">
                    <LogOut size={15} aria-hidden="true" /> Sign Out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </div>
          </DropdownMenu.Root>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}