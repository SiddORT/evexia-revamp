export function resolveSettingsSection(search, sections) {
  const tab = new URLSearchParams(search || '').get('tab');
  return sections.some((s) => s.id === tab) ? tab : 'basic';
}
export function searchSettingsSections(sections, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return sections;
  return sections.filter((s) => {
    const hay = [s.label, s.description, ...(s.keywords || []), s.id].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
export function settingsSectionUrl(href, id, sections) {
  const url = new URL(href, 'http://localhost');
  const target = sections.some((s) => s.id === id) ? id : 'basic';
  url.searchParams.set('tab', target);
  return url;
}
