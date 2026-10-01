const milli = (v) => {
  const n = Math.round(Number(v) * 1000);
  if (v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(n)) throw new Error(`Invalid quantity in saved receiving data: ${JSON.stringify(v)}`);
  return n;
};
const out = (m) => m / 1000;

export function rollupPOReceiving(po, receipts, balances = null) {
  const active = (receipts || []).filter((r) => r.poId === po?.id && r.status === 'active');
  const lines = (po?.lines || []).map((line) => {
    let received = 0, accepted = 0, rejected = 0;
    for (const r of active) for (const l of r.lines) if (l.lineId === line.id) {
      received += milli(l.receivedQty); accepted += milli(l.acceptedQty); rejected += milli(l.rejectedQty);
    }
    const ordered = milli(line.quantity);
    const remaining = balances && balances[line.id] !== undefined ? milli(balances[line.id]) : Math.max(0, ordered - accepted);
    return { lineId: line.id, productId: line.productId, productName: line.productName, ordered: out(ordered), received: out(received), accepted: out(accepted), rejected: out(rejected), remaining: out(remaining) };
  });
  return { lines };
}

export function createPRState(po, rollup) {
  if (!po) return { enabled: false, reason: 'Purchase order unavailable.' };
  if (po.status !== 'open') return { enabled: false, reason: 'Deleted purchase orders cannot receive goods.' };
  if (!rollup.lines.some((l) => l.remaining > 0)) return { enabled: false, reason: 'Fully accepted: no outstanding quantity remains.' };
  return { enabled: true, reason: '' };
}
