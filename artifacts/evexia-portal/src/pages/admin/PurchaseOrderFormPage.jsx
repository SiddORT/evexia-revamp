import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, ClipboardList, History, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import ConfirmationDialog from '../../components/admin/ConfirmationDialog.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import { calculateLine, createPO, deletePO, loadPOSnapshot, money, totals, updatePO, validatePO } from '../../services/purchaseOrders.js';
import PurchaseOrderActivityDrawer from '../../components/admin/PurchaseOrderActivityDrawer.jsx';
import '../../mr.css';
import '../../purchaseOrders.css';

const BASE = '/admin/inventory/purchase-orders';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blankLine = () => ({ productId: '', quantity: '1', unitPrice: '', gst: '' });
const emptyValues = () => ({ poDate: today(), expectedDate: '', vendorId: '', locationId: '', lines: [blankLine()] });
const fromRecord = (record) => ({
  poDate: record.poDate, expectedDate: record.expectedDate, vendorId: record.vendorId, locationId: record.locationId,
  lines: record.lines.map((line) => ({ productId: line.productId, quantity: String(line.quantity), unitPrice: String(line.unitPrice), gst: String(line.gst) })),
});
const displayDate = (date) => date ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const displayTime = (date) => date ? new Date(date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function ReferenceField({ id, label, value, items, nameKey, existingName, activeOnly, error, onChange }) {
  const found = items.find((item) => item.id === value);
  const retained = Boolean(value && existingName && (!found || (activeOnly && found.status !== 'active')));
  const choices = items.filter((item) => !activeOnly || item.status === 'active')
    .map((item) => ({ value: item.id, label: `${item[nameKey]} · ${item.id}` }));
  if (retained) choices.unshift({ value, label: `${existingName} · ${value} (existing selection)` });
  return <div className="po-field">
    <label htmlFor={id}>{label} <span className="mr-form__required">*</span></label>
    <SearchableSelect id={id} label={label} value={value} options={choices} onChange={onChange} placeholder={`Select ${label.toLowerCase()}`} invalid={Boolean(error)} describedBy={error ? `${id}-error` : retained ? `${id}-hint` : undefined} />
    {error ? <p id={`${id}-error`} className="mr-form__error" role="alert">{error}</p> : retained ? <p id={`${id}-hint`} className="mr-form__hint">This saved selection is no longer available for new orders. It can be retained here.</p> : null}
  </div>;
}

function InputField({ id, label, value, onChange, error, type = 'text', min, max, step, placeholder }) {
  return <div className="po-field"><label htmlFor={id}>{label} <span className="mr-form__required">*</span></label><input id={id} className="mr-form__control" type={type} min={min} max={max} step={step} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} data-testid={`input-${id}`} />{error && <p id={`${id}-error`} className="mr-form__error" role="alert">{error}</p>}</div>;
}

function LineTable({ lines, figures }) {
  return <div className="po-items-table" role="region" aria-label="Purchase order item summary" tabIndex={0}>
    <p className="po-items-table__scroll-hint">Swipe across to see prices and totals →</p>
    <table>
      <thead><tr><th scope="col">Sr. no.</th><th scope="col">Product name</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Gross total</th><th scope="col">GST %</th><th scope="col">GST amount</th><th scope="col">Final total</th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={`${line.productId}-${index}`}>
        <td>{index + 1}</td>
        <td><strong>{line.productName || 'Select a product'}</strong></td>
        <td>{line.quantity || '—'}</td>
        <td>{String(line.unitPrice ?? '').trim() !== '' && /^\d+(?:\.\d{1,2})?$/.test(String(line.unitPrice)) ? money(Math.round(Number(line.unitPrice) * 100)) : '—'}</td>
        <td>{line.subtotal == null ? '—' : money(line.subtotal)}</td>
        <td>{line.gst === '' || line.gst == null ? '—' : `${line.gst}%`}</td>
        <td>{line.gstAmount == null ? '—' : money(line.gstAmount)}</td>
        <td className="po-amount">{line.total == null ? '—' : money(line.total)}</td>
      </tr>)}</tbody>
      <tfoot>
        <tr><th colSpan="7" scope="row">Gross total</th><td>{figures ? money(figures.subtotal) : '—'}</td></tr>
        <tr><th colSpan="7" scope="row">GST amount</th><td>{figures ? money(figures.gstAmount) : '—'}</td></tr>
        <tr className="po-items-table__final"><th colSpan="7" scope="row">Final total</th><td data-testid="text-po-form-total">{figures ? money(figures.total) : '—'}</td></tr>
      </tfoot>
    </table>
  </div>;
}

