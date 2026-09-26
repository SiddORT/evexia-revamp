import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Boxes, BriefcaseBusiness, Building2, Check, ChevronDown, FlaskConical, HeartPulse, Landmark, LayoutDashboard, LayoutGrid, LogOut, MapPinned, Menu, Moon, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Search, Stethoscope, Sun, Target, Truck, UsersRound, Warehouse, X } from 'lucide-react';
import BrandMark from '../BrandMark.jsx';
import { ADMIN_APPEARANCES, ADMIN_THEMES, readAdminAppearance, readAdminTheme, saveAdminAppearance, saveAdminTheme } from './adminTheme.js';
import '../../admin.css';

const SIDEBAR_PREFERENCE_KEY = 'evexia.admin.sidebar.collapsed';
const MASTER_GROUPS = [
  { label: 'Geography & Logistics', links: [
    { label: 'Zone Master', href: '/admin/masters/zones', testId: 'link-admin-zones', Icon: MapPinned },
    { label: 'Courier Partner', href: '/admin/masters/courier-partners', testId: 'link-admin-courier-partners', Icon: Truck },
    { label: 'Storage Location', href: '/admin/masters/storage-locations', testId: 'link-admin-storage-locations', Icon: Warehouse, nested: true },
    { label: 'Headquarter Master', href: '/admin/masters/headquarters', testId: 'link-admin-headquarters', Icon: Building2, nested: true },
  ] },
  { label: 'People & Organization', links: [
    { label: 'MR Master', href: '/admin/masters/mrs', testId: 'link-admin-mrs', Icon: UsersRound },
    { label: 'Doctor Master', href: '/admin/masters/doctors', testId: 'link-admin-doctors', Icon: Stethoscope, nested: true },
    { label: 'Patient Master', href: '/admin/masters/patients', testId: 'link-admin-patients', Icon: HeartPulse, nested: true },
    { label: 'Designation Master', href: '/admin/masters/designations', testId: 'link-admin-designations', Icon: BriefcaseBusiness, nested: true },
  ] },
  { label: 'Products & Supply', links: [
    { label: 'Product Category', href: '/admin/masters/product-categories', testId: 'link-admin-product-categories', Icon: Boxes, nested: true },
    { label: 'Allergen Master', href: '/admin/masters/allergens', testId: 'link-admin-allergens', Icon: FlaskConical, nested: true },
    { label: 'Vendor Master', href: '/admin/masters/vendors', testId: 'link-admin-vendors', Icon: BriefcaseBusiness },
  ] },
  { label: 'Finance & Performance', links: [
    { label: 'Sales Target Master', href: '/admin/masters/sales-targets', testId: 'link-admin-sales-targets', Icon: Target },
    { label: 'Opening Balance', href: '/admin/masters/opening-balances', testId: 'link-admin-opening-balances', Icon: Landmark, nested: true },
  ] },
];

