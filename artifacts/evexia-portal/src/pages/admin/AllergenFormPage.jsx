import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, FlaskConical, RefreshCw } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import AllergenRefPicker from '../../components/admin/AllergenRefPicker.jsx';
import AllergenSearchableSelect from '../../components/admin/AllergenSearchableSelect.jsx';
import InfoDisclosure from '../../components/admin/InfoDisclosure.jsx';
import { allergenPayload, createAllergen, editAllergen, getAllergen, listAllergens, validateAllergen, setupDilutionMaterial } from '../../services/serverAllergens.js';
import { catalogueRate } from '../../services/rates.js';
import { findHsnMappings, lookupAllergenHsn, normalGst } from '../../services/serverHsn.js';
import { ALLERGEN_CONCENTRATIONS } from '../../services/allergenConcentrations.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import '../../mr.css';
import '../../allergen.css';

const LIST = '/admin/masters/allergens';
const empty = () => ({ name: '', category_id: '', storage_location_id: '', selling_price: '', gst: '', concentration: '', threshold_limit: '', hsn_code: '', status: 'active', mix: false });
const fromRecord = (r) => ({ name: r.name, category_id: r.category_id, storage_location_id: r.storage_location_id, selling_price: r.selling_price ?? '', gst: r.gst, concentration: r.concentration, threshold_limit: r.threshold_limit ?? '', hsn_code: r.hsn_code ?? '', status: r.status, mix: r.inventoryOnly === true || r.mix === true });
const norm = (v) => v.trim().replace(/\s+/g, ' ').toLowerCase();
const summary = (r) => `${r.name}; ${r.category_name}; ${r.storage_location_name}; price ${r.selling_price ?? 'none'}; GST ${r.gst}; HSN ${r.hsn_code ?? 'none'}; ${r.concentration}; low stock alert ${r.threshold_limit ?? 'none'}; ${r.mix ? 'Mix' : 'No Mix'}; ${r.status}`;

