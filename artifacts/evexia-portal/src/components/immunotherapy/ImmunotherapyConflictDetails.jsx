const recorded = (value) => value === null || value === undefined || value === '' ? 'Not recorded' : value;

// Explicit MR presentation, never a serialization of the underlying record.
// The caller retains the complete saved version and draft for reconciliation.
export default function ImmunotherapyConflictDetails({ order, patient, doctor, mr }) {
  const rows = [
    ['Order number', order.number], ['Patient', patient?.name],
    ['Doctor', doctor?.name], ['MR', mr?.name], ['Dosage', order.dosage],
    ['Histamine (mm)', order.histamine], ['Saline (mm)', order.saline],
    ['Ship to', order.shipping === 'doctor' ? 'Doctor' : order.shipping === 'patient' ? 'Patient' : null],
    ['Status', order.status], ['PO number', order.poNumber], ['Remarks', order.remarks],
  ];
  return <div>
    <dl className="imm-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{recorded(value)}</dd></div>)}</dl>
    {(order.groups || []).map((group, index) => <section key={group.id || index} aria-label={`Saved group ${index + 1}`}>
      <h3>{order.pricingBasis === 'suborder_mrp_v1' ? `Suborder ${group.id}` : `Saved group ${index + 1}`}</h3>
      {group.items?.length ? <ul>{group.items.map((item, itemIndex) => <li key={itemIndex}>
        <strong>{item.allergen?.name || 'Allergen name unavailable'}</strong>
        <dl className="imm-facts">
          <div><dt>Suborder ID</dt><dd>{order.pricingBasis === 'suborder_mrp_v1' ? group.id : item.suborderId || 'Not assigned'}</dd></div>
          <div><dt>Concentration</dt><dd>{recorded(item.allergen?.concentration)}</dd></div>
          <div><dt>Skin test result (mm)</dt><dd>{recorded(item.result)}</dd></div>
          {order.pricingBasis === 'suborder_mrp_v1' && <><div><dt>Extract (ml)</dt><dd>{recorded(item.extract)}</dd></div><div><dt>Dilution (ml)</dt><dd>{recorded(item.dilution)}</dd></div></>}
        </dl>
      </li>)}</ul> : <p>No allergens recorded.</p>}
    </section>)}
    <h3>Prescription files</h3>
    {order.attachments?.length ? <ul>{order.attachments.map((file) => <li key={file.id}>
      {file.restricted ? 'Restricted attachment' : file.name || 'Unnamed attachment'}
    </li>)}</ul> : <p>No prescription files recorded.</p>}
  </div>;
}
