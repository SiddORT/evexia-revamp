import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Eye, Pencil } from 'lucide-react';
import AdminLayout, { useOrderActions, useOrderBase, useOrderPortal } from '../orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../admin/adminPreferences.js';
import { DownloadOrderFile, OrderFileList } from '../orders/OrderFiles.jsx';
import { downloadPrescription, money, mrEditable, orderLocked, orderTotalMinor, orderBatchLabel, parseAmount, prescriptionBlob, request } from '../../services/serverImmunotherapy.js';
import OrderApproval from '../orders/OrderApproval.jsx';
import PrescriptionViewer from './PrescriptionViewer.jsx';
import { MR_GROUPING_POLICY } from '../../services/immunotherapyGrouping.js';
import ClinicalAssignment from './ClinicalAssignment.jsx';
import MaterialPricingEvidence from './MaterialPricingEvidence.jsx';
import { displayQuantity } from '../../services/quantities.js';
import '../../kitsOrders.css';
import './immunotherapyOrderSummary.css';

const saved = (value) => value === null || value === undefined || value === '' ? 'Not recorded' : value;
function Facts({ rows, compact = false }) {
  return <dl className={`kits-facts${compact ? ' imm-saved-order__facts-grid' : ''}`}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{saved(value)}</dd></div>)}</dl>;
}
function Person({ person, patient = false }) {
  if (!person) return <p className="kits-unavailable">Historical details not recorded.</p>;
  const a = person.address || {};
  const address = [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country]
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== '')
    .join(', ');
  return <Facts rows={[
    ['Name', person.name], ...(patient ? [['Age', person.age], ['Gender', person.gender]] : []),
    ['Phone no.', person.phone], ['Address', address],
  ]} />;
}

