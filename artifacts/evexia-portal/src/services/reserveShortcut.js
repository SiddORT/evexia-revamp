/** Read-only exact-reserve resolution. Dependencies keep race checks deterministic. */
export async function resolveReserveShortcut(values, { getReserve, getLocations, pending, isCurrent }) {
  const check = () => {
    if (!isCurrent()) return false;
    if (pending()) throw new Error('A previous movement needs recovery. The reserve shortcut was not applied; no draft was replaced.');
    return true;
  };
  if (!check()) return null;
  if (values.length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values[0]))
    throw new Error('Invalid reserve shortcut. Open the exact reserve from In-house Stock again.');
  const record = await getReserve(values[0]);
  if (!check()) return null;
  if (record.id !== values[0] || record.reserveOnly !== true)
    throw new Error('The requested reserve could not be verified. No batch was selected.');
  const locations = [];
  let offset = 0;
  while (true) {
    const page = await getLocations({ offset, limit: 100 });
    if (!check()) return null;
    locations.push(...page.items); offset += page.items.length;
    if (!page.items.length || offset >= page.filtered) break;
  }
  const options = (record.locationBalances || []).filter((b) => /^[0-9]+(?:\.[0-9]+)?$/.test(b.quantity) && /[1-9]/.test(b.quantity))
    .filter((b) => locations.some((l) => l.id === b.locationId))
    .map((b) => ({ value: b.locationId, label: b.locationName, quantity: b.quantity }));
  if (!options.length)
    throw new Error('This reserve is depleted or has no accessible active source location. Refresh In-house Stock; no other batch was selected.');
  return { reserveId: record.id, options };
}
