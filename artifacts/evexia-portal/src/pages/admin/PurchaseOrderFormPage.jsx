import { formatRate } from '../../services/rates.js';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, ClipboardList, Plus, Trash2 } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import PurchaseOrderReferenceSelect from '../../components/admin/PurchaseOrderReferenceSelect.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import Dialog from '../../components/admin/Dialog.jsx';
import { locationSuggestion } from '../../services/locationGeography.js';
import { TaxAmounts, TaxBasis, LineTax } from '../../components/admin/PurchaseOrderTaxSummary.jsx';
import { interceptNavigation, setNavigationGuard } from '../../auth/navigationGuard.js';
import {
  MAX_LINES, MAX_TOTAL_PAISE, clearPending, computeLine, computeTotals, createPurchaseOrder, describeError, formatPaise, isStaleReview,
  isUncertain, loadPending, markSaved, newKey, parseQuantity, previewPurchaseOrder, savePending, trimDecimal, validDate,
  clearOrderMutation, isStaleOrder, loadOrderMutation, previewPurchaseOrderEdit, saveOrderMutation, updatePurchaseOrder,
  GST_STATES, taxContext, listPurchaseOrderReferences,
} from '../../services/serverPurchaseOrders.js';
import '../../mr.css';
import '../../purchaseOrders.css';

const BASE = '/admin/inventory/purchase-orders';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blankLine = () => ({ key: Math.random().toString(36).slice(2), product: null, quantity: '1' });
const toInput = (values) => ({
  poDate: values.poDate, expectedDate: values.expectedDate, vendorId: values.vendor?.id || '', locationId: values.location?.id || '',
  ...(values.placeOfSupplyCode ? { placeOfSupplyCode: values.placeOfSupplyCode } : {}),
  lines: values.lines.map((line) => ({ productId: line.product?.id || '', quantity: String(line.quantity).trim() })),
});

function validate(values) {
  const errors = {};
  if (!values.vendor) errors.vendorId = 'Select a vendor.';
  if (!values.location) errors.locationId = 'Select a storage location.';
  const tax = taxContext(values.vendor, values.placeOfSupplyCode);
  if (tax.error) errors.taxBasis = tax.error;
  if (!GST_STATES.some((state) => state.code === values.placeOfSupplyCode)) errors.placeOfSupplyCode = 'Select a supported State/UT.';
  if (!validDate(values.poDate)) errors.poDate = 'Enter a valid PO date.';
  if (!validDate(values.expectedDate)) errors.expectedDate = 'Enter a valid expected delivery date.';
  else if (validDate(values.poDate) && values.expectedDate < values.poDate) errors.expectedDate = 'Expected delivery cannot be before the PO date.';
  values.lines.forEach((line, index) => {
    if (!line.product) errors[`lines.${index}.productId`] = 'Select a product.';
    else if (line.product.unitPrice == null) errors[`lines.${index}.productId`] = 'This product has no catalogue price. Add one in the Allergen master before ordering it.';
    if (parseQuantity(line.quantity) === null) errors[`lines.${index}.quantity`] = 'Enter a quantity above 0, up to 1,000,000 with at most 3 decimals.';
    const figures = computeLine(line.quantity, line.product, tax.treatment);
    if (line.product && !figures && parseQuantity(line.quantity) !== null && line.product.unitPrice != null) errors[`lines.${index}.productId`] = 'Catalogue price or GST is invalid. Correct the product before reviewing.';
    if (figures?.overflow) errors[`lines.${index}.total`] = 'This line exceeds the maximum order total.';
  });
  const sum = computeTotals(values.lines, tax.treatment);
  if (sum?.overflow && !errors.lines) errors.lines = `The order total cannot exceed ${formatPaise(MAX_TOTAL_PAISE)}.`;
  return errors;
}

function Field({ id, label, error, children }) {
  return <div className="po-field"><label htmlFor={id}>{label} <span className="mr-form__required">*</span></label>{children}{error && <p id={`${id}-error`} className="mr-form__error" role="alert">{error}</p>}</div>;
}