export default function ImmunotherapyOrderSummary({ order: initialOrder }) {
  const [order, setOrder] = useState(initialOrder);
  const can = useOrderActions('immunotherapy');
  const BASE = useOrderBase('immunotherapy');
  const { portal } = useOrderPortal();
  const { date } = useAdminDateFormatters();
  const mrPortal = portal === 'mr';
  const groups = order.groups || [];
  const displayGroups = mrPortal && groups.length
    ? [{ id: 'mr-allergens', items: groups.flatMap((group) => group.items || []) }]
    : groups;
  const canonical = order.pricingBasis === 'suborder_mrp_v1';
  const legacy = (order.pricingBasis || 'legacy_bottle_mrp') === 'legacy_bottle_mrp';
  const [viewing, setViewing] = useState(null);
  const viewerOpener = useRef(null);
  return <AdminLayout title="IMMUNOTHERAPY"><div className="kits imm-saved-order">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders / Immunotherapy</p><h1>Order {order.number}</h1>
        <p className="admin-page-head__description">Read-only saved order with historical clinical, shipping and personal details.</p></div>
      <div className="imm-saved-order__actions">
        <Link href={BASE} className="admin-button admin-button--secondary" data-testid="button-imm-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link>
        {can.edit && !orderLocked(order) && (!mrPortal || mrEditable(order)) && <Link href={`${BASE}/${order.id}/edit`} className="admin-button" data-testid="link-imm-to-edit"><Pencil size={15} aria-hidden="true" />Edit</Link>}
      </div>
    </div>
    {mrPortal && !mrEditable(order) && <p className="kits-boundary">This order has been reviewed or closed and is read-only for MR.</p>}
    <OrderApproval kind="immunotherapy" order={order} request={request} onApproved={setOrder} />
    <div className="kits-layout">
      <div className="kits-main">
        <MaterialPricingEvidence order={order} mr={mrPortal} />
        <section className="admin-panel kits-panel" aria-labelledby="imm-s-order"><h2 id="imm-s-order">Order details</h2>
          <Facts compact rows={[
            ['Order number', order.number], ['Date', order.date ? date(order.date) : null], ['Status', order.status],
            ['Order Batch No', orderBatchLabel(order)],
            ['Patient', order.patient?.name], ['Doctor', order.doctor?.name], ['MR', order.mr?.name],
            ['Dosage', order.dosage], ['Histamine (mm)', order.histamine], ['Saline (mm)', order.saline],
            // Keep MR's existing saved value/decision/PO presentation, without
            // adding the Admin-only per-bottle and per-allergen financial detail.
            ...(mrPortal ? [
              ['Value', groups.length ? money(orderTotalMinor(order)) : 'Awaiting pricing'],
              ['Saved review outcome', order.reviewDecision || (order.status === 'Confirmed' ? 'Awaiting Admin review' : 'Not recorded')],
              ['Saved PO number', order.poNumber],
            ] : []),
          ]} />
          <p className="kits-hint">Saved order facts only; order status is not evidence of treatment administration.</p>
        </section>
        <section className="admin-panel kits-panel" aria-labelledby="imm-s-allergens"><h2 id="imm-s-allergens">Saved allergen composition and results</h2>
          {!mrPortal && <p className="kits-hint">Saved SUB or original bottle membership and allergen details are retained; missing history is not inferred from current masters.</p>}
          {displayGroups.length ? displayGroups.map((group, index) => <section className={mrPortal ? undefined : 'imm-saved-order__bottle'} key={group.id || index} aria-label={mrPortal ? 'Saved allergens' : `Saved group ${index + 1}`}>
            {!mrPortal && <h3>{canonical ? `Suborder ${group.id}` : `Saved group ${index + 1}`}</h3>}
            {!mrPortal && group.compositionPolicy === MR_GROUPING_POLICY && <p className="kits-hint">Saved MR category/Mix grouping. This membership and SUB identity do not change when masters change.</p>}
            {!mrPortal && <Facts rows={[['Internal group', group.id], ...(legacy ? [['Legacy bottle MRP', money(parseAmount(group.mrp))]] : canonical ? [['MRP', money(parseAmount(group.mrp))]] : [])]} />}
            {group.items?.length ? <ul className="imm-saved-order__allergens">{group.items.map((item, itemIndex) => <li key={`${item.allergenId}-${itemIndex}`}>
              <Facts compact rows={[
                ...(!mrPortal && !canonical ? [['Suborder ID', item.suborderId || 'Not assigned']] : []), ['Allergen', item.allergen?.name],
                ...(!mrPortal ? [['Allergen identity', item.allergenId]] : []),
                ['Concentration', item.allergen?.concentration], ['Skin test result (mm)', item.result],
                ...(canonical ? [['Extract (ml)', item.extract == null ? 'Not recorded' : displayQuantity(item.extract)], ['Dilution (ml)', item.dilution == null ? 'Not recorded' : displayQuantity(item.dilution)]]
                  : !mrPortal ? [['Rate (INR)', money(parseAmount(item.rate))]] : []),
              ]} />
              {!mrPortal && <ClinicalAssignment item={item} />}
            </li>)}</ul> : <p className="kits-unavailable">No saved allergen details recorded.</p>}
          </section>) : <p className="kits-unavailable">Historical bottle composition not recorded.</p>}
          {canonical && !mrPortal && order.historicalGroups?.length > 0 && <details className="imm-history"><summary>Original grouping and pricing provenance (read-only)</summary>
            <p>Original pricing basis: {order.historicalPricingBasis || 'Not recorded'}. Original total: {money(order.historicalTotalMinor == null ? null : BigInt(order.historicalTotalMinor))}.</p>
            {order.historicalGroups.map((g) => <section key={g.id}><h3>Original group {g.id}</h3><p>Original bottle MRP: {g.mrp ?? 'Not recorded'}</p><ul>{g.items.map((i, n) => <li key={n}>{i.suborderId || 'Not assigned'} — {i.allergen?.name || 'Not recorded'}; original result {i.result ?? 'Not recorded'} mm; original rate INR {i.rate ?? 'Not recorded'}</li>)}</ul></section>)}
          </details>}
        </section>
        <section className="admin-panel kits-panel" aria-labelledby="imm-s-more"><h2 id="imm-s-more">Remarks and prescriptions</h2>
          <Facts rows={[['Remarks', order.remarks || 'None']]} />
          <h3>Private prescription files</h3>
          <OrderFileList label="Saved prescription files" empty="No prescription files recorded for this historical order.">
            {(order.attachments || []).map((file) => <DownloadOrderFile key={file.id} file={file} allowed={can.read_attachment}
              download={downloadPrescription} status="Saved prescription"
              actions={can.read_attachment && !file.restricted && file.state === 'verified'
                ? <button type="button" className="admin-button admin-button--secondary" onClick={(event) => { viewerOpener.current = event.currentTarget; setViewing(file); }} aria-label={`View ${file.name}`}><Eye size={15} aria-hidden="true" />View</button>
                : null} />)}
          </OrderFileList>
        </section>
      </div>
      <div className="kits-side">
        <section className="admin-panel kits-panel"><h2>Shipping ({order.shipping === 'patient' ? 'Patient' : order.shipping === 'doctor' ? 'Doctor' : 'Not recorded'})</h2><Person person={order.recipient} /></section>
        <section className="admin-panel kits-panel"><h2>Patient (historical)</h2><Person person={order.patient} patient /></section>
        <section className="admin-panel kits-panel"><h2>Billing doctor (historical)</h2><Person person={order.doctor} /></section>
        <section className="admin-panel kits-panel"><h2>MR (historical)</h2><Person person={order.mr} /></section>
        {!mrPortal && <section className="admin-panel kits-panel" aria-labelledby="imm-s-review"><h2 id="imm-s-review">Pricing and Admin review</h2>
          <Facts rows={[
            ['Pricing basis', legacy ? 'Legacy bottle MRP' : canonical ? 'Suborder MRP' : 'Allergen rates'], ['Total', groups.length ? money(orderTotalMinor(order)) : 'Awaiting pricing'], ['PO number', order.poNumber],
            ['Saved review outcome', order.reviewDecision || (order.status === 'Confirmed' ? 'Awaiting Admin review' : 'Not recorded')],
          ]} />
          <p className="kits-hint">{canonical ? 'Total is the sum of each suborder MRP, counted once.' : legacy ? 'Legacy order: total is the sum of saved bottle MRPs.' : 'Total is the sum of saved allergen/suborder rates.'} Missing prices mean awaiting pricing, not zero. No tax, payment or invoice is inferred.</p>
        </section>}
      </div>
    </div>
    {viewing && <PrescriptionViewer file={viewing} load={prescriptionBlob} download={downloadPrescription} allowed={can.read_attachment} returnFocusRef={viewerOpener} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
