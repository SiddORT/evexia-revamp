import '../../poInvoice.css';
import { money } from '../../services/purchaseOrders.js';

const logoUrl = `${import.meta.env.BASE_URL}images/evexia-logo.png`;

export default function POInvoiceDocument({ document, compact = false }) {
  const pages = compact ? document.pages.slice(0, 1) : document.pages;
  return <div className={`po-invoice-document${compact ? ' po-invoice-document--compact' : ''}`}>
    {!compact && document.model && <section className="sr-only" aria-label="Invoice text details">
      <h3>Purchase order {document.number}</h3>
      <p>{document.model.company.name}. {document.model.company.address}</p>
      <p>Vendor: {document.model.vendor.name}. Address: {document.model.vendor.address || 'Not recorded'}. GST number: {document.model.vendor.gstNo || 'Not recorded'}.</p>
      <p>PO date: {document.model.poDate}. Expected delivery: {document.model.expectedDate}. Deliver to: {document.model.locationName}. Status: {document.model.status}.</p>
      {document.model.isSample && <p>Sample document, preview only.</p>}
      <table><caption>Purchase order items</caption><thead><tr>{['Sr. no.', 'Product', 'HSN code', 'Quantity', 'Unit price', 'Gross amount', 'GST %', 'GST amount', 'Final total'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
        <tbody>{document.model.lines.map((line, index) => <tr key={index}><td>{index + 1}</td><th scope="row">{line.productName}</th><td>{line.hsnCode || 'Not recorded'}</td><td>{line.quantity}</td><td>{money(Math.round(line.unitPrice * 100))}</td><td>{money(line.subtotal)}</td><td>{line.gst}%</td><td>{money(line.gstAmount)}</td><td>{money(line.total)}</td></tr>)}</tbody>
      </table><p>Taxable amount: {money(document.model.subtotal)}. GST amount: {money(document.model.gstAmount)}. Final total: {money(document.model.total)}.</p>
    </section>}
    {pages.map((page, index) => <div key={index} className="po-invoice-document__page" aria-hidden={!compact}
      role="img" aria-label={`${document.number || 'Sample PO'} invoice page ${index + 1}`}
      dangerouslySetInnerHTML={{ __html: page.replaceAll('__EVEXIA_LOGO__', logoUrl) }} />)}
  </div>;
}