/** Display grouping only: lot identities, never batch names, own allocations. */
export function groupStockLots(allocations = []) {
  const groups = new Map();
  allocations.forEach((allocation, index) => {
    const key = allocation.lotId || `missing-lot-${index}`;
    if (!groups.has(key)) groups.set(key, { key, lot: allocation, allocations: [], total: 0n, complete: true });
    const group = groups.get(key);
    group.allocations.push(allocation);
    const quantity = String(allocation.quantity ?? '');
    if (!/^\d+(?:\.\d{1,3})?$/.test(quantity)) group.complete = false;
    else {
      const [whole, fraction = ''] = quantity.split('.');
      group.total += BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
    }
  });
  return [...groups.values()].map(({ total, ...group }) => ({
    ...group,
    quantity: group.complete ? `${total / 1000n}.${String(total % 1000n).padStart(3, '0')}` : 'Quantity unavailable',
  }));
}
