// Immutable placement evidence, not an editor or a live settings lookup.
export default function ClinicalAssignment({ item }) {
  const evidence = item.clinicalAssignment;
  if (evidence?.policy !== 'category_rank_v1') return null;
  const missing = evidence.extract == null || evidence.dilution == null;
  return <span className="imm-cell-sub">
    Placement rank {evidence.rank} · {evidence.configurationVersion === 0
      ? 'Category unconfigured at placement'
      : `Category settings version ${evidence.configurationVersion}`}.
    {' '}Assigned extract: {evidence.extract ?? 'not recorded'} ml; dilution: {evidence.dilution ?? 'not recorded'} ml.
    {missing && ' Missing quantities require Admin completion before approval.'}
    {' '}Placement evidence is retained; current quantities may be manually edited.
  </span>;
}