export default function AdminLayout({ title, children }) {
  const [location, navigate] = useLocation();
  const [mastersOpen, setMastersOpen] = useState(location.startsWith('/admin/masters'));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === 'true'; }
    catch { return false; }
  });
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [theme, setTheme] = useState(readAdminTheme);
  const [appearance, setAppearance] = useState(readAdminAppearance);
  const menuRef = useRef(null);
  const sidebarRef = useRef(null);
  const searchRef = useRef(null);
  const searchButtonRef = useRef(null);
  const restoreMenuFocusRef = useRef(false);
  const isCollapsed = sidebarCollapsed && !compact && !searchExpanded;
  const query = search.trim().toLocaleLowerCase();
  const searching = query.length > 0;
  const showDashboard = !searching || 'dashboard'.includes(query);
  const showStaff = !searching || 'staff management'.includes(query);
  const showAllMasters = !searching || 'all masters'.includes(query);
  const visibleGroups = MASTER_GROUPS.map((group) => ({
    ...group,
    links: searching ? group.links.filter((link) => link.label.toLocaleLowerCase().includes(query)) : group.links,
  })).filter((group) => group.links.length > 0);
  const showMasters = !searching || showAllMasters || visibleGroups.length > 0;
  const showSubnav = showMasters && (searching || mastersOpen || isCollapsed);

  function clearSearch() {
    setSearch('');
    if (searchExpanded) {
      setSearchExpanded(false);
      requestAnimationFrame(() => searchButtonRef.current?.focus());
    } else {
      searchRef.current?.focus();
    }
  }

  function changeSearch(value) {
    setSearch(value);
    if (searchExpanded && search && !value.trim()) {
      setSearchExpanded(false);
      requestAnimationFrame(() => searchButtonRef.current?.focus());
    }
  }

  function toggleSidebar() {
    const next = !isCollapsed;
    setSearch('');
    setSearchExpanded(false);
    setSidebarCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(next)); }
    catch { /* The toggle still works if browser storage is unavailable. */ }
  }

  function changeTheme(next) {
    if (!Object.hasOwn(ADMIN_THEMES, next)) return;
    setTheme(next);
    saveAdminTheme(next);
  }

  function changeAppearance(next) {
    if (!Object.hasOwn(ADMIN_APPEARANCES, next)) return;
    setAppearance(next);
    saveAdminAppearance(next);
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
    setSearch('');
    setSearchExpanded(false);
    if (location.startsWith('/admin/masters')) setMastersOpen(true);
  }, [location]);

  useEffect(() => {
    if (searchExpanded) searchRef.current?.focus();
  }, [searchExpanded]);

  useEffect(() => {
    if (compact && drawerOpen) {
      searchRef.current?.focus();
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
        const controls = [...sidebarRef.current.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
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
    <div className={`admin-shell${isCollapsed ? ' admin-shell--collapsed' : ''}`} data-admin-theme={theme} data-admin-appearance={appearance}>
      {drawerOpen && compact && <button type="button" className="admin-backdrop" aria-label="Close navigation" tabIndex={-1} onClick={() => closeDrawer()} data-testid="button-close-navigation-backdrop" />}
      <aside ref={sidebarRef} id="admin-navigation" className={`admin-sidebar${drawerOpen ? ' admin-sidebar--open' : ''}`} aria-label="Admin navigation" aria-hidden={compact && !drawerOpen} inert={compact && !drawerOpen ? true : undefined} role={compact && drawerOpen ? 'dialog' : undefined} aria-modal={compact && drawerOpen ? true : undefined}>
        <div className="admin-sidebar__brand">
          <Link href="/admin" aria-label="EVEXIA Admin Dashboard" title={isCollapsed ? 'EVEXIA Dashboard' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-brand"><BrandMark /><span className="admin-sidebar__mark" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}favicon.png`} alt="" width="32" height="32" /></span></Link>
          <button type="button" className="admin-sidebar__collapse" aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!isCollapsed} aria-controls="admin-navigation" title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleSidebar} data-testid="button-toggle-sidebar">{isCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}</button>
          <button type="button" className="admin-sidebar__close" aria-label="Close menu" onClick={() => closeDrawer()} data-testid="button-close-navigation"><X size={19} /></button>
        </div>
        <div className="admin-sidebar__caption">Workspace</div>
        <div className="admin-sidebar__search">
          {isCollapsed ? (
            <button ref={searchButtonRef} type="button" className="admin-sidebar__search-trigger" aria-label="Search navigation" title="Search navigation" onClick={() => setSearchExpanded(true)} data-testid="button-search-navigation"><Search size={18} aria-hidden="true" /></button>
          ) : (
            <div className="admin-sidebar__search-field">
              <Search size={16} aria-hidden="true" />
              <input ref={searchRef} type="search" aria-label="Search navigation" placeholder="Search navigation" value={search} onChange={(event) => changeSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && (search || searchExpanded)) { event.stopPropagation(); clearSearch(); } }} data-testid="input-search-navigation" />
              {(search || searchExpanded) && <button type="button" aria-label={search ? 'Clear navigation search' : 'Close navigation search'} title={search ? 'Clear navigation search' : 'Close navigation search'} onClick={clearSearch} data-testid="button-clear-navigation-search"><X size={15} aria-hidden="true" /></button>}
            </div>
          )}
        </div>
        <nav className="admin-nav" aria-label="Primary">
          {showDashboard && <Link href="/admin" className={`admin-nav__item${location === '/admin' ? ' admin-nav__item--active' : ''}`} aria-label="Dashboard" title={isCollapsed ? 'Dashboard' : undefined} aria-current={location === '/admin' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-dashboard">
            <LayoutDashboard size={17} aria-hidden="true" /><span className="admin-nav__label">Dashboard</span>
          </Link>}
          {showStaff && <Link href="/admin/staff" className={`admin-nav__item${location.startsWith('/admin/staff') ? ' admin-nav__item--active' : ''}`} aria-label="Staff Management" title={isCollapsed ? 'Staff Management' : undefined} aria-current={location === '/admin/staff' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-staff">
            <UsersRound size={17} aria-hidden="true" /><span className="admin-nav__label">Staff Management</span>
          </Link>}
          {showMasters && <button type="button" disabled={searching} className={`admin-nav__item${location.startsWith('/admin/masters') ? ' admin-nav__item--active' : ''}`} aria-label="Masters" title={isCollapsed ? 'Expand Masters' : undefined} aria-expanded={showSubnav} aria-controls="admin-masters-subnav" onClick={() => { if (isCollapsed) { toggleSidebar(); setMastersOpen(true); } else setMastersOpen((open) => !open); }} data-testid="button-toggle-masters">
            <PanelsTopLeft size={17} aria-hidden="true" /><span className="admin-nav__label">Masters</span><ChevronDown size={15} className={`admin-nav__chevron${showSubnav ? ' admin-nav__chevron--open' : ''}`} aria-hidden="true" />
          </button>}
          {showSubnav && (
            <div id="admin-masters-subnav" className="admin-nav__sub">
              {showAllMasters && <Link href="/admin/masters" className={`admin-nav__item${location === '/admin/masters' ? ' admin-nav__item--active' : ''}`} aria-label="All masters" title={isCollapsed ? 'All masters' : undefined} aria-current={location === '/admin/masters' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-masters"><LayoutGrid size={16} aria-hidden="true" /><span className="admin-nav__label">All masters</span></Link>}
              {visibleGroups.map((group) => (
                <section className="admin-nav__group" aria-label={group.label} key={group.label}>
                  <h2 className="admin-nav__group-heading">{group.label}</h2>
                  {group.links.map(({ label, href, testId, Icon, nested }) => {
                    const active = nested ? location.startsWith(href) : location === href;
                    return <Link key={href} href={href} className={`admin-nav__item${active ? ' admin-nav__item--active' : ''}`} aria-label={label} title={isCollapsed ? label : undefined} aria-current={location === href ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid={testId}><Icon size={16} aria-hidden="true" /><span className="admin-nav__label">{label}</span></Link>;
                  })}
                </section>
              ))}
            </div>
          )}
          {searching && !showDashboard && !showStaff && !showMasters && <p className="admin-nav__empty" role="status" data-testid="status-navigation-empty">No navigation results. Try another search.</p>}
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
              <button type="button" className="admin-theme__trigger admin-appearance__trigger" aria-label={`Appearance: ${ADMIN_APPEARANCES[appearance]}`} data-testid="button-admin-appearance">
                {appearance === 'light' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
                <span className="admin-theme__label">Appearance</span>
                <span className="admin-theme__current" data-testid="text-admin-appearance">{ADMIN_APPEARANCES[appearance]}</span>
                <span className="admin-theme__short" aria-hidden="true">{ADMIN_APPEARANCES[appearance]}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="admin-theme__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={10} aria-label="Appearance">
                <DropdownMenu.Label className="admin-theme__menu-label">Appearance</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={appearance} onValueChange={changeAppearance}>
                  {Object.entries(ADMIN_APPEARANCES).map(([value, label]) => (
                    <DropdownMenu.RadioItem key={value} value={value} className="admin-theme__option" data-testid={`option-admin-appearance-${value}`}>
                      {value === 'light' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
                      {label}
                      <DropdownMenu.ItemIndicator className="admin-theme__check"><Check size={15} aria-hidden="true" /></DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
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
              <DropdownMenu.Content className="admin-theme__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={10} aria-label="Theme">
                <DropdownMenu.Label className="admin-theme__menu-label">Theme</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={theme} onValueChange={changeTheme}>
                  {Object.entries(ADMIN_THEMES).map(([value, label]) => (
                    <DropdownMenu.RadioItem key={value} value={value} className="admin-theme__option" data-testid={`option-admin-theme-${value}`}>
                      <span className={`admin-theme__swatches admin-theme__swatches--${value}`} aria-hidden="true"><i /><i />{value === 'modern' && <i />}</span>
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
                <DropdownMenu.Content className="admin-profile__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={10}>
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