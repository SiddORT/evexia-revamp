export const MR_GROUPING_POLICY = 'mr_category_mix_v1';
export const hasGroupingMetadata = (a) => Boolean(a?.categoryId && typeof a.mix === 'boolean');

// Entry-only planning. These local keys are never displayed as issued SUB IDs.
// selectionOrder survives category reordering and incomplete draft serialization.
export function arrangeMRSelections(items) {
  const selected = items.map((item, index) => ({ ...item, selectionOrder: item.selectionOrder ?? index }))
    .sort((a, b) => a.selectionOrder - b.selectionOrder);
  const groups = [], batches = new Map();
  for (const item of selected) {
    const basis = item.allergen;
    const known = hasGroupingMetadata(basis);
    let group = known && basis.mix ? batches.get(basis.categoryId) : null;
    if (!group || group.items.length === 3 || group.items.some((i) => i.allergenId === item.allergenId)) {
      group = { id: `entry-group-${groups.length + 1}`, mrp: '', items: [] };
      groups.push(group);
      if (known && basis.mix) batches.set(basis.categoryId, group);
    }
    group.items.push(item);
  }
  return groups.length ? groups : [{ id: 'entry-group-1', mrp: '', items: [] }];
}

export function mrCompositionError(items) {
  const bases = items.map((i) => i.groupingBasis || i.allergen);
  if (items.length > 3) return 'A grouped SUB can contain at most three allergens.';
  if (bases.some((b) => !hasGroupingMetadata(b))) return 'Grouping metadata is unavailable. Reselect the new allergen or retry its reference.';
  if (items.length > 1 && (!bases.every((b) => b.mix) || new Set(bases.map((b) => b.categoryId)).size !== 1)) {
    return 'Only Mix allergens from the same category can share a SUB. No Mix allergens must remain alone.';
  }
  return '';
}
