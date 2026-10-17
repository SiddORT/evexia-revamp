import { formatPaise, TAX_COMPONENTS } from '../../services/serverPurchaseOrders.js';

export function TaxAmounts({ figures }) {
  const amount = (key) => figures?.overflow ? 'Over limit' : figures?.[key] == null ? 'Tax pending' : formatPaise(figures[key]);
  return <dl>
    <div><dt>Taxable subtotal</dt><dd>{amount('subtotal')}</dd></div>
    {figures?.taxComponents && TAX_COMPONENTS.filter((k) => figures.taxComponents[k] || (figures.treatment || '').includes(k)).map((k) => <div key={k}><dt>{k.toUpperCase()}</dt><dd>{formatPaise(figures.taxComponents[k])}</dd></div>)}
    <div><dt>Total GST</dt><dd>{amount('gstAmount')}</dd></div>
    <div className="po-new-summary__final"><dt>{figures?.partial ? 'Draft estimate' : 'Final total'}</dt><dd data-testid="text-po-form-total">{amount('total')}</dd></div>
  </dl>;
}

export function TaxBasis({ basis }) {
  if (!basis) return <p className="po-review__note">Historical tax breakdown unavailable. Original aggregate GST and totals are retained; no place of supply or component split has been inferred.</p>;
  return <div className="po-tax-basis">
    <dl className="po-detail-grid">
      <div><dt>Supplier GSTIN</dt><dd>{basis.supplierGstin}</dd></div>
      <div><dt>GST registration state</dt><dd>{basis.supplierStateName} ({basis.supplierStateCode})</dd></div>
      <div><dt>Place of supply</dt><dd>{basis.placeOfSupplyName} ({basis.placeOfSupplyCode})</dd></div>
      <div><dt>Tax treatment</dt><dd>{basis.treatment === 'igst' ? 'IGST — different supplier and place-of-supply states' : `${basis.treatment === 'cgst_utgst' ? 'CGST + UTGST' : 'CGST + SGST'} — matching supplier and place-of-supply states`}</dd></div>
    </dl>
  </div>;
}

export function LineTax({ line }) {
  if (!line?.taxComponents) return null;
  return <span className="po-line-tax">{TAX_COMPONENTS.filter((k) => Number(line.componentRates?.[k]) > 0).map((k) => <span key={k}>{k.toUpperCase()} {line.componentRates[k].replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}%: {formatPaise(line.taxComponents[k])}{' '}</span>)}</span>;
}
