/** Display grouping only: lot identities, never batch names, own allocations. */
import { quantityHundredths, renderHundredths } from './quantities.js';

/** Read-only presence check, without rounding or imposing per-entry quantity limits. */
export function hasRemainingQuantity(value) {
  const text = String(value ?? '');
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && /[1-9]/.test(text);
}

/** Saved calendar dates from remaining physical allocations only, not original openings. */
export function stockExpiryPresentation(allocations = []) {
  const remaining = allocations.filter((lot) => hasRemainingQuantity(lot.quantity));
  return {
    dates: [...new Set(remaining.map((lot) => lot.expiryDate).filter(Boolean))].sort(),
    hasUndated: remaining.some((lot) => !lot.expiryDate),
  };
}

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
