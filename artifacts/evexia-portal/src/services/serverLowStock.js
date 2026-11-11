import { inventoryRequest, purchaseOrderRequest } from '../auth/adminSession.js';

const email = (value) => value === null || (typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
const uncertain = () => Object.assign(new Error('The server response could not be confirmed. Your edit is kept; check the save outcome.'), { ambiguous: true });
const savedView = (data) => {
  if (!data || !Number.isSafeInteger(data.version) || data.version < 0 || !email(data.additional_email)) throw uncertain();
  return data;
};
export async function listLowStock(params, signal) {
  const data = await inventoryRequest('/low-stock-alerts', { params, signal });
  if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.filtered) || data.filtered < data.items.length
      || !Number.isSafeInteger(data.total) || data.total < data.filtered || !data.asOf
      || data.items.some((r) => !r || !/^[0-9a-f-]{36}$/i.test(r.productId) || typeof r.name !== 'string'
        || typeof r.category !== 'string' || typeof r.quantity !== 'string' || !r.unit || !r.reason
        || !(r.thresholdLimit === null || typeof r.thresholdLimit === 'string'))) {
    throw new Error('A complete low-stock response was not available. No zero quantities or empty result can be inferred.');
  }
  return data;
}
const request = (path, options) => purchaseOrderRequest(path, options, 'low-stock-settings');
export const loadLowStockSettings = async () => savedView(await request('', {}));
export async function saveLowStockSettings(body) {
  const result = await request('', { body });
  savedView(result?.saved);
  if (result.outcome !== 'committed' || result.committed_version !== body.expected_version + 1
      || result.saved.version !== result.committed_version
      || (result.saved.additional_email || '').toLowerCase() !== (body.additional_email || '').trim().toLowerCase()) throw uncertain();
  return result;
}
export async function reconcileLowStockSettings(key) {
  const result = await request(`/requests/${key}/reconcile`, { body: {} });
  savedView(result?.saved);
  if (!['committed', 'cancelled'].includes(result.outcome) ||
      (result.outcome === 'committed' && !Number.isSafeInteger(result.committed_version))) throw uncertain();
  return result;
}