export function LineTable({ lines, figures }) {
  return <div className="po-items-table" role="region" aria-label="Purchase order item summary" tabIndex={0}>
    <p className="po-items-table__scroll-hint">Swipe across to see prices and totals →</p>
    <table>
      <thead><tr><th scope="col">Sr. no.</th><th scope="col">Product name</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Gross total</th><th scope="col">GST %</th><th scope="col">GST amount</th><th scope="col">Final total</th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={line.id || index}>
        <td>{index + 1}</td><td><strong>{line.productName}</strong></td><td>{trimDecimal(line.quantity, 0)}</td>
        <td>₹{formatRate(line.unitPrice)}</td><td>{formatPaise(line.subtotal)}</td><td>{formatRate(line.gst)}%</td><td>{formatPaise(line.gstAmount)}<LineTax line={line} /></td><td className="po-amount">{formatPaise(line.total)}</td>
      </tr>)}</tbody>
      <tfoot>
        <tr><th colSpan="7" scope="row">Taxable subtotal</th><td>{formatPaise(figures.subtotal)}</td></tr>
        {figures.taxComponents && Object.entries(figures.taxComponents).filter(([k, value]) => value || figures.taxBasis?.treatment.includes(k)).map(([k, value]) => <tr key={k}><th colSpan="7" scope="row">{k.toUpperCase()}</th><td>{formatPaise(value)}</td></tr>)}
        <tr><th colSpan="7" scope="row">GST amount</th><td>{formatPaise(figures.gstAmount)}</td></tr>
        <tr className="po-items-table__final"><th colSpan="7" scope="row">Final total</th><td data-testid="text-po-form-total">{formatPaise(figures.total)}</td></tr>
      </tfoot>
    </table>
  </div>;
}

const fromSaved = (order) => ({
  poDate: order.poDate, expectedDate: order.expectedDate,
  placeOfSupplyCode: order.taxBasis?.placeOfSupplyCode || '',
  vendor: { id: order.vendorId, name: order.vendorName, gstin: order.taxBasis?.supplierGstin }, location: { id: order.locationId, name: order.locationName },
  lines: order.lines.map((line) => ({ key: line.id || newKey(), quantity: line.quantity, product: { id: line.productId, name: line.productName, unitPrice: line.unitPrice, gst: line.gst } })),
});

