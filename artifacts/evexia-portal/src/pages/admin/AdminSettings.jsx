import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { Search, X } from 'lucide-react';
import '../../adminSettings.css';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { SETTINGS_SECTIONS as ALL_SECTIONS } from '../../components/admin/settingsSections.jsx';
import { resolveSettingsSection, searchSettingsSections, settingsSectionUrl } from '../../components/admin/settingsNavigation.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import useSettingsDraftGuard from '../../hooks/useSettingsDraftGuard.js';

export default function AdminSettings() {
  const search = useSearch();
  const session = useAdminSession();
  const isSuper = session?.user?.identity_kind === 'super_admin';
  const SETTINGS_SECTIONS = useMemo(() => ALL_SECTIONS.filter((s) => !s.superAdminOnly || isSuper), [isSuper]);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const panelRef = useRef(null);
  const onGuardChange = useSettingsDraftGuard();
  const activeId = resolveSettingsSection(search, SETTINGS_SECTIONS);
  const active = SETTINGS_SECTIONS.find((s) => s.id === activeId);
  const matches = searchSettingsSections(SETTINGS_SECTIONS, query);
  const hrefFor = (id) => { const u = settingsSectionUrl(window.location.href, id, SETTINGS_SECTIONS); return u.pathname + u.search + u.hash; };
  const clearSearch = () => {
    setQuery('');
    searchRef.current?.focus();
  };
  useEffect(() => {
    const requested = new URLSearchParams(search).get('tab');
    if (requested !== null && !SETTINGS_SECTIONS.some((s) => s.id === requested)) {
      const url = settingsSectionUrl(window.location.href, 'basic', SETTINGS_SECTIONS);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }, [search, SETTINGS_SECTIONS]);
  const go = (e, id) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (id !== activeId) window.history.pushState(window.history.state, '', hrefFor(id));
    if (e.detail === 0) requestAnimationFrame(() => panelRef.current?.focus());
  };
  const Active = active.Component;
  return <AdminLayout title="Settings">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Admin / {isSuper ? 'Shared Settings and Browser Preferences' : 'Browser Preferences'}</p><h1>Settings</h1><p className="admin-page-head__description">Most choices personalize this browser’s Admin preview and are not synced to an account or other devices.{isSuper ? ' Role URLs are the exception: they are shared settings that apply to every user.' : ''}</p></div></div>
    <div className="admin-settings-layout">
      <nav className="admin-settings-nav" aria-label="Settings categories">
        <div className="admin-settings-nav__search">
          <Search size={16} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') clearSearch(); }} placeholder="Search settings" aria-label="Search settings categories" aria-describedby="settings-search-help" data-testid="input-settings-search" />
          {query && <button type="button" className="admin-settings-nav__clear" onClick={clearSearch} aria-label="Clear settings search" data-testid="button-settings-search-clear"><X size={14} aria-hidden="true" /></button>}
        </div>
        <p className="admin-settings-nav__help" id="settings-search-help">Find available categories, not individual controls.</p>
        {query.trim() && <p className="admin-settings-nav__help" role="status">{matches.length} {matches.length === 1 ? 'category' : 'categories'} found. Current settings stay visible.</p>}
        <ul className="admin-settings-nav__list">
          {matches.map(({ id, label, Icon, description }) => <li key={id}>
            <a href={hrefFor(id)} className="admin-settings-nav__link" aria-current={id === activeId ? 'page' : undefined} aria-controls="settings-panel" aria-label={label} title={label} onClick={(e) => go(e, id)} data-testid={`link-settings-${id}`}>
              <Icon size={18} aria-hidden="true" />
              <span className="admin-settings-nav__text"><strong>{label}</strong><small>{description}</small></span>
            </a>
          </li>)}
        </ul>
        {query && matches.length === 0 && <p className="admin-settings-nav__empty">No categories match. Try date, theme or templates.<button type="button" onClick={clearSearch}>Clear search</button></p>}
        <a className="admin-settings-nav__skip" href="#settings-panel" onClick={(e) => { e.preventDefault(); panelRef.current?.focus(); }}>Go to current settings</a>
      </nav>
      <div ref={panelRef} tabIndex={-1} className="admin-settings-body" id="settings-panel" role="region" aria-label={`${active.label} settings`}><Active onGuardChange={onGuardChange} /></div>
    </div>
  </AdminLayout>;
}
