import { ADMIN_APPEARANCES, ADMIN_THEMES } from './adminTheme.js';
import { CLOCK_FORMATS, DATE_FORMATS, TIME_ZONES, formatAdminDate, formatAdminTimestamp, setAdminPreference, useAdminPreferences } from './adminPreferences.js';

function Setting({ label, id, value, choices, onChange, description }) {
  return <div className="admin-settings__field">
    <label htmlFor={id}>{label}</label>
    <p id={`${id}-help`}>{description}</p>
    <select id={id} className="admin-select" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-help`} data-testid={`select-admin-${id}`}>
      {Object.entries(choices).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
    </select>
  </div>;
}

export function BasicSettings() {
  const p = useAdminPreferences();
  return <section className="admin-panel admin-settings__section" aria-labelledby="basic-heading">
    <h2 id="basic-heading">General</h2>
    <p>How dates and times appear in Admin. Stored records and CSV files are unchanged.</p>
    <div className="admin-settings__grid">
      <Setting label="Date format" id="date-format" value={p.dateFormat} choices={DATE_FORMATS} onChange={(v) => setAdminPreference('dateFormat', v)} description="Choose the order and style of displayed calendar dates." />
      <Setting label="Time zone" id="time-zone" value={p.timeZone} choices={TIME_ZONES} onChange={(v) => setAdminPreference('timeZone', v)} description="Applies to timestamps only; calendar-only dates stay on the same day." />
      <Setting label="Clock" id="clock" value={p.clock} choices={CLOCK_FORMATS} onChange={(v) => setAdminPreference('clock', v)} description="Choose a 12-hour or 24-hour clock for timestamps." />
    </div>
    <div className="admin-settings__preview" aria-live="polite">
      <strong>Live display preview</strong>
      <span data-testid="text-admin-date-preview">Calendar date: {formatAdminDate('2026-09-30', p)}</span>
      <span data-testid="text-admin-time-preview">Timestamp: {formatAdminTimestamp('2026-09-30T18:45:00Z', p)}</span>
    </div>
  </section>;
}

export function AppearanceSettings() {
  const p = useAdminPreferences();
  return <section className="admin-panel admin-settings__section" aria-labelledby="ui-heading">
    <h2 id="ui-heading">Appearance</h2>
    <p>These choices change the Admin workspace immediately, without changing public or login pages.</p>
    <div className="admin-settings__grid">
      <Setting label="Appearance" id="appearance" value={p.appearance} choices={ADMIN_APPEARANCES} onChange={(v) => setAdminPreference('appearance', v)} description="Choose Light or Dark for the Admin workspace." />
      <Setting label="Theme" id="theme" value={p.theme} choices={ADMIN_THEMES} onChange={(v) => setAdminPreference('theme', v)} description="Choose EVEXIA Classic or EVEXIA Modern colors." />
    </div>
    <div className="admin-settings-style-guide" aria-label="Appearance and theme guide">
      <div><strong>Light / Dark</strong><p>Light uses bright surfaces; Dark uses dark surfaces. Both keep the same workspace layout.</p></div>
      <div><strong><span className="admin-theme__swatches admin-theme__swatches--classic" aria-hidden="true"><i /><i /></span> EVEXIA Classic</strong><p>Warm red and orange accents.</p></div>
      <div><strong><span className="admin-theme__swatches admin-theme__swatches--modern" aria-hidden="true"><i /><i /><i /></span> EVEXIA Modern</strong><p>Sea green actions with lavender surfaces.</p></div>
    </div>
    <div className="admin-settings__preview" aria-live="polite">
      <strong>Current selection</strong>
      <span data-testid="text-admin-appearance-current">{ADMIN_APPEARANCES[p.appearance]} appearance with {ADMIN_THEMES[p.theme]}</span>
    </div>
  </section>;
}
