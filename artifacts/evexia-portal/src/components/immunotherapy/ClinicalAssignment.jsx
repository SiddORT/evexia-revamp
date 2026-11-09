// Immutable placement evidence, not an editor or a live settings lookup.
export default function ClinicalAssignment({ item }) {
  const evidence = item.clinicalAssignment;
  if (!['category_rank_v1', 'category_dosage_count_rank_v2'].includes(evidence?.policy)) return null;
  const doseSpecific = evidence.policy === 'category_dosage_count_rank_v2';
  const missing = evidence.extract == null || evidence.dilution == null;
  return <span className="imm-cell-sub">
    {doseSpecific ? `${evidence.dosage} · ${['', 'Single', 'Double', 'Triple'][evidence.compositionSize]} · ` : 'Legacy category-only · '}
    Placement rank {evidence.rank} · {evidence.configurationVersion === 0
      ? `${doseSpecific ? 'Category/dosage' : 'Category'} unconfigured at placement`
      : `Settings version ${evidence.configurationVersion}`}.
    {' '}Assigned extract: {evidence.extract ?? 'not recorded'} ml; dilution: {evidence.dilution ?? 'not recorded'} ml.
    {missing && ' Missing quantities require Admin completion before approval.'}
    {' '}Placement evidence is retained; current quantities may be manually edited.
  </span>;
}