export function Editor({ order, onCancel, onSaved, onReload }) {
  const { date: displayDate } = useAdminDateFormatters();
  const editing = Boolean(order);
  const [loaded] = useState(() => editing ? loadOrderMutation(order.id) : loadPending());
  const restored = loaded.status === 'found' ? loaded.pending : null;
  const blocked = loaded.status === 'blocked' ? loaded.message : '';
  const pendingRef = useRef(restored || null);
  const [values, setValues] = useState(() => restored?.values || (editing ? fromSaved(order) : { poDate: today(), expectedDate: '', vendor: null, location: null, lines: [blankLine()] }));
  const baseline = useRef(JSON.stringify(values));
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(restored ? 'A previous save attempt did not return a confirmed result. Retry it to confirm whether it was saved; nothing is duplicated.' : '');
  const [saveError, setSaveError] = useState('');
  const [review, setReview] = useState(restored ? { order: restored.order, token: restored.reviewToken } : null);
  const [uncertain, setUncertain] = useState(Boolean(restored));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [conflict, setConflict] = useState(false);
  const [locationChoice, setLocationChoice] = useState(null);
  const locked = uncertain || busy || Boolean(blocked);
  const tax = taxContext(values.vendor, values.placeOfSupplyCode);
  const figures = computeTotals(values.lines, tax.treatment);
  const draft = values.lines.map((line) => computeLine(line.quantity, line.product, tax.treatment));
  const [legacyTaxStatus, setLegacyTaxStatus] = useState('');
  async function loadLegacyTax() {
    if (locked || !editing || order.taxBasis) return;
    setLegacyTaxStatus('Loading current vendor tax basis…');
    try {
      const result = await listPurchaseOrderReferences('vendors', { selected_id: order.vendorId });
      const vendor = result.items?.find((item) => item.id === order.vendorId);
      if (!vendor) throw new Error();
      setValues((current) => current.vendor?.id === order.vendorId ? { ...current, vendor: { ...vendor, name: order.vendorName } } : current);
      setLegacyTaxStatus('Current vendor GSTIN loaded for this explicit edit. A fresh review is required.');
    } catch { setLegacyTaxStatus('Current vendor tax basis unavailable. Restore the vendor master or select another available vendor.'); }
  }
  const hasErrors = Object.values(errors).some(Boolean);
  const navigation = useRef({});
  navigation.current = { busy, dirty: JSON.stringify(values) !== baseline.current || Boolean(review), uncertain };
  useEffect(() => {
    const canLeave = () => {
      const state = navigation.current;
      if (state.busy) return false;
      return !(state.dirty || state.uncertain) || window.confirm(state.uncertain
        ? 'This save is unconfirmed. Leave now? Reopen this order to retry the same request.'
        : 'Discard the unsaved purchase order changes?');
    };
    const release = setNavigationGuard(() => {
      if (canLeave()) return false;
      return true;
    });
    const warn = (event) => { if (navigation.current.busy || navigation.current.dirty || navigation.current.uncertain) { event.preventDefault(); event.returnValue = ''; } };
    const links = (event) => {
      const anchor = event.target.closest?.('a[href]');
      if (anchor && !event.defaultPrevented && !canLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', links, true);
    return () => { release(); window.removeEventListener('beforeunload', warn); document.removeEventListener('click', links, true); };
  }, []);
  const cancel = () => {
    if (busyRef.current) return;
    if (JSON.stringify(values) !== baseline.current && !window.confirm('Discard the unsaved purchase order changes?')) return;
    navigation.current = {};
    onCancel();
  };

  const edit = (patch, clear = []) => {
    if (locked) return;
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => ({ ...current, ...Object.fromEntries(clear.map((key) => [key, undefined])), lines: undefined }));
    setSaveError('');
  };
  function selectLocation(item) {
    if (locked || item?.id === values.location?.id) return;
    if (editing && item?.id === order.locationId) item = { ...item, name: order.locationName };
    const code = locationSuggestion(item);
    // Saved destinations and restored drafts are never treated as fresh master suggestions.
    if (values.placeOfSupplyCode && values.supplySource !== 'location') {
      setLocationChoice({ item, code });
      return;
    }
    edit({ location: item, placeOfSupplyCode: code, supplySource: 'location' }, ['locationId', 'placeOfSupplyCode']);
  }
  const supplyHelp = <div id="po-supply-help" className="po-tax-context">
    <p>Supplier GSTIN: <strong>{values.vendor?.gstin || 'Not captured'}</strong> · Registration state: <strong>{tax.supplier ? `${tax.supplier.name} (${tax.supplier.code})` : 'Unavailable'}</strong></p>
    <p>{tax.error || (tax.treatment === 'igst' ? 'Different state codes: full catalogue GST rate applies as IGST.' : `Matching state codes: equal CGST and ${tax.treatment === 'cgst_utgst' ? 'UTGST' : 'SGST'} rates apply.`)}</p>
    <p>Storage location State/UT fills Place of supply for Indian addresses. You may override it for an exceptional delivery destination. Changing location asks before replacing a manual or saved destination.</p>
    <p>{values.supplySource === 'location' ? (values.placeOfSupplyCode ? 'Destination suggested by the selected storage location.' : 'This location has missing or non-Indian geography. Select the applicable Indian destination explicitly; no previous suggestion is retained.') : values.placeOfSupplyCode ? (values.supplySource === 'manual' ? 'Manually selected destination.' : 'Saved destination retained; current master address changes are not applied.') : 'Select a storage location or choose Place of supply explicitly.'}</p>
    <p>Ordinary domestic goods only. This calculator does not determine special supply, reverse-charge, composition, SEZ or import/export rules. A foreign storage address does not establish Indian tax treatment.</p>
    {editing && !order.taxBasis && values.vendor?.id === order.vendorId && <><button type="button" className="po-link" disabled={locked} onClick={loadLegacyTax}>Load current vendor tax basis for this edit</button><p role="status">{legacyTaxStatus}</p></>}
  </div>;
  const editLine = (index, patch, clear) => {
    if (locked) return;
    setValues((current) => ({ ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...patch } : line) }));
    setErrors((current) => ({ ...current, ...Object.fromEntries(clear.map((key) => [`lines.${index}.${key}`, undefined])), [`lines.${index}.total`]: undefined, lines: undefined }));
    setSaveError('');
  };

  async function runReview(event) {
    event.preventDefault();
    if (busyRef.current || locked) return;
    const found = validate(values);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length) { document.getElementById('po-form-errors')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    busyRef.current = true; setBusy(true);
    try {
      const result = await (editing ? previewPurchaseOrderEdit(order.id, toInput(values)) : previewPurchaseOrder(toInput(values)));
      setReview({ order: result.order, token: result.reviewToken });
      setNotice('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      setSaveError(describeError(cause, 'The order could not be reviewed. Your draft is kept; try again.'));
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function save() {
    if (busyRef.current || !review) return;
    busyRef.current = true; setBusy(true);
    setSaveError('');
    const input = uncertain && restored ? (restored.input || toInput(restored.values)) : toInput(values);
    const fingerprint = uncertain && restored ? restored.fingerprint : JSON.stringify({ input, token: review.token });
    if (pendingRef.current?.fingerprint !== fingerprint) pendingRef.current = { fingerprint, key: newKey() };
    const { key } = pendingRef.current;
    const attempt = uncertain && restored ? restored : editing
      ? { fingerprint, key, input, values, order: review.order, reviewToken: review.token, operation: 'edit', version: restored?.version || order.version }
      : { fingerprint, key, input, values, order: review.order, reviewToken: review.token };
    const clearAttempt = () => editing ? clearOrderMutation(order.id, key) : clearPending();
    if (!await (editing ? saveOrderMutation(order.id, attempt) : savePending(attempt))) {
      busyRef.current = false; setBusy(false);
      setSaveError('A safe retry identity could not be stored, or another tab has a pending order. Nothing was sent. Enable storage or reopen this form to reconcile the pending attempt.');
      return;
    }
    try {
      const saved = await (editing ? updatePurchaseOrder(order.id, input, attempt.version, review.token, key) : createPurchaseOrder(input, review.token, key));
      await clearAttempt(); pendingRef.current = null;
      navigation.current = {};
      markSaved(saved);
      onSaved(saved);
    } catch (cause) {
      if (isStaleOrder(cause)) {
        await clearAttempt(); pendingRef.current = null; setUncertain(false); setReview(null); setConflict(true);
        setSaveError('Another session changed or deleted this order. Your draft is kept, but cannot overwrite it. Reload the latest saved order before making a new edit.');
      } else if (isStaleReview(cause)) {
        await clearAttempt(); pendingRef.current = null; setUncertain(false); setReview(null);
        setSaveError('Catalogue prices, vendor tax basis or references changed since your review. Your draft is kept; review the order again to see current amounts.');
      } else if (isUncertain(cause)) {
        setUncertain(true);
        setSaveError('The server did not confirm whether this order was saved. Retry to confirm; the same request identity is reused so no duplicate is created.');
      } else {
        await clearAttempt(); pendingRef.current = null; setUncertain(false);
        setSaveError(describeError(cause, 'The order could not be saved. Your draft is kept.'));
      }
    } finally { busyRef.current = false; setBusy(false); }
  }

  const productHint = (line, index) => {
    if (!line.product) return null;
    return line.product.unitPrice == null
      ? <p className="mr-form__error" role="alert" id={`po-product-${index}-price`}>Catalogue price unavailable. This line cannot be created.</p>
      : null;
  };

  return <section className="admin-panel po-new" aria-label={editing ? 'Edit purchase order' : 'New purchase order'}>
    <div className="po-form-intro"><div><h2>{review ? 'Review before saving' : 'Order details'}</h2><p>{review ? 'Nothing has been saved yet. Amounts below are calculated by the server.' : 'Required fields are marked *. Prices and GST come from the product catalogue.'}</p></div><ClipboardList size={21} color="var(--admin-accent)" aria-hidden="true" /></div>
    {notice && <div className="admin-feedback" role="status" style={{ margin: 18 }}>{notice}</div>}
    {blocked && <div className="admin-feedback admin-feedback--error" role="alert" style={{ margin: 18 }}>{blocked}</div>}
    {saveError && <div className="admin-feedback admin-feedback--error" role="alert" style={{ margin: 18 }}>{saveError}</div>}
    {editing && <p className="po-review__note" style={{ margin: 18 }}>Retained products keep their saved names, prices and GST, even if their master records are no longer available. Newly selected products use the current catalogue.</p>}
    {conflict && <button type="button" className="admin-button" onClick={() => { if (window.confirm('Discard this draft and reload the latest saved order?')) { navigation.current = {}; onReload(); } }}>Reload latest order</button>}
    {review ? <>
      <div className="po-review"><p className="po-review__note">Confirming saves this order on the server. It does not send an order to a supplier.</p>
        <dl className="po-detail-grid"><div><dt>Vendor</dt><dd>{review.order.vendorName}</dd></div><div><dt>Storage location</dt><dd>{review.order.locationName}</dd></div><div><dt>PO date</dt><dd>{displayDate(review.order.poDate)}</dd></div><div><dt>Expected delivery</dt><dd>{displayDate(review.order.expectedDate)}</dd></div></dl>
        <TaxBasis basis={review.order.taxBasis} />
        <h3 className="po-section-title">Items <span>{review.order.lines.length} product {review.order.lines.length === 1 ? 'line' : 'lines'}</span></h3></div>
      <div className="po-new-summary po-new-summary--review"><TaxAmounts figures={{ ...review.order, treatment: review.order.taxBasis?.treatment }} /></div>
      <LineTable lines={review.order.lines} figures={review.order} />
      <div className="po-form-footer"><span>{uncertain ? 'Editing is locked until this exact request is confirmed.' : 'The order is saved only after the server confirms it.'}</span><div className="po-actions">
        {!uncertain && <button type="button" disabled={busy} className="admin-button admin-button--secondary" onClick={() => { setReview(null); setSaveError(''); }} data-testid="button-back-po-draft">Back to draft</button>}
        <button type="button" disabled={busy || Boolean(blocked) || conflict} className="admin-button" onClick={save} data-testid="button-confirm-po">{busy ? 'Saving…' : uncertain ? 'Retry and confirm' : editing ? 'Save changes' : 'Create purchase order'}</button></div></div>
    </> : <form onSubmit={runReview} noValidate className="po-new-form">
      <div className="po-new-layout">
        <aside className="po-new-summary" aria-label="Order totals" aria-live="polite" aria-atomic="true"><h3>Order totals</h3>
          <TaxAmounts figures={{ ...figures, treatment: tax.treatment }} />
          {figures.taxPending && <div className="po-totals-status">Tax pending — select a valid vendor tax basis and place of supply. This is not zero-rated GST.</div>}
          {figures.overflow && <div className="po-totals-status" role="alert">Order exceeds {formatPaise(MAX_TOTAL_PAISE)}. Reduce quantities or remove lines.</div>}
          <p>Draft estimate in INR, excluding unfinished or invalid lines. The server recalculates complete valid lines at review.</p>
          {supplyHelp}</aside>
        <div className="po-new-main">
          {(errors.lines || hasErrors) && <div id="po-form-errors" className="admin-feedback admin-feedback--error" role="alert">{errors.lines || 'Check the highlighted fields before continuing.'}</div>}
          <fieldset className="po-group" disabled={locked}><legend>Vendor and delivery</legend>
            <div className="po-group__vendor">
              <Field id="po-vendor" label="Vendor" error={errors.vendorId}>
                <PurchaseOrderReferenceSelect id="po-vendor" kind="vendors" label="Vendor" selected={values.vendor} placeholder="Select vendor" invalid={errors.vendorId} describedBy={errors.vendorId ? 'po-vendor-error' : undefined} onChange={(item) => edit({ vendor: editing && order.taxBasis && item?.id === order.vendorId ? fromSaved(order).vendor : item }, ['vendorId', 'placeOfSupplyCode'])} />
              </Field>
            </div>
            <div className="po-group__delivery">
              <Field id="po-location" label="Storage location" error={errors.locationId}>
                <PurchaseOrderReferenceSelect id="po-location" kind="locations" label="Storage location" selected={values.location} placeholder="Select storage location" invalid={errors.locationId} describedBy={errors.locationId ? 'po-location-error' : undefined} onChange={selectLocation} />
              </Field>
              <Field id="po-place-of-supply" label="Place of supply (State/UT)" error={errors.placeOfSupplyCode}>
                <SearchableSelect id="po-place-of-supply" label="Place of supply (State/UT)" value={values.placeOfSupplyCode || ''} options={GST_STATES.map((state) => ({ value: state.code, label: `${state.name} (${state.code})` }))} onChange={(code) => edit({ placeOfSupplyCode: code, supplySource: 'manual' }, ['placeOfSupplyCode'])} placeholder="Select applicable State/UT" invalid={errors.placeOfSupplyCode} describedBy={`po-supply-help${errors.placeOfSupplyCode ? ' po-place-of-supply-error' : ''}`} disabled={locked} />
              </Field>
            </div>
            <div className="po-group__dates">
              <Field id="po-date" label="PO date" error={errors.poDate}><input id="po-date" className="mr-form__control" type="date" value={values.poDate} onChange={(e) => edit({ poDate: e.target.value }, ['poDate'])} aria-invalid={Boolean(errors.poDate)} aria-describedby={errors.poDate ? 'po-date-error' : undefined} data-testid="input-po-date" /></Field>
              <Field id="po-expected-date" label="Expected delivery" error={errors.expectedDate}><input id="po-expected-date" className="mr-form__control" type="date" min={values.poDate} value={values.expectedDate} onChange={(e) => edit({ expectedDate: e.target.value }, ['expectedDate'])} aria-invalid={Boolean(errors.expectedDate)} aria-describedby={errors.expectedDate ? 'po-expected-date-error' : undefined} data-testid="input-po-expected-date" /></Field>
            </div>
          </fieldset>
          <fieldset className="po-group" disabled={locked}><legend>Products <span>{values.lines.length} {values.lines.length === 1 ? 'line' : 'lines'}</span></legend>
            <div className="po-new-lines">{values.lines.map((line, index) => {
              const product = line.product;
              return <div className="po-new-line" key={line.key}>
                <div className="po-new-line__top"><strong>Item {String(index + 1).padStart(2, '0')}</strong>
                  <button type="button" className="admin-icon-button admin-icon-button--danger po-new-line__remove" aria-label={`Remove product line ${index + 1}${product ? `: ${product.name}` : ''}`} title={`Remove product line ${index + 1}`} disabled={values.lines.length === 1 || locked} onClick={() => { edit({ lines: values.lines.filter((_, i) => i !== index) }); setErrors({}); }} data-testid={`button-remove-po-line-${index}`}><Trash2 size={16} aria-hidden="true" /></button></div>
                <div className="po-new-line__fields">
                  <div className="po-new-line__product"><Field id={`po-product-${index}`} label="Product" error={errors[`lines.${index}.productId`]}>
                    <PurchaseOrderReferenceSelect id={`po-product-${index}`} kind="products" label="Product" selected={product} placeholder="Select product" invalid={errors[`lines.${index}.productId`]} describedBy={errors[`lines.${index}.productId`] ? `po-product-${index}-error` : undefined} onChange={(item) => {
                      const retained = editing && order.lines.find((saved) => saved.productId === item?.id);
                      editLine(index, { product: retained ? { id: retained.productId, name: retained.productName, unitPrice: retained.unitPrice, gst: retained.gst } : item }, ['productId']);
                    }} />
                  </Field>{productHint(line, index) && !errors[`lines.${index}.productId`] ? productHint(line, index) : null}</div>
                  <Field id={`po-quantity-${index}`} label="Quantity" error={errors[`lines.${index}.quantity`]}><input id={`po-quantity-${index}`} className="mr-form__control" type="text" inputMode="decimal" placeholder="1" value={line.quantity} onChange={(e) => editLine(index, { quantity: e.target.value }, ['quantity'])} aria-invalid={Boolean(errors[`lines.${index}.quantity`])} aria-describedby={errors[`lines.${index}.quantity`] ? `po-quantity-${index}-error` : undefined} data-testid={`input-po-quantity-${index}`} /></Field>
                  <div className="po-field"><label htmlFor={`po-price-${index}`}>Unit price (₹)</label><input id={`po-price-${index}`} className="mr-form__control" readOnly tabIndex={-1} value={!product ? '' : product.unitPrice == null ? 'Unavailable' : formatRate(product.unitPrice)} placeholder="From catalogue" aria-readonly="true" data-testid={`input-po-price-${index}`} /></div>
                  <div className="po-field"><label htmlFor={`po-gst-${index}`}>GST (%)</label><input id={`po-gst-${index}`} className="mr-form__control" readOnly tabIndex={-1} value={product ? formatRate(product.gst) : ''} placeholder="From catalogue" aria-readonly="true" data-testid={`input-po-gst-${index}`} /></div>
                </div>
                <div className="po-new-line__totals"><span>Taxable <b>{draft[index] && !draft[index].overflow ? formatPaise(draft[index].subtotal) : '—'}</b></span><LineTax line={draft[index]} /><span>GST <b>{draft[index]?.taxPending ? 'Tax pending' : draft[index] && !draft[index].overflow ? formatPaise(draft[index].gstAmount) : '—'}</b></span><span className="po-new-line__final">Line total <b>{draft[index]?.taxPending ? 'Tax pending' : draft[index] && !draft[index].overflow ? formatPaise(draft[index].total) : '—'}</b></span></div>
                {errors[`lines.${index}.total`] && <p className="mr-form__error" role="alert">{errors[`lines.${index}.total`]}</p>}
              </div>;
            })}</div>
            <button type="button" className="admin-button admin-button--secondary po-add-line" disabled={values.lines.length >= MAX_LINES || locked} onClick={() => edit({ lines: [...values.lines, blankLine()] })} data-testid="button-add-po-line"><Plus size={15} aria-hidden="true" /> Add product line</button>
          </fieldset>
        </div>
      </div>
      <div className="po-form-footer"><span>The server reviews the order before anything is saved.</span><div className="po-actions"><button type="button" disabled={busy} className="admin-button admin-button--secondary" onClick={cancel} data-testid="button-cancel-po">Cancel</button><button type="submit" disabled={locked || conflict} className="admin-button" data-testid="button-review-po">{busy ? 'Reviewing…' : 'Review order'}</button></div></div>
    </form>}
    {locationChoice && <Dialog title="Review delivery destination" eyebrow="Storage location changed" description={`Changing to ${locationChoice.item?.name || 'no location'} suggests ${GST_STATES.find((state) => state.code === locationChoice.code)?.name || 'no usable Indian State/UT'}. Your current destination has not been replaced.`} onClose={() => setLocationChoice(null)} footer={<>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setLocationChoice(null)}>Cancel location change</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { edit({ location: locationChoice.item, supplySource: 'manual' }, ['locationId']); setLocationChoice(null); }}>Keep current destination</button>
      <button type="button" className="admin-button" onClick={() => { edit({ location: locationChoice.item, placeOfSupplyCode: locationChoice.code, supplySource: 'location' }, ['locationId', 'placeOfSupplyCode']); setLocationChoice(null); }}>{locationChoice.code ? 'Use location State/UT' : 'Clear destination and select manually'}</button>
    </>} />}
  </section>;
}

export default function PurchaseOrderFormPage() {
  const [, navigate] = useLocation();
  const title = 'New purchase order';
  return <AdminLayout title={title}><div className="po-page po-page--new">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Purchase orders / New</p><h1>{title}</h1><p className="admin-page-head__description">Build a supplier order, review the server-calculated totals, then save it.</p></div><div className="po-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => { if (!interceptNavigation({ kind: 'href', href: BASE })) navigate(BASE); }} data-testid="button-back-purchase-orders"><ArrowLeft size={16} aria-hidden="true" /> All orders</button></div></div>
    <Editor onCancel={() => navigate(BASE)} onSaved={() => navigate(BASE)} />
  </div></AdminLayout>;
}
