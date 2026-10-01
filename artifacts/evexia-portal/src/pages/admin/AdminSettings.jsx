import { useState } from 'react';
import POTemplateSettings from '../../components/admin/POTemplateSettings.jsx';
import CommunicationSettings from '../../components/admin/CommunicationSettings.jsx';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { ADMIN_APPEARANCES, ADMIN_THEMES } from '../../components/admin/adminTheme.js';
import { CLOCK_FORMATS, DATE_FORMATS, TIME_ZONES, formatAdminDate, formatAdminTimestamp, setAdminPreference, useAdminPreferences } from '../../components/admin/adminPreferences.js';

function Setting({ label, id, value, choices, onChange, description }) {
  return <div className="admin-settings__field">
    <label htmlFor={id}>{label}</label>
    <p id={`${id}-help`}>{description}</p>
    <select id={id} className="admin-select" value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={`${id}-help`} data-testid={`select-admin-${id}`}>
      {Object.entries(choices).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  </div>;
}

const TABS = [['basic', 'Basic'], ['ui', 'UI'], ['templates', 'Templates'], ['communication', 'Communication']];
function initialTab() {
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some(([k]) => k === t) ? t : 'basic';
}

export default function AdminSettings() {
  const preferences = useAdminPreferences();
  const [tab, setTab] = useState(initialTab);
  const selectTab = (key) => {
    setTab(key);
    const url = new URL(window.location.href);
    if (key === 'basic') url.searchParams.delete('tab'); else url.searchParams.set('tab', key);
    window.history.replaceState(window.history.state, '', url);
  };
  const onTabKey = (event, index) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length][0];
    selectTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return <AdminLayout title="Settings">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Demo Admin / Preferences</p><h1>Settings</h1><p className="admin-page-head__description">Personalize this browser’s Admin preview. These choices are not synced to an account or other devices.</p></div></div>
    <div className="admin-settings">
      <div className="admin-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(([key, text], i) => <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => selectTab(key)} onKeyDown={(e) => onTabKey(e, i)}>{text}</button>)}
      </div>
      {tab === 'templates' && <div role="tabpanel" id="panel-templates" aria-labelledby="tab-templates"><POTemplateSettings /></div>}
      {tab === 'communication' && <div role="tabpanel" id="panel-communication" aria-labelledby="tab-communication"><CommunicationSettings /></div>}
      {tab === 'basic' && <section role="tabpanel" id="panel-basic" aria-labelledby="basic-heading" className="admin-panel admin-settings__section">
        <h2 id="basic-heading">Basic settings</h2>
        <p>How dates and times appear in Admin. Stored records and CSV files are unchanged.</p>
        <div className="admin-settings__grid">
          <Setting label="Date format" id="date-format" value={preferences.dateFormat} choices={DATE_FORMATS} onChange={(value) => setAdminPreference('dateFormat', value)} description="Choose the order and style of displayed calendar dates." />
          <Setting label="Time zone" id="time-zone" value={preferences.timeZone} choices={TIME_ZONES} onChange={(value) => setAdminPreference('timeZone', value)} description="Applies to timestamps only; calendar-only dates stay on the same day." />
          <Setting label="Clock" id="clock" value={preferences.clock} choices={CLOCK_FORMATS} onChange={(value) => setAdminPreference('clock', value)} description="Choose a 12-hour or 24-hour clock for timestamps." />
        </div>
        <div className="admin-settings__preview" aria-live="polite">
          <strong>Display preview</strong>
          <span data-testid="text-admin-date-preview">Calendar date: {formatAdminDate('2026-09-30', preferences)}</span>
          <span data-testid="text-admin-time-preview">Timestamp: {formatAdminTimestamp('2026-09-30T18:45:00Z', preferences)}</span>
        </div>
      </section>}
      {tab === 'ui' && <section role="tabpanel" id="panel-ui" className="admin-panel admin-settings__section" aria-labelledby="ui-heading">
        <h2 id="ui-heading">UI settings</h2>
        <p>These choices change the Admin workspace immediately, without changing public or login pages.</p>
        <div className="admin-settings__grid">
          <Setting label="Appearance" id="appearance" value={preferences.appearance} choices={ADMIN_APPEARANCES} onChange={(value) => setAdminPreference('appearance', value)} description="Choose Light or Dark for the Admin workspace." />
          <Setting label="Theme" id="theme" value={preferences.theme} choices={ADMIN_THEMES} onChange={(value) => setAdminPreference('theme', value)} description="Choose EVEXIA Classic or EVEXIA Modern colors." />
        </div>
      </section>}
    </div>
  </AdminLayout>;
}