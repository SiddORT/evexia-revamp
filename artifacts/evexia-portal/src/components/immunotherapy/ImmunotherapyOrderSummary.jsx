import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Eye, Pencil } from 'lucide-react';
import AdminLayout, { useOrderActions, useOrderBase, useOrderPortal } from '../orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../admin/adminPreferences.js';
import { DownloadOrderFile, OrderFileList } from '../orders/OrderFiles.jsx';
import { downloadPrescription, money, mrEditable, orderTotalMinor, parseAmount, prescriptionBlob } from '../../services/serverImmunotherapy.js';
import PrescriptionViewer from './PrescriptionViewer.jsx';
import '../../kitsOrders.css';
import './immunotherapyOrderSummary.css';

const saved = (value) => value === null || value === undefined || value === '' ? 'Not recorded' : value;
function Facts({ rows }) {
  return <dl className="kits-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{saved(value)}</dd></div>)}</dl>;
}
function Person({ person, patient = false }) {
  if (!person) return <p className="kits-unavailable">Historical details not recorded.</p>;
  const a = person.address || {};
  return <Facts rows={[
    ['Name', person.name], ...(patient ? [['Age', person.age], ['Gender', person.gender]] : []),
    ['Phone no.', person.phone], ['Address line 1', a.line1], ['Address line 2', a.line2],
    ['Landmark', a.landmark], ['Country', a.country], ['State', a.state], ['City', a.city], ['Pincode', a.pincode],
  ]} />;
}

export default function ImmunotherapyOrderSummary({ order }) {
  const can = useOrderActions('immunotherapy');
  const BASE = useOrderBase('immunotherapy');
  const { portal } = useOrderPortal();
  const { date } = useAdminDateFormatters();
  const mrPortal = portal === 'mr';
  const groups = order.groups || [];
  const legacy = (order.pricingBasis || 'legacy_bottle_mrp') === 'legacy_bottle_mrp';
  const [viewing, setViewing] = useState(null);
  const viewerOpener = useRef(null);
  return <AdminLayout title="IMMUNOTHERAPY"><div className="kits imm-saved-order">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders / Immunotherapy</p><h1>Order {order.number}</h1>
        <p className="admin-page-head__description">Read-only saved order with historical clinical, shipping and personal details.</p></div>
      <div className="imm-saved-order__actions">
        <Link href={BASE} className="admin-button admin-button--secondary" data-testid="button-imm-back"><ArrowLeft size={15} aria-hidden="true" />Back</Link>
        {can.edit && (!mrPortal || mrEditable(order)) && <Link href={`${BASE}/${order.id}/edit`} className="admin-button" data-testid="link-imm-to-edit"><Pencil size={15} aria-hidden="true" />Edit</Link>}
      </div>
    </div>
    {mrPortal && !mrEditable(order) && <p className="kits-boundary">This saved order is read-only for MR because it has Admin review or historical pricing data.</p>}
    <div className="kits-layout">
      <div className="kits-main">
        <section className="admin-panel kits-panel" aria-labelledby="imm-s-order"><h2 id="imm-s-order">Order details</h2>
          <Facts rows={[
            ['Order number', order.number], ['Date', order.date ? date(order.date) : null], ['Status', order.status],
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
          <p className="kits-hint">Original bottle membership and saved allergen details are retained; missing history is not inferred from current masters.</p>
          {groups.length ? groups.map((group, index) => <section className="imm-saved-order__bottle" key={group.id || index} aria-label={`Saved group ${index + 1}`}>
            <h3>Saved group {index + 1}</h3>
            <Facts rows={[['Internal group', group.id], ...(!mrPortal && legacy ? [['Legacy bottle MRP', money(parseAmount(group.mrp))]] : [])]} />
            {group.items?.length ? <ul className="imm-saved-order__allergens">{group.items.map((item, itemIndex) => <li key={`${item.allergenId}-${itemIndex}`}>
              <Facts rows={[
                ['Suborder ID', item.suborderId || 'Not assigned'], ['Allergen', item.allergen?.name], ['Allergen identity', item.allergenId],
                ['Concentration', item.allergen?.concentration], ['Skin test result (mm)', item.result],
                ...(!mrPortal ? [['Rate (INR)', money(parseAmount(item.rate))]] : []),
              ]} />
            </li>)}</ul> : <p className="kits-unavailable">No saved allergen details recorded for this bottle.</p>}
          </section>) : <p className="kits-unavailable">Historical bottle composition not recorded.</p>}
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
            ['Pricing basis', legacy ? 'Legacy bottle MRP' : 'Allergen rates'], ['Total', groups.length ? money(orderTotalMinor(order)) : 'Awaiting pricing'], ['PO number', order.poNumber],
            ['Saved review outcome', order.reviewDecision || (order.status === 'Confirmed' ? 'Awaiting Admin review' : 'Not recorded')],
          ]} />
          <p className="kits-hint">{legacy ? 'Legacy order: total is the sum of saved bottle MRPs.' : 'Total is the sum of saved allergen/suborder rates.'} Missing prices mean awaiting pricing, not zero. No tax, payment or invoice is inferred.</p>
        </section>}
      </div>
    </div>
    {viewing && <PrescriptionViewer file={viewing} load={prescriptionBlob} download={downloadPrescription} allowed={can.read_attachment} returnFocusRef={viewerOpener} onClose={() => setViewing(null)} />}
  </div></AdminLayout>;
}
