import { money } from '../../services/serverImmunotherapy.js';
import { displayQuantity as qty } from '../../services/quantities.js';

export default function MaterialPricingEvidence({ order, mr = false }) {
  const evidence = order.pricingEvidence;
  const consumption = order.materialConsumption;
  const countPrice = evidence?.policy === 'category_count_total_mrp_v1';
  return <section className="admin-panel kits-panel" aria-label="Saved material pricing and consumption">
    <h2>Saved pricing and material consumption</h2>
    {!evidence ? <p>Historical/manual pricing. No configured material-price snapshot or retrospective consumption is inferred.</p> : <>
      <p>Effective order date: {evidence.orderDate}. Saved total: {money(evidence.totalMinor)}. {countPrice ? 'Each Total Suborder MRP is applied once. Extract and Dilution ml are inventory quantities, not extra charges.' : 'Quantities are ml; each charge is rounded half-up to two decimal places.'}</p>
      {!mr && evidence.groups.map((group, index) => <div key={index}>
        <h3>{order.groups[index]?.id || `Saved bottle ${index + 1}`} — ₹{group.amount}</h3>
        {countPrice && <p>Total Suborder MRP: ₹{group.amount}. {group.categoryName}; {group.tariff.allergenCount} clinical allergens.
          {' '}Effective from {group.tariff.effectiveFrom}; revision {group.tariff.id}, version {group.tariff.version}.
          {' '}Saved by {group.tariff.actorId} at {group.tariff.recordedAt}.</p>}
        <ul>{group.components.map((component, position) => <li key={position}>
          {countPrice ? <>{component.name}: {qty(component.quantityMl)} ml ({component.kind === 'dilution' ? 'separate Dilution material' : 'Extract'}; no separate charge).</> : <>
          {component.name} ({component.kind === 'dilution' ? 'separate Dilution material' : 'Extract'}): {qty(component.quantityMl)} ml × ₹{qty(component.ratePerMl)}/ml = ₹{qty(component.amount)}.
          {' '}Category: {component.categoryName}. Rule {component.ruleId}, version {component.ruleVersion};
          {' '}{component.branch === 'before' ? 'before' : 'on/after'} cutoff {component.cutoff}.
          </>}
        </li>)}</ul>
      </div>)}
      {!mr && countPrice && evidence.quantityCorrections?.length > 0 && <details>
        <summary>Explicit quantity corrections ({evidence.quantityCorrections.length})</summary>
        <ul>{evidence.quantityCorrections.map((revision, i) => <li key={i}>Actor {revision.actorId} at {revision.recordedAt}.
          Original ranked assignment evidence is retained; the dated Total Suborder MRP was not changed.</li>)}</ul>
      </details>}
      {!mr && countPrice && evidence.previousQuote && <p>Previous confirmed quote evidence is retained with this explicit refresh. Saved assignment values were not reapplied from current settings.</p>}
    </>}
    <p>{consumption ? `Consumed on explicit Admin approval at ${consumption.at}. Returns do not automatically restock these materials.`
      : evidence ? 'Not consumed. No deduction or reservation at placement; explicit Admin approval requires sufficient allocated usable stock.'
        : 'No order-linked consumption recorded. Historical In process orders are not retrospectively deducted.'}</p>
    {consumption && <ul>{consumption.materials.map((material) => <li key={material.materialId}>{material.name}: {qty(material.quantityMl)} ml consumed</li>)}</ul>}
    {!mr && consumption && <>
      <p>Ledger source: {consumption.source}. Approval version: {consumption.transitionVersion}. Actor: {consumption.actorId}.</p>
      <ul>{consumption.allocations.map((allocation, index) => <li key={index}>{allocation.name}: {qty(allocation.quantityMl)} ml from lot {allocation.lotId},
        {' '}{allocation.locationName}; batch {allocation.batchNo || 'Unavailable'}; expiry {allocation.expiryDate}; balance {qty(allocation.before)} → {qty(allocation.after)} ml.</li>)}</ul>
    </>}
  </section>;
}