function POEditor({ snapshot, record, isNew, onSaved, onCancel, onRefresh }) {
  const [values, setValues] = useState(() => record ? fromRecord(record) : emptyValues());
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [review, setReview] = useState(null);
  const refs = snapshot.refs;
  const figures = totals(values.lines);
  const draftLines = values.lines.map((line, index) => ({
    ...line,
    productName: refs.products.find((item) => item.id === line.productId)?.name ||
      (record?.lines[index]?.productId === line.productId ? record.lines[index].productName : ''),
    ...(calculateLine(line) || {}),
  }));
  function change(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSaveError('');
  }
  function changeLine(index, field, value) {
    setValues((current) => ({ ...current, lines: current.lines.map((line, i) => i === index ? {
      ...line, [field]: value,
      ...(field === 'productId' && value ? {
        gst: String(refs.products.find((item) => item.id === value)?.gst ?? line.gst),
      } : {}),
    } : line) }));
    setErrors((current) => ({ ...current, [`lines.${index}.${field}`]: undefined, [`lines.${index}.gst`]: undefined, [`lines.${index}.total`]: undefined, lines: undefined, form: undefined }));
    setSaveError('');
  }
  function prepare(event) {
    event.preventDefault();
    const result = validatePO(values, refs, record);
    setErrors(result.errors);
    setSaveError('');
    if (Object.keys(result.errors).length) {
      document.getElementById('po-form-errors')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setReview(result.order);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function save() {
    const result = validatePO(values, refs, record);
    if (Object.keys(result.errors).length) { setErrors(result.errors); setReview(null); return; }
    try {
      const next = isNew ? createPO(snapshot, refs, values) : updatePO(snapshot, refs, record.id, values);
      onSaved(next, isNew ? next.orders.find((order) => !snapshot.record.orders.some((old) => old.id === order.id))?.id : record.id);
    } catch (cause) { setSaveError(cause.message || 'Could not save this order. Refresh records and review again.'); }
  }
  return <section className="admin-panel" aria-label={isNew ? 'New purchase order' : 'Edit purchase order'}>
    <div className="po-form-intro"><div><h2>{review ? 'Review before saving' : 'Order details'}</h2><p>{review ? 'Nothing has been saved yet. Check quantities, prices and delivery details.' : 'Required fields are marked *. Amounts are calculated in INR as you work.'}</p></div><ClipboardList size={21} color="var(--admin-accent)" aria-hidden="true" /></div>
    {saveError && <div className="admin-feedback admin-feedback--error" role="alert" style={{ margin: 18 }}>{saveError} <button type="button" className="po-link" onClick={onRefresh} data-testid="button-refresh-po-draft">Refresh and discard draft</button></div>}
    {review ? <>
      <div className="po-review"><p className="po-review__note">This is a browser-local preview. Confirming saves the order in this browser; it does not send an order to a supplier.</p><dl className="po-detail-grid"><div><dt>Vendor</dt><dd>{review.vendorName}</dd></div><div><dt>Storage location</dt><dd>{review.locationName}</dd></div><div><dt>PO date</dt><dd>{displayDate(review.poDate)}</dd></div><div><dt>Expected delivery</dt><dd>{displayDate(review.expectedDate)}</dd></div></dl><h3 className="po-section-title">Items <span>{review.lines.length} product {review.lines.length === 1 ? 'line' : 'lines'}</span></h3></div>
       <LineTable lines={review.lines} figures={review} />
      <div className="po-form-footer"><span>Changes are saved locally on confirmation.</span><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => { setReview(null); setSaveError(''); }} data-testid="button-back-po-draft">Back to draft</button><button type="button" className="admin-button" onClick={save} data-testid="button-confirm-po">{isNew ? 'Create purchase order' : 'Save changes'}</button></div></div>
    </> : <form onSubmit={prepare} noValidate>
      <div className="po-form-body">
        {(errors.form || errors.lines || Object.entries(errors).some(([key, value]) => value && key.startsWith('lines.'))) && <div id="po-form-errors" className="admin-feedback admin-feedback--error" role="alert">{errors.form || errors.lines || 'Check the highlighted product rows before continuing.'}</div>}
        <h3 className="po-section-title">01 / Order information <span>Supplier and delivery destination</span></h3>
        <div className="po-fields">
          <InputField id="po-date" label="PO date" type="date" value={values.poDate} onChange={(value) => change('poDate', value)} error={errors.poDate} />
          <InputField id="po-expected-date" label="Expected delivery" type="date" min={values.poDate} value={values.expectedDate} onChange={(value) => change('expectedDate', value)} error={errors.expectedDate} />
          <ReferenceField id="po-vendor" label="Vendor" items={refs.vendors} nameKey="vendorName" value={values.vendorId} existingName={record?.vendorId === values.vendorId ? record.vendorName : ''} error={errors.vendorId} onChange={(value) => change('vendorId', value)} />
          <ReferenceField id="po-location" label="Storage location" items={refs.locations} nameKey="name" activeOnly value={values.locationId} existingName={record?.locationId === values.locationId ? record.locationName : ''} error={errors.locationId} onChange={(value) => change('locationId', value)} />
        </div>
        <hr className="po-divider" />
        <h3 className="po-section-title">02 / Product lines <span>Quantity, unit price and GST per item</span></h3>
        <div className="po-lines">{values.lines.map((line, index) => {
          return <div className="po-line" key={index}><div className="po-line__top"><strong>Item {String(index + 1).padStart(2, '0')}</strong><button type="button" className="po-action po-action--danger" disabled={values.lines.length === 1} onClick={() => { setValues((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) })); setErrors({}); }} data-testid={`button-remove-po-line-${index}`}><X size={14} aria-hidden="true" /> Remove</button></div>
            <div className="po-line__fields">
              <ReferenceField id={`po-product-${index}`} label="Product" items={refs.products} nameKey="name" activeOnly value={line.productId} existingName={record?.lines[index]?.productId === line.productId ? record.lines[index].productName : ''} error={errors[`lines.${index}.productId`]} onChange={(value) => changeLine(index, 'productId', value)} />
              <InputField id={`po-quantity-${index}`} label="Quantity" type="number" min="0.001" step="0.001" placeholder="1" value={line.quantity} onChange={(value) => changeLine(index, 'quantity', value)} error={errors[`lines.${index}.quantity`]} />
              <InputField id={`po-price-${index}`} label="Unit price (₹)" type="number" min="0" step="0.01" placeholder="0.00" value={line.unitPrice} onChange={(value) => changeLine(index, 'unitPrice', value)} error={errors[`lines.${index}.unitPrice`]} />
              <InputField id={`po-gst-${index}`} label="GST (%)" type="number" min="0" max="100" step="0.01" placeholder="0" value={line.gst} onChange={(value) => changeLine(index, 'gst', value)} error={errors[`lines.${index}.gst`]} />
            </div>
            {errors[`lines.${index}.total`] && <p className="mr-form__error" role="alert">{errors[`lines.${index}.total`]}</p>}
          </div>;
        })}</div>
        <button type="button" className="admin-button admin-button--secondary po-add-line" disabled={values.lines.length >= 100} onClick={() => { setValues((current) => ({ ...current, lines: [...current.lines, blankLine()] })); setErrors((current) => ({ ...current, lines: undefined, form: undefined })); }} data-testid="button-add-po-line"><Plus size={15} aria-hidden="true" /> Add product line</button>
         <h3 className="po-section-title po-summary-title">03 / Item summary <span>Updates as you enter products and amounts</span></h3>
         <LineTable lines={draftLines} figures={figures} />
      </div>
      <div className="po-form-footer"><span>Review the order before it is saved.</span><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-po">Cancel</button><button type="submit" className="admin-button" data-testid="button-review-po">Review order</button></div></div>
    </form>}
  </section>;
}

