import { useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import { useMoveStocks } from '../../hooks/useMoveStocks.js';
import { validateMovement } from '../../services/moveStocksDemo.js';
import '../../mr.css';
import '../../moveStocks.css';

const BASE = '/admin/inventory/move-stocks';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const newId = () => globalThis.crypto?.randomUUID?.() || `move-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function MoveStockFormPage() {
  const [, navigate] = useLocation();
  const { snapshot, submitMovement } = useMoveStocks();
  const submissionId = useRef(newId());
  const lock = useRef(false);
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [date, setDate] = useState(today);
  const [deliveredBy, setDeliveredBy] = useState('');
  const [qty, setQty] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const { locations, products, balances } = snapshot;
  const stock = balances[sourceId] || {};
  const available = products.filter((p) => Number(stock[p.id]) > 0);
  const selectedIds = Object.keys(qty);
  const selected = products.filter((p) => selectedIds.includes(p.id));
  const totals = {};
  selected.forEach((p) => { const n = Number(qty[p.id]); if (Number.isInteger(n) && n > 0) totals[p.unit] = (totals[p.unit] || 0) + n; });
  const values = () => ({ sourceId, destinationId, date, deliveredBy, lines: selected.map((p) => ({ productId: p.id, quantity: qty[p.id] })) });

  function changeSource(id) { setSourceId(id); setQty({}); if (id === destinationId) setDestinationId(''); setErrors({}); }
  function toggle(id) { setQty((q) => { const n = { ...q }; if (id in n) delete n[id]; else n[id] = ''; return n; }); setErrors((e) => ({ ...e, lines: undefined, [`quantity.${id}`]: undefined })); }
  const clear = (k) => setErrors((e) => ({ ...e, [k]: undefined }));

  function submit(e) {
    e.preventDefault();
    if (lock.current) return;
    const v = values();
    const check = validateMovement(snapshot, v);
    if (Object.keys(check.errors).length) { setErrors(check.errors); return; }
    lock.current = true; setSaving(true);
    const result = submitMovement(v, submissionId.current);
    if (result.errors && Object.keys(result.errors).length) { setErrors(result.errors); lock.current = false; setSaving(false); return; }
    navigate(BASE);
  }

  const fieldProps = (k, hint) => ({ 'aria-invalid': Boolean(errors[k]), 'aria-describedby': errors[k] ? `ms-${k}-error` : hint });
  const err = (k) => errors[k] && <p id={`ms-${k}-error`} className="mr-form__error" role="alert">{errors[k]}</p>;
  const qtyErrors = Object.keys(errors).some((k) => k.startsWith('quantity.') && Boolean(errors[k]));

  return <AdminLayout title="Move stock"><div className="move-stocks-page">
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Inventory / Move stocks / New</p><h1>Move stock</h1><p className="admin-page-head__description">Choose a source, a destination and whole units to transfer.</p></div>
      <div className="ms-head-actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} data-testid="button-back-move"><ArrowLeft size={16} /> All movements</button></div></div>
    <div className="admin-feedback ms-note" role="note" data-testid="text-move-guidance">This screen records stock movements between storage locations, including transfer dates, delivery details and product quantities.</div>
    <section className="admin-panel" aria-label="New stock movement">
      <form onSubmit={submit} noValidate>
        <div className="ms-form-body">
          <div className="ms-fields">
            <div className="ms-field"><label htmlFor="ms-source">Source location <span className="mr-form__required">*</span></label>
              <SearchableSelect id="ms-source" label="Source location" value={sourceId} options={locations.map((l) => ({ value: l.id, label: l.name }))} onChange={changeSource} placeholder="Select demo source" invalid={Boolean(errors.sourceId)} describedBy={errors.sourceId ? 'ms-sourceId-error' : undefined} />{err('sourceId')}</div>
            <div className="ms-field"><label htmlFor="ms-dest">Destination location <span className="mr-form__required">*</span></label>
              <SearchableSelect id="ms-dest" label="Destination location" value={destinationId} options={locations.filter((l) => l.id !== sourceId).map((l) => ({ value: l.id, label: l.name }))} onChange={(id) => { setDestinationId(id); clear('destinationId'); }} placeholder="Select demo destination" invalid={Boolean(errors.destinationId)} describedBy={errors.destinationId ? 'ms-destinationId-error' : undefined} />{err('destinationId')}</div>
            <div className="ms-field"><label htmlFor="ms-date">Date <span className="mr-form__required">*</span></label>
              <input id="ms-date" type="date" className="mr-form__control" value={date} onChange={(e) => { setDate(e.target.value); clear('date'); }} {...fieldProps('date')} data-testid="input-move-date" />{err('date')}</div>
            <div className="ms-field"><label htmlFor="ms-by">Delivered by <span className="mr-form__required">*</span></label>
              <input id="ms-by" className="mr-form__control" value={deliveredBy} maxLength={80} onChange={(e) => { setDeliveredBy(e.target.value); clear('deliveredBy'); }} {...fieldProps('deliveredBy', 'ms-by-hint')} data-testid="input-move-delivered-by" />
              {errors.deliveredBy ? err('deliveredBy') : <p id="ms-by-hint" className="mr-form__hint">Recorded name only. It is not verified.</p>}</div>
          </div>
          <fieldset className="ms-products" aria-describedby={errors.lines ? 'ms-lines-error' : undefined}>
            <legend className="ms-legend">Products to move <span className="mr-form__required">*</span></legend>
            {!sourceId ? <div className="admin-empty" role="status"><strong>Select a source location</strong><p>Products with stock there will be listed.</p></div>
              : !available.length ? <div className="admin-empty" role="status" data-testid="text-move-empty-source"><strong>No stock at this source</strong><p>Choose another source location that holds stock.</p></div>
              : <div className="admin-table-scroll ms-stock-table" role="region" aria-label="Source demo allergen stock" tabIndex={0}><table className="admin-table"><thead><tr><th scope="col">Select</th><th scope="col">Allergen product</th><th scope="col">Available quantity</th><th scope="col">Quantity to move</th></tr></thead><tbody>{available.map((p) => { const on = p.id in qty; const max = Number(stock[p.id]); return <tr key={p.id}>
                <td><input type="checkbox" id={`ms-p-${p.id}`} checked={on} onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} data-testid={`checkbox-move-product-${p.id}`} /></td>
                <td><label htmlFor={`ms-p-${p.id}`} className="ms-product__name">{p.name}</label></td>
                <td data-testid={`text-move-available-${p.id}`}>{max} {p.unit}</td>
                <td>{on ? <div className="ms-qty"><label htmlFor={`ms-q-${p.id}`}>Quantity ({p.unit})</label>
                  <input id={`ms-q-${p.id}`} className="mr-form__control" type="number" inputMode="numeric" min="1" max={max} step="1" value={qty[p.id]} onChange={(e) => { const val = e.target.value; setQty((q) => ({ ...q, [p.id]: val })); clear(`quantity.${p.id}`); clear('lines'); }} aria-invalid={Boolean(errors[`quantity.${p.id}`])} aria-describedby={errors[`quantity.${p.id}`] ? `ms-quantity.${p.id}-error` : undefined} data-testid={`input-move-qty-${p.id}`} />
                  {errors[`quantity.${p.id}`] && <p id={`ms-quantity.${p.id}-error`} className="mr-form__error" role="alert">{errors[`quantity.${p.id}`]}</p>}</div> : <span className="mr-form__hint">Select product first</span>}</td>
              </tr>; })}</tbody></table></div>}
            {errors.lines && <p id="ms-lines-error" className="mr-form__error" role="alert">{errors.lines}</p>}
            {qtyErrors && !errors.lines && <p className="mr-form__error" role="alert">Fix the highlighted quantities.</p>}
          </fieldset>
          {selected.length > 0 && <div><h2 className="ms-section-title">Summary: {selected.length} {selected.length === 1 ? 'product' : 'products'}</h2>
            <ul className="ms-totals" data-testid="text-move-totals">{Object.entries(totals).map(([u, n]) => <li key={u}>{n} {u}</li>)}{!Object.keys(totals).length && <li>Enter quantities</li>}</ul></div>}
        </div>
        <div className="ms-footer"><span>Saves to this preview only.</span><div className="ms-head-actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(BASE)} data-testid="button-cancel-move">Cancel</button>
          <button type="submit" className="admin-button" disabled={saving} data-testid="button-save-move">{saving ? 'Saving…' : 'Move stock'}</button></div></div>
      </form>
    </section>
  </div></AdminLayout>;
}