function AllergenForm({ record, onSave, onCancel, onRefresh }) {
  const [dilutionSetup, setDilutionSetup] = useState(false);
  const dilutionMaterial = dilutionSetup || record?.inventoryOnly === true;
  const setupKey = useRef(crypto.randomUUID());
  const [values, setValues] = useState(() => record ? fromRecord(record) : empty());
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const [choices, setChoices] = useState([]);
  const [lookupNote, setLookupNote] = useState('');
  const lookupSeq = useRef(0);
  const lookupCtl = useRef(null);
  const clearLookup = () => { lookupSeq.current += 1; lookupCtl.current?.abort(); setChoices([]); setLookupNote(''); };
  useEffect(() => {
    alive.current = true;
    const owner = getSession().user?.id;
    const unsubscribe = subscribeSession(() => {
      const s = getSession();
      if (s.user?.id !== owner || !['authenticated', 'renewing', 'renewal-error'].includes(s.status)) { setValues(empty()); setServerError(''); setErrors({}); clearLookup(); }
    });
    return () => { alive.current = false; lookupCtl.current?.abort(); unsubscribe(); };
  }, []);
  function update(field, value) {
    setValues((c) => ({ ...c, [field]: value }));
    setErrors((c) => ({ ...c, [field]: undefined }));
    if (!blocked) setServerError('');
  }
  const pairChanged = (v) => !record || String(v.hsn_code).trim() !== String(record.hsn_code ?? '') || String(v.gst).trim() !== String(record.gst ?? '');
  async function lookup(params) {
    const seq = ++lookupSeq.current;
    lookupCtl.current?.abort(); lookupCtl.current = new AbortController();
    const guard = reportingIdentityGuard();
    try {
      const page = await lookupAllergenHsn({ ...params, limit: 25, offset: 0 }, lookupCtl.current.signal); guard();
      if (seq !== lookupSeq.current || !alive.current) return null;
      const items = (page.items || []).filter((i) => !i.status || i.status === 'active');
      setChoices(items);
      setLookupNote(page.filtered > items.length ? `Showing ${items.length} of ${page.filtered} active mappings; type a full code or GST rate to narrow.` : '');
      return items;
    } catch (cause) {
      if (cause?.name === 'AbortError') return null;
      try { guard(); } catch { return null; }
      if (seq === lookupSeq.current && alive.current) setLookupNote(`HSN lookup unavailable: ${cause.message}. Your entries are kept.`);
      return null;
    }
  }
  const draft = useRef(values);
  useEffect(() => { void lookup({ query: '' }); }, []);
  draft.current = values;
  async function hsnBlur() {
    if (record && !pairChanged(values)) return;
    const code = values.hsn_code.trim(); const gstAt = values.gst;
    if (!/^[0-9]{1,16}$/.test(code)) return;
    const guard = reportingIdentityGuard(); const gen = lookupSeq.current + 1;
    if (!(await lookup({ query: code }))) return;
    let items; try { items = await findHsnMappings({ code }); guard(); } catch (cause) { try { guard(); } catch { return; } if (alive.current) setLookupNote(cause.message); return; }
    const cur = draft.current;
    if (!alive.current || gen !== lookupSeq.current || cur.hsn_code.trim() !== code || cur.gst !== gstAt) return;
    const hit = items.find((i) => i.code === code);
    if (hit) { setValues((c) => c.hsn_code.trim() === code && c.gst === gstAt ? { ...c, gst: String(hit.gst) } : c); setErrors((c) => ({ ...c, gst: undefined, hsn_code: undefined })); }
    else setErrors((c) => ({ ...c, hsn_code: 'No active HSN mapping has this exact code.' }));
  }
  async function gstBlur(n) {
    if (n === null) return;
    const at = { ...values, gst: n };
    if (record && !pairChanged(at)) return;
    const codeAt = values.hsn_code;
    const guard = reportingIdentityGuard(); const gen = lookupSeq.current + 1;
    if (!(await lookup({ query: n }))) return;
    let items; try { items = await findHsnMappings({ gst: n }); guard(); } catch (cause) { try { guard(); } catch { return; } if (alive.current) setLookupNote(cause.message); return; }
    const cur = draft.current;
    if (!alive.current || gen !== lookupSeq.current || normalGst(cur.gst) !== n || cur.hsn_code !== codeAt) return;
    const hits = items.filter((i) => normalGst(i.gst) === n);
    if (hits.length === 1) { setValues((c) => normalGst(c.gst) === n && c.hsn_code === codeAt ? { ...c, hsn_code: hits[0].code } : c); setErrors((c) => ({ ...c, hsn_code: undefined })); }
    else if (!hits.length && !dilutionMaterial) setErrors((c) => ({ ...c, hsn_code: `No active HSN mapping for GST ${n}%.` }));
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const next = validateAllergen(values, { dilutionSetup, inventoryOnly: record?.inventoryOnly === true, isNew: !record, existing: record });
    setErrors(next);
    if (Object.keys(next).length) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true); setServerError('');
    try {
      const code = values.hsn_code.trim();
      if (code && pairChanged(values)) {
        let hits;
        try { hits = await findHsnMappings({ code }); guard(); }
        catch (cause) { try { guard(); } catch { return; } if (alive.current) setServerError(`HSN mapping could not be verified: ${cause.message}. Nothing was saved; your draft is retained.`); return; }
        const hit = hits.find((i) => i.code === code);
        if (!hit) { if (alive.current) setErrors((c) => ({ ...c, hsn_code: 'No active HSN mapping has this exact code.' })); return; }
        if (normalGst(hit.gst) !== normalGst(values.gst)) { if (alive.current) setErrors((c) => ({ ...c, hsn_code: `HSN ${code} maps to GST ${hit.gst}%, not ${values.gst}%.` })); return; }
      } await onSave(allergenPayload(values), dilutionSetup ? setupKey.current : null); }
    catch (cause) {
      try { guard(); } catch { return; }
      if (alive.current) {
        if (cause.fields) setErrors((current) => ({ ...current, ...cause.fields }));
        setServerError(cause.message); setBlocked(/stale|conflict/.test(cause.code || '') || Boolean(cause.ambiguous) || cause.code === 'not_found');
      }
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  async function reconcile() {
    if (busy.current) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending(true);
    try {
      const current = await onRefresh(values); guard();
      if (!alive.current) return;
      setServerError(current ? `Current server record: ${summary(current)}. Your draft is retained. Compare these details before saving again.` : 'No matching record exists. Your draft is retained; review before retrying.');
      setBlocked(false);
    } catch (cause) {
      if (cause.fields) setErrors((current) => ({ ...current, ...cause.fields }));
      try { guard(); } catch { return; }
      if (alive.current) setServerError(cause.message);
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }
  const err = (name) => errors[name] && <p className="mr-form__error" id={`allergen-${name}-error`} role="alert">{errors[name]}</p>;
  const text = (name, label, { optional = false, info, hint, numeric = false, max } = {}) => {
    const fieldLabel = <label className="mr-form__label" htmlFor={`allergen-${name}`}>{label} {optional ? <span className="mr-form__hint">(optional)</span> : <span className="mr-form__required">*</span>}</label>;
    return <div className="mr-form__field">
    {info ? <InfoDisclosure id={`allergen-${name}-help`} title={label} text={info} testId={`button-allergen-${name}-info`}>{fieldLabel}</InfoDisclosure> : fieldLabel}
    <input id={`allergen-${name}`} className="mr-form__control" inputMode={numeric ? 'decimal' : undefined} maxLength={max} value={values[name]} onChange={(e) => update(name, e.target.value)} onBlur={() => { if (['selling_price', 'gst'].includes(name) && values[name]) { try { update(name, catalogueRate(values[name], name === 'gst')); } catch { /* Preserve invalid drafts for correction. */ } } }} aria-invalid={Boolean(errors[name])} aria-describedby={[hint && `allergen-${name}-hint`, errors[name] && `allergen-${name}-error`].filter(Boolean).join(' ') || undefined} data-testid={`input-allergen-${name}`} />
    {hint && <p id={`allergen-${name}-hint`} className="mr-form__hint">{hint}</p>}
    {err(name)}
  </div>;
  };
  const decimalHint = 'Plain decimal, up to 12 integer and 6 source fractional digits. Rounded half-up to two places on save (1.005 → 1.01); rounded maximum 999999999999.99.';
  return <form className="admin-allergen-form" onSubmit={submit} noValidate>
    <div className="admin-allergen-form__intro"><div><h2>Product details</h2><p>Fields marked * are required. Records are shared on the server.</p></div><FlaskConical size={21} aria-hidden="true" /></div>
    <div className="mr-form__body">
      {!record && getSession().user?.identity_kind === 'super_admin' && <div className="mr-form__field">
        <label><input type="checkbox" checked={dilutionSetup} disabled={pending || blocked} onChange={(event) => {
          setDilutionSetup(event.target.checked);
          if (event.target.checked) setValues((current) => ({ ...current, mix: true }));
          setErrors({});
        }} /> Explicitly create and bind the dummy Dilution material</label>
        {dilutionSetup && <p className="mr-form__hint">Creates a separate inventory/pricing material, not a clinical allergen. Enter its name, real category and storage location, required master description and GST explicitly. Use Active and blank selling price. Dilution is always Mix. An optional low stock alert in ml may be entered, including zero; blank disables alerts. Nothing is inferred or seeded; configure actual cutoff rates later in Pricing Rules. An existing similarly named record will never be overwritten.</p>}
      </div>}
      {record?.inventoryOnly && <p className="mr-form__hint">Bound Dilution material — inventory and Pricing Rules only; excluded from clinical allergen selection.</p>}
      {serverError && <div className="mr-form__notice mr-form__notice--error" role="alert"><p>{serverError}</p><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={reconcile} data-testid="button-reconcile-allergen"><RefreshCw size={16} aria-hidden="true" /> Review current server details (keep draft)</button></div>}
      <fieldset className="mr-form__grid" disabled={pending} style={{ border: 0, margin: 0, padding: 0 }}>
        {text('name', 'Product name', { max: 200 })}
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-category">Product category <span className="mr-form__required">*</span></label>
          <AllergenRefPicker id="allergen-category" kind="categories" label="Product category" value={values.category_id} disabled={pending} describedBy={errors.category_id ? 'allergen-category_id-error' : undefined} invalid={Boolean(errors.category_id)} testId="select-allergen-category"
            retained={record ? { id: record.category_id, name: record.category_name, status: record.category_status } : null} onChange={(id) => update('category_id', id)} />
          {err('category_id')}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-location">Storage location <span className="mr-form__required">*</span></label>
          <AllergenRefPicker id="allergen-location" kind="locations" label="Storage location" value={values.storage_location_id} disabled={pending} describedBy={errors.storage_location_id ? 'allergen-storage_location_id-error' : undefined} invalid={Boolean(errors.storage_location_id)} testId="select-allergen-location"
            retained={record ? { id: record.storage_location_id, name: record.storage_location_name, status: record.storage_location_status } : null} onChange={(id) => update('storage_location_id', id)} />
          {err('storage_location_id')}</div>
        {text('selling_price', 'Selling price', { optional: true, numeric: true, info: decimalHint, hint: dilutionSetup ? 'Must be blank for Dilution setup. Configure actual cutoff rates later in Pricing Rules.' : undefined })}
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-gst">GST (%) <span className="mr-form__required">*</span></label>
          <input id="allergen-gst" className="mr-form__control" inputMode="decimal" list="allergen-hsn-gst-choices" value={values.gst} onChange={(e) => { lookupSeq.current += 1; update('gst', e.target.value); void lookup({ query: e.target.value }); }} onBlur={() => { const n = normalGst(values.gst); if (n !== null && n !== values.gst) update('gst', n); void gstBlur(n); }} aria-invalid={Boolean(errors.gst)} aria-describedby={errors.gst ? 'allergen-gst-error' : 'allergen-gst-hint'} data-testid="input-allergen-gst" />
          <datalist id="allergen-hsn-gst-choices">{[...new Set(choices.map((c) => String(c.gst)))].map((g) => <option key={g} value={g} />)}</datalist>
          <p id="allergen-gst-hint" className="mr-form__hint">0 to 100, rounded half-up to two places. Fills the matching active HSN code.</p>{err('gst')}</div>
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-hsn_code">HSN code {dilutionMaterial ? <span className="mr-form__hint">(optional)</span> : <span className="mr-form__required">*</span>}</label>
          <input id="allergen-hsn_code" className="mr-form__control" inputMode="numeric" maxLength={16} autoComplete="off" list="allergen-hsn-code-choices" value={values.hsn_code} onChange={(e) => { const v = e.target.value; lookupSeq.current += 1; update('hsn_code', v); if (/^[0-9]{1,16}$/.test(v.trim())) void lookup({ query: v.trim() }); }} onBlur={() => void hsnBlur()} aria-invalid={Boolean(errors.hsn_code)} aria-describedby={['allergen-hsn_code-hint', errors.hsn_code && 'allergen-hsn_code-error'].filter(Boolean).join(' ')} data-testid="input-allergen-hsn_code" />
          <datalist id="allergen-hsn-code-choices">{choices.map((c) => <option key={c.id ?? c.code} value={c.code}>{`GST ${c.gst}%`}</option>)}</datalist>
          {choices.length > 0 && <AllergenSearchableSelect id="allergen-hsn-choice" label="Active HSN mappings" value="" placeholder="Pick an active mapping" disabled={pending} testId="select-allergen-hsn-choice" options={choices.map((c) => ({ value: c.code, label: `${c.code} · GST ${c.gst}%` }))} onChange={(code) => { const c = choices.find((i) => i.code === code); if (c) { setValues((v) => ({ ...v, hsn_code: c.code, gst: String(c.gst) })); setErrors((e) => ({ ...e, hsn_code: undefined, gst: undefined })); } }} />}
          <p id="allergen-hsn_code-hint" className="mr-form__hint">{record && !pairChanged(values) ? 'Saved HSN/GST pair retained unchanged. ' : 'Must match an active HSN mapping for this GST. '}{lookupNote}</p>{err('hsn_code')}</div>
        {dilutionSetup ? text('concentration', 'Required master description', { max: 200, hint: 'Enter the supplied description. This material is not a clinical formulation; no concentration or ratio is assumed.' }) : <div className="mr-form__field">
          <label className="mr-form__label" htmlFor="allergen-concentration">Concentration <span className="mr-form__required">*</span></label>
          <AllergenSearchableSelect id="allergen-concentration" label="Concentration" value={values.concentration} disabled={pending} placeholder="Select concentration"
            invalid={Boolean(errors.concentration)} describedBy={errors.concentration ? 'allergen-concentration-error' : undefined} testId="select-allergen-concentration"
            options={[
              ...(values.concentration && !ALLERGEN_CONCENTRATIONS.includes(values.concentration) ? [{ value: values.concentration, label: `${values.concentration} (saved)` }] : []),
              ...ALLERGEN_CONCENTRATIONS.map((value) => ({ value, label: value })),
            ]} onChange={(value) => update('concentration', value)} />
          {err('concentration')}
        </div>}
         {text('threshold_limit', 'Low stock alert (ml)', { optional: dilutionMaterial || (record && (record.threshold_limit == null || record.threshold_limit === '')), numeric: true, info: 'Stock threshold, not a rate. Up to 12 integer and 6 fractional digits; retained without rounding.', hint: `In ml. ${dilutionMaterial ? 'Blank disables alerts.' : record && record.threshold_limit == null ? 'A historical blank may be retained.' : 'Required; enter an explicit value.'} 0 alerts only at zero stock. Stock alert includes quantities at or below this value.` })}
        <div className="mr-form__field"><label className="mr-form__label" htmlFor="allergen-status">Status <span className="mr-form__required">*</span></label><AllergenSearchableSelect id="allergen-status" label="Status" value={values.status} disabled={pending} placeholder="Select status" invalid={Boolean(errors.status)} describedBy={errors.status ? 'allergen-status-error' : undefined} testId="select-allergen-status" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} onChange={(value) => update('status', value)} />{err('status')}</div>
        <div className="mr-form__field"><span className="mr-form__label" id="allergen-mix-label">Mix / No Mix</span>
          <button type="button" role="switch" disabled={dilutionMaterial} aria-checked={values.mix} aria-labelledby="allergen-mix-label allergen-mix-state" aria-invalid={Boolean(errors.mix)} aria-describedby={['allergen-mix-hint', errors.mix && 'allergen-mix-error'].filter(Boolean).join(' ')} className="admin-allergen-switch" onClick={() => update('mix', !values.mix)} data-testid="switch-allergen-mix">
            <span className="admin-allergen-switch__track" aria-hidden="true"><span className="admin-allergen-switch__thumb" /></span>
            <strong id="allergen-mix-state" data-testid="text-allergen-mix-state">{values.mix ? 'Mix' : 'No Mix'}</strong>
          </button>
          <p id="allergen-mix-hint" className="mr-form__hint">{dilutionMaterial ? 'Dilution is always Mix; this selection is locked. Inventory/pricing only, never a clinical bottle ingredient. ' : ''}Catalogue metadata only. Not a stock mixing operation.</p>{err('mix')}</div>
      </fieldset>
    </div>
    <div className="mr-form__footer"><div className="mr-form__actions"><button type="button" disabled={pending} className="admin-button admin-button--secondary" onClick={onCancel} data-testid="button-cancel-allergen">Cancel</button><button type="submit" disabled={pending || blocked} className="admin-button" data-testid="button-save-allergen">{pending ? 'Saving…' : record ? 'Save changes' : 'Save product'}</button></div></div>
  </form>;
}

export default function AllergenFormPage({ id }) {
  const [, navigate] = useLocation();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(id));
  const [revision, setRevision] = useState(0);
  const snapshot = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const owner = getSession().user?.id;
    return subscribeSession(() => { if (getSession().user?.id !== owner) { snapshot.current = null; setRecord(null); } });
  }, []);
  useEffect(() => {
    let active = true;
    if (!id) return undefined;
    const guard = reportingIdentityGuard();
    setLoading(true);
    getAllergen(id).then((row) => { guard(); if (active) { snapshot.current = row; setRecord(row); setError(''); } })
      .catch((cause) => { try { guard(); } catch { return; } if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, revision]);
  async function refresh(values) {
    if (!id) {
      const result = await listAllergens({ query: values.name.trim(), status: 'all', mix: 'all', limit: 100, offset: 0 });
      const same = result.items.find((row) => norm(row.name) === norm(values.name));
      if (same) throw new Error(`A product with this name is already saved: ${summary(same)}. Your draft is retained. Inspect the list instead of creating a duplicate.`);
      if (result.filtered > 100) throw new Error('More than 100 matches. Inspect the list before retrying.');
      return null;
    }
    const current = await getAllergen(id);
    snapshot.current = current;
    return current;
  }
  async function save(values, dilutionSetupKey) {
    const guard = reportingIdentityGuard();
    await (id ? editAllergen(snapshot.current, values) : dilutionSetupKey
      ? setupDilutionMaterial(values, dilutionSetupKey) : createAllergen(values));
    guard();
    if (alive.current) navigate(`${LIST}?saved=${id ? 'updated' : 'added'}`);
  }
  const title = id ? 'Edit product' : 'Add product';
  return <AdminLayout title={title}>
    <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Masters / Inventory / Allergen Master</p><h1>{title}</h1><p className="admin-page-head__description">Manage a shared allergen product’s details, reference masters and availability.</p></div><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST)} data-testid="button-back-allergens"><ArrowLeft size={16} aria-hidden="true" /> Back to allergens</button></div>
    {loading ? <p role="status">Loading product…</p> : error || (id && !record) ? <section className="admin-panel admin-allergen-form__recovery" role="alert"><h2>Product could not be loaded</h2><p>{error || 'This product may have been deleted.'}</p><div className="mr-form__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => navigate(LIST)}>Return to allergens</button><button type="button" className="admin-button" onClick={() => setRevision((v) => v + 1)} data-testid="button-refresh-allergen-form">Retry</button></div></section>
      : <section className="admin-panel admin-allergen-panel" aria-label={title}><AllergenForm key={id || 'new'} record={record} onSave={save} onCancel={() => navigate(LIST)} onRefresh={refresh} /></section>}
  </AdminLayout>;
}
