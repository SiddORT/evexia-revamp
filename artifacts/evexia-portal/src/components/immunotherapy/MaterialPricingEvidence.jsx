import { money } from '../../services/serverImmunotherapy.js';

export default function MaterialPricingEvidence({ order, mr = false }) {
  const evidence = order.pricingEvidence;
  const consumption = order.materialConsumption;
  return <section className="admin-panel kits-panel" aria-label="Saved material pricing and consumption">
    <h2>Saved pricing and material consumption</h2>
    {!evidence ? <p>Historical/manual pricing. No configured material-price snapshot or retrospective consumption is inferred.</p> : <>
      <p>Effective order date: {evidence.orderDate}. Saved total: {money(evidence.totalMinor)}. Quantities are ml; each charge is rounded half-up to two decimal places.</p>
      {!mr && evidence.groups.map((group, index) => <div key={index}>
        <h3>{order.groups[index]?.id || `Saved bottle ${index + 1}`} — ₹{group.amount}</h3>
        <ul>{group.components.map((component, position) => <li key={position}>
          {component.name} ({component.kind === 'dilution' ? 'separate Dilution material' : 'Extract'}): {component.quantityMl} ml × ₹{component.ratePerMl}/ml = ₹{component.amount}.
          {' '}Category: {component.categoryName}. Rule {component.ruleId}, version {component.ruleVersion};
          {' '}{component.branch === 'before' ? 'before' : 'on/after'} cutoff {component.cutoff}.
        </li>)}</ul>
      </div>)}
    </>}
    <p>{consumption ? `Consumed on explicit Admin approval at ${consumption.at}. Returns do not automatically restock these materials.`
      : evidence ? 'Not consumed. No deduction or reservation at placement; explicit Admin approval requires sufficient allocated usable stock.'
        : 'No order-linked consumption recorded. Historical In process orders are not retrospectively deducted.'}</p>
    {consumption && <ul>{consumption.materials.map((material) => <li key={material.materialId}>{material.name}: {material.quantityMl} ml consumed</li>)}</ul>}
    {!mr && consumption && <>
      <p>Ledger source: {consumption.source}. Approval version: {consumption.transitionVersion}. Actor: {consumption.actorId}.</p>
      <ul>{consumption.allocations.map((allocation, index) => <li key={index}>{allocation.name}: {allocation.quantityMl} ml from lot {allocation.lotId},
        {' '}{allocation.locationName}; batch {allocation.batchNo || 'Unavailable'}; expiry {allocation.expiryDate}; balance {allocation.before} → {allocation.after} ml.</li>)}</ul>
    </>}
  </section>;
}
