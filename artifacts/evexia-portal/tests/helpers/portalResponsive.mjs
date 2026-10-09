export const representatives = [[390, 844], [820, 1180], [1366, 768], [1920, 1080]];
export const expanded = [
  [320, 568], [360, 800], [390, 844], [430, 932],
  [768, 1024], [820, 1180], [1024, 768],
  [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440],
  [844, 390], [1180, 820],
  ...[460, 600, 760, 800, 900, 1000, 1050, 1150].flatMap((width) => [[width - 1, 720], [width + 1, 720]]),
];
export const lists = ['zones', 'courier-partners', 'mrs', 'doctors', 'patients', 'product-categories',
  'storage-locations', 'headquarters', 'designations', 'allergens', 'vendors', 'sales-targets', 'opening-balances'];
export const imports = ['zone', 'courier-partner', 'mr', 'doctor', 'product-category',
  'storage-location', 'headquarter', 'designation', 'allergen', 'vendor', 'sales-target', 'opening-balance'];
export const newForms = ['mrs', 'doctors', 'patients', 'product-categories', 'storage-locations',
  'headquarters', 'designations', 'allergens', 'opening-balances'];
export const settings = ['basic', 'ui', 'templates', 'communication', 'message-templates'];
export const publicRoutes = ['/', '/admin/login', '/mr', '/doctor', '/not-a-route'];
export const adminRoutes = [
  '/admin', '/admin/masters', '/admin/staff', '/admin/roles-permissions',
  '/admin/activity-logs', '/admin/download-logs',
  ...lists.map((kind) => `/admin/masters/${kind}`),
  ...newForms.map((kind) => `/admin/masters/${kind}/new`),
  ...imports.map((kind) => `/admin/masters/import/${kind}`), '/admin/masters/patients/import',
  ...['purchase-orders', 'purchase-received', 'move-stocks', 'stock-status'].map((kind) => `/admin/inventory/${kind}`),
  ...['purchase-orders', 'purchase-received', 'move-stocks'].map((kind) => `/admin/inventory/${kind}/new`),
  ...['immunotherapy', 'kits-consumables', 'spt', 'lupin'].map((kind) => `/admin/orders/${kind}`),
  ...settings.map((tab) => `/admin/settings?tab=${tab}`),
];

// Measure the actual rendered DOM. An overflowing table is permitted only when
// an ancestor contains horizontal scrolling. Never ignore document overflow.
export async function measureLayout(page) {
  return page.evaluate(() => {
    const issues = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width + 1) issues.push(`document overflow ${document.documentElement.scrollWidth} > ${width}`);
    const scrolls = [];
    const visible = (node) => node.getClientRects().length && !node.closest('[inert], [aria-hidden="true"]');
    const contained = (node) => {
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return true;
      }
      return false;
    };
    for (const node of document.querySelectorAll('main h1, main h2, main button, main a, main input, main select, main textarea, [role="dialog"] button, [role="menu"], [role="listbox"]')) {
      if (!visible(node)) continue;
      const r = node.getBoundingClientRect();
      const label = `${node.tagName}.${String(node.className).slice(0, 80)} ${node.textContent?.trim().slice(0, 65)}`;
      if (r.width && !contained(node) && (r.left < -1 || r.right > width + 1)) issues.push(`outside viewport: ${label} (${Math.round(r.left)},${Math.round(r.right)})`);
      if (node.matches('button, h1, h2, a') && node.clientWidth && node.scrollWidth > node.clientWidth + 2 && getComputedStyle(node).overflowX !== 'auto') issues.push(`clipped label: ${label}`);
    }
    for (const node of document.querySelectorAll('main *')) {
      if (!visible(node) || node.clientWidth === 0 || !/auto|scroll/.test(getComputedStyle(node).overflowX) || node.scrollWidth <= node.clientWidth + 1) continue;
      node.scrollLeft = node.scrollWidth;
      const last = node.querySelector('tr:last-child td:last-child, tr:last-child th:last-child');
      if (last) {
        const box = node.getBoundingClientRect(), end = last.getBoundingClientRect();
        if (end.right > box.right + 2) issues.push('last table column unreachable');
      }
      scrolls.push({ className: node.className, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, end: node.scrollLeft });
      node.scrollLeft = 0;
    }
    const overflowNodes = issues.some((issue) => issue.startsWith('document overflow'))
      ? [...document.querySelectorAll('body *')].filter((node) => visible(node) && node.getBoundingClientRect().right > width + 1)
        .map((node) => ({ tag: node.tagName, class: String(node.className).slice(0, 120), text: node.textContent?.trim().slice(0, 80), right: node.getBoundingClientRect().right })).slice(0, 20)
      : [];
    return { issues: [...new Set(issues)], overflowNodes, scrolls, width, height: innerHeight };
  });
}
