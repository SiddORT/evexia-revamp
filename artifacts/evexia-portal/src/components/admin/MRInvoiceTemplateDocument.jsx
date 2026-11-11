import '../../mrInvoiceTemplate.css';
import { money, termLines } from '../../services/mrInvoiceTemplates.js';

const logoUrl = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

const MISSING = {
  restricted: 'Issuer, license, bank and legal details are managed in protected Invoice Details configuration.',
  loading: 'Loading saved Invoice Details…',
  unavailable: 'Saved Invoice Details are unavailable. Retry loading above.',
  unconfigured: 'Invoice Details are not configured. Add them in Settings → Invoice Details.',
};

function Value({ value, empty = 'Not set' }) {
  return value ? <span className="mri-value">{value}</span> : <span className="mri-empty">{empty}</span>;
}

function Row({ label, value }) {
  return <div className="mri-row"><dt>{label}</dt><dd><Value value={value} /></dd></div>;
}

// Deliberately non-scannable: a hatched frame, never an image of any payment QR.
function QRPlaceholder({ configured }) {
  return <div className="mri-qr" role="img" aria-label="Sample QR placeholder, not scannable">
    <span>QR placeholder</span>
    <small>Not scannable · sample review</small>
    {configured && <small>Saved QR is kept in protected settings only</small>}
  </div>;
}

export default function MRInvoiceTemplateDocument({ document: doc, compact = false }) {
  const { transaction: t, details: d } = doc;
  const missing = !d ? MISSING[doc.access === 'protected' ? 'unconfigured' : doc.access] || MISSING.restricted : '';
  const terms = termLines(d?.terms);
  return <div className={`mri-frame${compact ? ' mri-frame--compact' : ''}`}>
    <article className={`mri mri--${doc.style}`} aria-label={`Sample MR invoice, ${doc.style === 'classic' ? 'Reference Classic' : 'Modern Professional'} style`}>
      <div className="mri-banner">Sample · Not an issued invoice</div>
      <header className="mri-head">
        <img src={logoUrl} alt="EVEXIA" className="mri-logo" />
        <div className="mri-issuer">
          {d ? <>
            <strong className="mri-company"><Value value={d.company_name} empty="Company name not set" /></strong>
            {d.address && <p className="mri-pre">{d.address}</p>}
            <p className="mri-contact">
              {[d.email && `Email: ${d.email}`, d.website && `Web: ${d.website}`, d.customer_care && `Customer care: ${d.customer_care}`].filter(Boolean).join('  ·  ') || <span className="mri-empty">Contact details not set</span>}
            </p>
            {(d.gstin || d.pan) && <p className="mri-contact">{[d.gstin && `GSTIN: ${d.gstin}`, d.pan && `PAN: ${d.pan}`].filter(Boolean).join('  ·  ')}</p>}
          </> : <p className="mri-prompt">{missing}</p>}
        </div>
        <div className="mri-title"><span>Invoice</span><small>Version {doc.version ?? '—'} details</small></div>
      </header>

      <section className="mri-panels">
        <div className="mri-panel"><h4>Billed to doctor</h4><p><strong>{t.doctor.name}</strong></p><p>{t.doctor.clinic}</p><p>{t.doctor.city}</p></div>
        <div className="mri-panel"><h4>Patient</h4><p><strong>{t.patient.name}</strong></p><p>Ref: {t.patient.ref}</p><p>Age: {t.patient.age}</p></div>
        <div className="mri-panel"><h4>Invoice details</h4>
          <dl><Row label="Invoice no." value={t.invoiceNo} /><Row label="Order no." value={t.orderNo} /><Row label="Date" value={t.date} /><Row label="Supply date" value={t.supplyDate} /><Row label="Transport" value={t.transport} /><Row label="MR" value={t.mr} /></dl>
        </div>
      </section>

      <h3 className="mri-section-title">Finished products</h3>
      <table className="mri-table">
        <thead><tr><th>#</th><th>Item description</th><th>HSN</th><th>Batch</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Taxable value</th></tr></thead>
        <tbody>{t.items.map((item, index) => <tr key={item.batch}>
          <td>{index + 1}</td><td>{item.description}</td><td>{item.hsn}</td><td>{item.batch}</td>
          <td className="num">{item.qty}</td><td className="num">{money(item.rate)}</td><td className="num">{money(item.taxable)}</td>
        </tr>)}</tbody>
      </table>

      <section className="mri-summary">
        <p className="mri-words"><span>Amount in words</span>{t.words}<small>Illustrative amounts only. Not production tax or pricing rules.</small></p>
        <dl className="mri-totals">
          <Row label="Subtotal" value={money(t.subtotal)} />
          <Row label={t.taxLabel} value={money(t.tax)} />
          <Row label="Discount" value={`-${money(t.discount)}`} />
          <Row label="Round off" value={money(t.roundOff)} />
          <div className="mri-row mri-total"><dt>Total (INR)</dt><dd>{money(t.total)}</dd></div>
        </dl>
      </section>

      <section className="mri-pay">
        <div className="mri-panel">
          <h4>Drug license</h4>
          {d ? <p className="mri-pre"><Value value={d.drug_licenses} /></p> : <p className="mri-prompt">{missing}</p>}
          <h4>Bank details</h4>
          {d ? <dl>
            <Row label="Bank name" value={d.bank_name} /><Row label="Account holder" value={d.account_holder} />
            <Row label="Account no." value={d.account_number} /><Row label="Branch" value={d.branch} />
            <Row label="IFSC" value={d.ifsc} /><Row label="PAN" value={d.pan} />
            <Row label="Payment on" value={d.payment_on} /><Row label="UPI ID" value={d.upi_id} />
          </dl> : <p className="mri-prompt">{missing}</p>}
        </div>
        <QRPlaceholder configured={doc.qrConfigured} />
        <div className="mri-sign">
          <p>For {d?.company_name || 'the issuer'}</p>
          <div className="mri-sign__space" aria-hidden="true" />
          <p>Authorised signatory</p>
          <small>Unsigned sample</small>
        </div>
      </section>

      <section className="mri-legal">
        <h4>Declaration</h4>
        {d ? (d.declaration ? <p className="mri-pre">{d.declaration}</p> : <p className="mri-empty">No declaration saved.</p>) : <p className="mri-prompt">{missing}</p>}
        <h4>Terms of sale</h4>
        {d ? (terms.length ? <ol>{terms.map((line, index) => <li key={index}>{line}</li>)}</ol> : <p className="mri-empty">No terms saved.</p>) : <p className="mri-prompt">{missing}</p>}
      </section>
      <footer className="mri-foot">Sample · Not an issued invoice · Settings preview only, no payment request</footer>
    </article>
  </div>;
}
