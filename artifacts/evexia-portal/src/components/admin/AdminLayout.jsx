import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Boxes, BriefcaseBusiness, Building2, ChevronDown, ClipboardList, FlaskConical, HeartPulse, Landmark, LayoutDashboard, LayoutGrid, LogOut, MapPinned, FileDown, ScrollText, Menu, PanelLeftClose, PanelLeftOpen, PanelsTopLeft, Search, Settings, ShieldCheck, Stethoscope, Target, Truck, UsersRound, Warehouse, X } from 'lucide-react';
import BrandMark from '../BrandMark.jsx';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { MASTER_CATALOGUE, canViewMaster, isStaffIdentity } from '../../auth/capabilities.js';
import { interceptNavigation } from '../../auth/navigationGuard.js';
import { logoutAdmin } from '../../auth/adminSession.js';
import { useAdminPreferences } from './adminPreferences.js';
import '../../admin.css';
import { recordPageVisit, flushActivityBeforeExit } from '../../activity/activityTracker.js';
import ActivityRecordingStatus from '../../activity/ActivityRecordingStatus.jsx';

const SIDEBAR_PREFERENCE_KEY = 'evexia.admin.sidebar.collapsed';
const isDesignationPath = (path) => path === '/admin/masters/designations' || path.startsWith('/admin/masters/designations/') || path === '/admin/masters/import/designation';
const isUserManagementPath = (path) => path.startsWith('/admin/staff') || path === '/admin/roles-permissions' || isDesignationPath(path);
const isMastersPath = (path) => path.startsWith('/admin/masters') && !isDesignationPath(path);
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
  const { user } = useAdminSession();
  const staff = isStaffIdentity(user);
  useEffect(() => { recordPageVisit(location); }, [location, user?.id]);
  const profileName = user?.username || user?.email || (staff ? 'Staff member' : 'Super Admin');
  const go = (href) => { if (!interceptNavigation({ kind: 'href', href })) navigate(href); };
  function signOut() {
    if (interceptNavigation({ kind: 'run', run: signOutNow })) return Promise.resolve();
    return signOutNow();
  }
  async function signOutNow() {
    const result = logoutAdmin({ beforeRevoke: flushActivityBeforeExit() });
    navigate('/admin/login', { replace: true });
    await result;
  }
  const [mastersOpen, setMastersOpen] = useState(isMastersPath(location));
  const [inventoryOpen, setInventoryOpen] = useState(location.startsWith('/admin/inventory'));
  const [userManagementOpen, setUserManagementOpen] = useState(isUserManagementPath(location));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === 'true'; }
    catch { return false; }
  });
  const [search, setSearch] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const { theme, appearance } = useAdminPreferences();
  const menuRef = useRef(null);
  const sidebarRef = useRef(null);
  const searchRef = useRef(null);
  const searchButtonRef = useRef(null);
  const restoreMenuFocusRef = useRef(false);
  const isCollapsed = sidebarCollapsed && !compact && !searchExpanded;
  const query = search.trim().toLocaleLowerCase();
  const searching = query.length > 0;
  const showDashboard = !staff && (!searching || 'dashboard'.includes(query));
  const showStaff = !staff && (!searching || 'user management'.includes(query) || 'staff management'.includes(query));
  const showRoles = !staff && (!searching || 'user management'.includes(query) || 'roles & permissions roles and permissions'.includes(query));
  const showDesignations = !staff && (!searching || 'user management'.includes(query) || 'designation master'.includes(query));
  const showUserManagement = showStaff || showRoles || showDesignations;
  const showAllMasters = !staff && (!searching || 'all masters'.includes(query));
  const showPO = !staff && (!searching || 'inventory purchase orders po'.includes(query));
  const showPR = !staff && (!searching || 'inventory purchase received pr receipts'.includes(query));
  const showMoveStocks = !staff && (!searching || 'inventory move stocks transfer'.includes(query));
  const showStockStatus = !staff && (!searching || 'inventory stock status allergens'.includes(query));
  const showInventory = showPO || showPR || showMoveStocks || showStockStatus;
  const visibleGroups = MASTER_GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => !staff || MASTER_CATALOGUE.some((master) =>
      link.href === `/admin/masters/${master.path}` && canViewMaster(user, master.key)))
      .filter((link) => !searching || link.label.toLocaleLowerCase().includes(query)),
  })).filter((group) => group.links.length > 0);
  const showMasters = staff ? visibleGroups.length > 0 : (!searching || showAllMasters || visibleGroups.length > 0);
  const showSubnav = showMasters && !isCollapsed && (searching || mastersOpen);
  const showUserSubnav = showUserManagement && !isCollapsed && (searching || userManagementOpen);
  const showInventorySubnav = showInventory && !isCollapsed && (searching || inventoryOpen);

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
    if (isMastersPath(location)) setMastersOpen(true);
    if (isDesignationPath(location)) setMastersOpen(false);
    if (location.startsWith('/admin/inventory')) setInventoryOpen(true);
    if (isUserManagementPath(location)) setUserManagementOpen(true);
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
          {showMasters && <button type="button" disabled={searching} className={`admin-nav__item${isMastersPath(location) ? ' admin-nav__item--active' : ''}`} aria-label="Masters" title={isCollapsed ? 'Expand Masters' : undefined} aria-expanded={showSubnav} aria-controls="admin-masters-subnav" onClick={() => { if (isCollapsed) { toggleSidebar(); setMastersOpen(true); } else setMastersOpen((open) => !open); }} data-testid="button-toggle-masters">
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
          {showInventory && <button type="button" disabled={searching} className={`admin-nav__item${location.startsWith('/admin/inventory') ? ' admin-nav__item--active' : ''}`} aria-label="Inventory" title={isCollapsed ? 'Expand Inventory' : undefined} aria-expanded={showInventorySubnav} aria-controls="admin-inventory-subnav" onClick={() => { if (isCollapsed) { toggleSidebar(); setInventoryOpen(true); } else setInventoryOpen((open) => !open); }} data-testid="button-toggle-inventory">
            <Boxes size={17} aria-hidden="true" /><span className="admin-nav__label">Inventory</span><ChevronDown size={15} className={`admin-nav__chevron${showInventorySubnav ? ' admin-nav__chevron--open' : ''}`} aria-hidden="true" />
          </button>}
          <div id="admin-inventory-subnav" className="admin-nav__sub" hidden={!showInventorySubnav}>
            {showPO && <Link href="/admin/inventory/purchase-orders" className={`admin-nav__item${location.startsWith('/admin/inventory/purchase-orders') ? ' admin-nav__item--active' : ''}`} aria-label="Purchase Orders" aria-current={location === '/admin/inventory/purchase-orders' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-purchase-orders"><ClipboardList size={16} aria-hidden="true" /><span className="admin-nav__label">Purchase Orders</span></Link>}
            {showPR && <Link href="/admin/inventory/purchase-received" className={`admin-nav__item${location.startsWith('/admin/inventory/purchase-received') ? ' admin-nav__item--active' : ''}`} aria-label="Purchase Received" aria-current={location === '/admin/inventory/purchase-received' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-purchase-received"><ClipboardList size={16} aria-hidden="true" /><span className="admin-nav__label">Purchase Received</span></Link>}
            {showMoveStocks && <Link href="/admin/inventory/move-stocks" className={`admin-nav__item${location.startsWith('/admin/inventory/move-stocks') ? ' admin-nav__item--active' : ''}`} aria-label="Move stocks" aria-current={location.startsWith('/admin/inventory/move-stocks') ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-move-stocks"><Boxes size={16} aria-hidden="true" /><span className="admin-nav__label">Move stocks</span></Link>}
            {showStockStatus && <Link href="/admin/inventory/stock-status" className={`admin-nav__item${location === '/admin/inventory/stock-status' ? ' admin-nav__item--active' : ''}`} aria-label="Stock Status" aria-current={location === '/admin/inventory/stock-status' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-stock-status"><Boxes size={16} aria-hidden="true" /><span className="admin-nav__label">Stock Status</span></Link>}
          </div>
          {showUserManagement && <button type="button" disabled={searching} className={`admin-nav__item${isUserManagementPath(location) ? ' admin-nav__item--active' : ''}`} aria-label="User Management" title={isCollapsed ? 'Expand User Management' : undefined} aria-expanded={showUserSubnav} aria-controls="admin-user-management-subnav" onClick={() => { if (isCollapsed) { toggleSidebar(); setUserManagementOpen(true); } else setUserManagementOpen((open) => !open); }} data-testid="button-toggle-user-management">
            <UsersRound size={17} aria-hidden="true" /><span className="admin-nav__label">User Management</span><ChevronDown size={15} className={`admin-nav__chevron${showUserSubnav ? ' admin-nav__chevron--open' : ''}`} aria-hidden="true" />
          </button>}
          <div id="admin-user-management-subnav" className="admin-nav__sub" hidden={!showUserSubnav}>
            {showStaff && <Link href="/admin/staff" className={`admin-nav__item${location.startsWith('/admin/staff') ? ' admin-nav__item--active' : ''}`} aria-label="Staff Management" aria-current={location === '/admin/staff' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-staff">
              <UsersRound size={16} aria-hidden="true" /><span className="admin-nav__label">Staff Management</span>
            </Link>}
            {showRoles && <Link href="/admin/roles-permissions" className={`admin-nav__item${location === '/admin/roles-permissions' ? ' admin-nav__item--active' : ''}`} aria-label="Roles & Permissions" aria-current={location === '/admin/roles-permissions' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-roles-permissions">
              <ShieldCheck size={16} aria-hidden="true" /><span className="admin-nav__label">Roles & Permissions</span>
            </Link>}
            {showDesignations && <Link href="/admin/masters/designations" className={`admin-nav__item${isDesignationPath(location) ? ' admin-nav__item--active' : ''}`} aria-label="Designation Master" aria-current={location === '/admin/masters/designations' ? 'page' : undefined} onClick={() => closeDrawer(false)} data-testid="link-admin-designations">
              <BriefcaseBusiness size={16} aria-hidden="true" /><span className="admin-nav__label">Designation Master</span>
            </Link>}
          </div>
          {searching && !showDashboard && !showUserManagement && !showMasters && !showInventory && <p className="admin-nav__empty" role="status" data-testid="status-navigation-empty">No navigation results. Try another search.</p>}
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
            <div className="admin-profile">
              <DropdownMenu.Trigger asChild>
                <button type="button" className="admin-profile__trigger" aria-label={staff ? 'Staff profile menu' : 'Super Admin profile menu'} data-testid="button-admin-profile">
                  <span className="admin-profile__avatar" aria-hidden="true">{staff ? profileName.slice(0, 2).toUpperCase() : 'SA'}</span>
                  <span className="admin-profile__name">{profileName}</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="admin-dropdown__menu admin-profile__menu" data-admin-theme={theme} data-admin-appearance={appearance} align="end" sideOffset={10}>
                  <DropdownMenu.Label className="admin-profile__identity">
                    <strong>{profileName}</strong><span>{staff ? 'Signed-in staff' : 'Authenticated Super Admin'}</span>
                  </DropdownMenu.Label>
                  <DropdownMenu.Separator className="admin-dropdown__separator" />
                  {!staff && <>
                  <DropdownMenu.Item className="admin-dropdown__item" onSelect={() => go('/admin/settings')} data-testid="link-admin-settings">
                    <Settings size={15} aria-hidden="true" /> Settings
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="admin-dropdown__item" onSelect={() => go('/admin/activity-logs')} data-testid="link-admin-activity-logs">
                    <ScrollText size={15} aria-hidden="true" /> Sessions &amp; Activity Logs
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className="admin-dropdown__item" onSelect={() => go('/admin/download-logs')} data-testid="link-admin-download-logs">
                    <FileDown size={15} aria-hidden="true" /> Download Logs
                  </DropdownMenu.Item>
                  </>}
                  <DropdownMenu.Item className="admin-dropdown__item admin-dropdown__item--danger" onSelect={() => void signOut()} data-testid="link-admin-sign-out">
                    <LogOut size={15} aria-hidden="true" /> Log Out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </div>
          </DropdownMenu.Root>
          </div>
        </header>
        <main className="admin-content">
          <ActivityRecordingStatus />
          {children}
        </main>
      </div>
    </div>
  );
}