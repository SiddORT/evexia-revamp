/** Display grouping only: lot identities, never batch names, own allocations. */
import { quantityHundredths, renderHundredths } from './quantities.js';
export function groupStockLots(allocations = []) {
  const groups = new Map();
  allocations.forEach((allocation, index) => {
    const key = allocation.lotId || `missing-lot-${index}`;
    if (!groups.has(key)) groups.set(key, { key, lot: allocation, allocations: [], total: 0n, complete: true });
    const group = groups.get(key);
    group.allocations.push(allocation);
    const quantity = String(allocation.quantity ?? '');
    try { group.total += quantityHundredths(quantity); } catch { group.complete = false; }
  });
  return [...groups.values()].map(({ total, ...group }) => ({
    ...group,
    quantity: group.complete ? renderHundredths(total) : 'Quantity unavailable',
  }));
}
