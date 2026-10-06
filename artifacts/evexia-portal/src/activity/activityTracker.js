import { getSession, reportingRequest, subscribeSession } from '../auth/adminSession.js';
import { subscribeLocalActivity, recordLocalAction } from '../services/localActivity.js';

const resources = {
  zones: 'zone', 'courier-partners': 'courier_partner', 'storage-locations': 'storage_location',
  headquarters: 'headquarter', mrs: 'mr', doctors: 'doctor', patients: 'patient',
  designations: 'designation', 'product-categories': 'product_category', allergens: 'allergen',
  vendors: 'vendor', 'sales-targets': 'sales_target', 'opening-balances': 'opening_balance',
};
export function pageResource(path) {
  // Never transmit paths, query/fragment strings, names, record IDs or form data.
  const clean = String(path).split(/[?#]/, 1)[0];
  if (clean === '/admin') return 'dashboard';
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] !== 'admin' || parts[1] === 'login') return null;
  if (parts[1] === 'masters') return resources[parts[2]] || 'masters';
  if (parts[1] === 'inventory') return parts[2] === 'purchase-orders' ? 'purchase_order' : parts[2] === 'purchase-received' ? 'purchase_received' : null;
  if (parts[1] === 'staff') return 'staff';
  if (parts[1] === 'roles-permissions') return 'roles_permissions';
  if (parts[1] === 'activity-logs') return 'activity_logs';
  if (parts[1] === 'settings') {
    if (parts[2] === 'communication') return 'communication';
    if (parts[2] === 'message-templates') return 'message_template';
    return 'settings';
  }
  return null;
}
const actions = new Set(['page_view', 'created', 'updated', 'deleted', 'imported', 'exported', 'settings_changed']);
let queue = [], started = false, inFlight = null, timer = null, epoch = 0, lastPage = null, attempts = 0;
let lostReports = false;
let status = Object.freeze({ error: false });
const listeners = new Set();
const publish = (error) => { status = Object.freeze({ error: error || lostReports }); listeners.forEach((f) => f()); };
export const getActivityStatus = () => status;
export const subscribeActivityStatus = (f) => { listeners.add(f); return () => listeners.delete(f); };
const authorized = () => getSession().status === 'authenticated' && getSession().user?.system_role === 'super_admin';
function enqueue(event) {
  if (!authorized() || !actions.has(event.action)) return;
  if (queue.length >= 100) { lostReports = true; publish(true); return; }
  queue.push({ event_id: crypto.randomUUID(), action: event.action, resource: event.resource });
  if (!timer && !inFlight) timer = setTimeout(() => { timer = null; void flushActivity(); }, 200);
}
export async function flushActivity() {
  if (inFlight || !authorized() || !queue.length) return inFlight;
  clearTimeout(timer); timer = null;
  const ownEpoch = epoch, batch = queue.slice(0, 20);
  inFlight = (async () => {
    try {
      await reportingRequest('activity', { events: batch });
      if (ownEpoch !== epoch) return;
      queue.splice(0, batch.length);
      attempts = 0;
      publish(false);
      window.dispatchEvent(new Event('evexia-admin-activity-recorded'));
    } catch {
      if (ownEpoch !== epoch) return;
      publish(true);
      attempts += 1;
    } finally {
      inFlight = null;
      if (authorized() && queue.length && attempts < 3) {
        timer = setTimeout(() => { timer = null; void flushActivity(); }, attempts ? 3000 * attempts : 200);
      }
    }
  })();
  return inFlight;
}
export function retryActivity() { attempts = 0; void flushActivity(); }
export function flushActivityBeforeExit() {
  if (!authorized()) return Promise.resolve();
  // Dispatch before local logout clears authorization. Each request is bound to
  // the original generation/user and has an idempotent server-side event key.
  const reports = [...queue];
  const tasks = [];
  for (let offset = 0; offset < reports.length; offset += 20) {
    tasks.push(reportingRequest('activity', { events: reports.slice(offset, offset + 20) }));
  }
  return Promise.allSettled(tasks);
}
export function startActivityTracking() {
  if (started) return;
  started = true;
  window.addEventListener('pagehide', () => { void flushActivityBeforeExit(); });
  subscribeLocalActivity(enqueue);
  subscribeSession(() => {
    // Renewal keeps the queue, but logout/denial/new explicit login must never
    // reattribute observations to a different authenticated session.
    if (['anonymous', 'checking', 'idle', 'error'].includes(getSession().status)) {
      epoch += 1; queue = []; lastPage = null; attempts = 0; lostReports = false; clearTimeout(timer); timer = null; publish(false);
    } else if (authorized() && queue.length && !inFlight) void flushActivity();
  });
}
export function recordPageVisit(path) {
  startActivityTracking();
  const resource = pageResource(path);
  const clean = String(path).split(/[?#]/, 1)[0];
  if (!authorized() || !resource || lastPage === clean) return;
  lastPage = clean;
  recordLocalAction(resource, 'page_view');
}