export default function PurchaseOrderFormPage({ id }) {
  const [, navigate] = useLocation();
  const isNew = !id || id === 'new';
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [version, setVersion] = useState(0);
  function refresh() {
    try { setSnapshot(loadPOSnapshot()); setLoadError(''); setActionError(''); setEditing(false); setConfirmDelete(false); setVersion((value) => value + 1); }
    catch (cause) { setSnapshot(null); setLoadError(cause.message || 'Purchase order could not be loaded.'); }
  }
  useEffect(() => { setActivityOpen(false); refresh(); }, [id]);
  const record = isNew ? null : snapshot?.record.orders.find((order) => order.id === id);
  const orderEvents = [...(snapshot?.record.events || [])].reverse().filter((event) => event.orderId === id);
  function saved(next, savedId) {
    setSnapshot((current) => ({ ...current, record: next }));
    setEditing(false);
    setNotice(isNew ? 'Purchase order created in this browser.' : 'Purchase order updated in this browser.');
    if (isNew && savedId) navigate(`${BASE}/${encodeURIComponent(savedId)}`);
  }
  function remove() {
    try {
      const next = deletePO(snapshot, id);
      setSnapshot((current) => ({ ...current, record: next }));
      setConfirmDelete(false);
      setActionError('');
      setNotice('Purchase order deleted. Its details remain available for reference.');
    } catch (cause) { setActionError(cause.message || 'Could not delete this order. Refresh and try again.'); }
  }
  const title = isNew ? 'New purchase order' : editing ? 'Edit purchase order' : record?.number || 'Purchase order';
  return <AdminLayout title={title}><div className="po-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Purchase orders / {isNew ? 'New' : record?.number || 'Detail'}</p><h1>{title}</h1><p className="admin-page-head__description">{isNew ? 'Build a supplier order, review its totals, then save it locally.' : 'Review order details, item values and recorded changes.'}</p></div><div className="po-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} data-testid="button-back-purchase-orders"><ArrowLeft size={16} aria-hidden="true" /> All orders</button><button type="button" className="admin-button admin-button--secondary" onClick={refresh} data-testid="button-refresh-po-detail"><RefreshCw size={15} aria-hidden="true" /> Refresh</button></div></div>
    {notice && <div className="admin-feedback" role="status">{notice}</div>}
    {actionError && !confirmDelete && <div className="admin-feedback admin-feedback--error" role="alert">{actionError} <button type="button" className="po-link" onClick={refresh}>Refresh records</button></div>}
    {loadError || (snapshot && !isNew && !record) ? <section className="admin-panel po-recovery" role="alert"><h2>{loadError ? 'Purchase orders are unavailable' : 'Purchase order not found'}</h2><p>{loadError || 'This order may not exist in this browser, or its link is incorrect.'}</p><div className="po-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)}>Back to orders</button><button type="button" className="admin-button" onClick={refresh}>Try again</button></div></section> : !snapshot ? <section className="admin-panel" aria-label="Loading purchase order"><div className="po-skeleton" /><div className="po-skeleton" /><div className="po-skeleton" /></section> : isNew || editing ? <POEditor key={`${id || 'new'}-${version}-${editing}`} snapshot={snapshot} record={record} isNew={isNew} onSaved={saved} onCancel={() => isNew ? navigate(BASE) : setEditing(false)} onRefresh={refresh} /> : <>
      <div className="po-summary"><div className="po-summary__item po-summary__item--accent"><span>Order total</span><strong data-testid="text-po-detail-total">{money(record.total)}</strong><small>Including {money(record.gstAmount)} GST</small></div><div className="po-summary__item"><span>Status</span><strong><span className={`po-status${record.status === 'deleted' ? ' po-status--draft' : ''}`}>{record.status}</span></strong><small>{record.status === 'deleted' ? 'Retained for reference' : 'Saved locally'}</small></div><div className="po-summary__item"><span>Product lines</span><strong>{record.lines.length}</strong><small>On this order</small></div><div className="po-summary__item"><span>Expected delivery</span><strong style={{ fontSize: 20 }}>{displayDate(record.expectedDate)}</strong><small>PO date {displayDate(record.poDate)}</small></div></div>
      <section className="admin-panel">
        <div className="po-form-intro">
          <div><h2>Order overview</h2><p>Created {displayTime(record.createdAt)} · Last changed {displayTime(record.updatedAt)}</p></div>
          <div className="po-actions">
            <button type="button" className="admin-button admin-button--secondary po-activity-trigger" onClick={(event) => { event.currentTarget.focus(); setActivityOpen(true); }}
              aria-haspopup="dialog" aria-controls="po-order-activity" aria-expanded={activityOpen} data-testid="button-open-po-activity">
              <History size={15} aria-hidden="true" /> Order activity <span aria-label={`${orderEvents.length} events`}>({orderEvents.length})</span>
            </button>
            {record.status === 'open' && <>
              <button type="button" className="admin-button admin-button--secondary" onClick={() => setEditing(true)} data-testid="button-edit-po"><Pencil size={15} aria-hidden="true" /> Edit</button>
              <button type="button" className="admin-button admin-button--danger" onClick={() => { setActionError(''); setConfirmDelete(true); }} data-testid="button-delete-po"><Trash2 size={15} aria-hidden="true" /> Delete</button>
            </>}
          </div>
        </div>
        <div className="po-review"><dl className="po-detail-grid"><div><dt>PO number</dt><dd className="po-number">{record.number}</dd></div><div><dt>PO date</dt><dd>{displayDate(record.poDate)}</dd></div><div><dt>Expected delivery</dt><dd>{displayDate(record.expectedDate)}</dd></div><div><dt>Vendor</dt><dd>{record.vendorName}<span className="po-secondary">ID: {record.vendorId}</span></dd></div><div><dt>Storage location</dt><dd>{record.locationName}<span className="po-secondary">ID: {record.locationId}</span></dd></div></dl><h3 className="po-section-title">Product lines</h3></div><LineTable lines={record.lines} figures={record} />
      </section>
      {activityOpen && <PurchaseOrderActivityDrawer number={record.number} events={orderEvents} onClose={() => setActivityOpen(false)} />}
    </>}
    {confirmDelete && <ConfirmationDialog title={`Delete ${record.number}?`} description="This removes the order from open totals, but retains its details and activity in this browser. This cannot be undone." actionLabel="Delete purchase order" destructive onConfirm={remove} onClose={() => { setConfirmDelete(false); setActionError(''); }} error={actionError} />}
  </div></AdminLayout>;
}