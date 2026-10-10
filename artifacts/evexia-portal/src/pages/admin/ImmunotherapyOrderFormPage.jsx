import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Pencil, Plus, Trash2, UserPlus, Paperclip } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import PhoneInput from '../../components/admin/PhoneInput.jsx';
import ImmDialog from '../../components/immunotherapy/ImmDialog.jsx';
import { StatusPill } from './ImmunotherapyOrders.jsx';
import { setNavigationGuard } from '../../auth/navigationGuard.js';
import { ALLERGENS, DOCTORS, DOSES, GENDERS, MRS, STATUSES, demoStore, groupingError, money, newGroup, nextDose, parseAmount, shippingRecipient, totalMinor, validateAttachments } from '../../services/immunotherapyDemo.js';
import '../../immunotherapy.css';

const BASE = '/admin/orders/immunotherapy';
const blankReg = () => ({ name: '', age: '', gender: '', phone: '', dialCountry: 'IN', address: { line1: '', line2: '', landmark: '', pincode: '', city: '', state: '', country: 'India' }, doctorId: '', mrId: '' });
const blank = () => ({ patientId: '', doctorId: '', mrId: '', dosage: '', histamine: '', saline: '', groups: [newGroup()], remarks: '', poNumber: '', attachments: [], shipping: 'patient', status: 'Confirmed' });
const fromOrder = (o) => structuredClone({ patientId: o.patientId, doctorId: o.doctorId, mrId: o.mrId, dosage: o.dosage, histamine: o.histamine, saline: o.saline, groups: o.groups, remarks: o.remarks || '', poNumber: o.poNumber || '', attachments: o.attachments || [], shipping: o.shipping, status: o.status });
const addr = (a) => a ? [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';
const nameOf = (list, id) => list.find((x) => x.id === id)?.name || '';
const ERROR_LABEL = { patientId: 'Patient', doctorId: 'Doctor', mrId: 'MR', dosage: 'Dosage', histamine: 'Histamine', saline: 'Saline', shipping: 'Shipping', groups: 'Bottles', attachments: 'Prescription files', status: 'Status', registration: 'Patient registration' };
const kb = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function Err({ id, text }) { return text ? <p className="imm-error" id={id} role="alert">{text}</p> : null; }

export default function ImmunotherapyOrderFormPage({ id, mode }) {
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const order = id ? snap.orders.find((o) => o.id === id) : null;
  if (id && !order) return <AdminLayout title="IMMUNOTHERAPY"><div className="imm"><div className="admin-panel imm-empty" data-testid="empty-imm-missing">
    <h1>Order not available</h1><p>This demo order does not exist. Demo data resets when the page reloads.</p>
    <Link href={BASE} className="admin-button">Back to orders</Link></div></div></AdminLayout>;
  return <Editor key={`${id || 'new'}-${mode}`} order={order} mode={mode} snap={snap} />;
}

function Editor({ order, mode, snap }) {
  const [, navigate] = useLocation();
  const readOnly = mode === 'view';
  const isNew = !order;
  const initial = useRef(order ? fromOrder(order) : blank());
  const [v, setV] = useState(initial.current);
  const [errors, setErrors] = useState({});
  const [groupMsg, setGroupMsg] = useState({});
  const [explain, setExplain] = useState('');
  const [reg, setReg] = useState(null);
  const [regErrors, setRegErrors] = useState({});
  const [leave, setLeave] = useState(null);
  const [fileMsg, setFileMsg] = useState('');
  const openerRef = useRef(null);
  const regNameRef = useRef(null);
  const focusId = (target) => requestAnimationFrame(() => { const el = document.getElementById(target); if (el) { el.scrollIntoView?.({ block: 'center' }); el.focus(); } });
  const summaryRef = useRef(null);
  const dirtyRef = useRef(false);
  const dirty = !readOnly && JSON.stringify(v) !== JSON.stringify(initial.current);
  const regOpen = Boolean(reg);
  dirtyRef.current = dirty || regOpen;
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    if (readOnly) return undefined;
    const release = setNavigationGuard((request) => { if (!dirtyRef.current) return false; setLeave(request); return true; });
    const warn = (e) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    const interceptLink = (e) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const target = new URL(link.href, window.location.href);
      if (target.href === window.location.href) return;
      e.preventDefault(); e.stopPropagation();
      setLeave({ kind: 'raw', href: target.href });
    };
    document.addEventListener('click', interceptLink, true);
    window.addEventListener('beforeunload', warn);
    return () => { release(); window.removeEventListener('beforeunload', warn); document.removeEventListener('click', interceptLink, true); };
  }, [readOnly]);

  useEffect(() => { if (regOpen) regNameRef.current?.focus(); }, [regOpen]);
  const closeReg = () => { setReg(null); setRegErrors({}); requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus()); };

  const patient = snap.patients.find((p) => p.id === v.patientId);
  const patientOptions = useMemo(() => snap.patients.map((p) => ({ value: p.id, label: `${p.name} - ${p.id} - ${p.phone}` })), [snap.patients]);
  const doctorOptions = DOCTORS.map((d) => ({ value: d.id, label: d.name }));
  const mrOptions = MRS.map((m) => ({ value: m.id, label: m.name }));
  const allergenOptions = ALLERGENS.map((a) => ({ value: a.id, label: `${a.name} (${a.mix ? 'Mix' : 'No Mix'})` }));
  const total = totalMinor(v.groups);
  const doctor = DOCTORS.find((d) => d.id === v.doctorId);
  const recipient = shippingRecipient({ ...v, id: order?.id }, snap.patients);

  function choosePatient(pid) {
    const p = snap.patients.find((x) => x.id === pid);
    const patch = { patientId: pid, shipping: 'patient', doctorId: p?.doctorId || '', mrId: p?.mrId || '' };
    if (p && order && pid === order.patientId) { patch.dosage = initial.current.dosage; setExplain('Saved dosage for this order restored. You may change it.'); }
    else if (p) { const n = nextDose(p); patch.dosage = n.dosage; setExplain(n.explanation); }
    else { patch.dosage = ''; setExplain(''); }
    set(patch);
  }
  const updGroup = (gid, fn) => set({ groups: v.groups.map((g) => g.id === gid ? fn(g) : g) });
  function addAllergen(gid, aid) {
    if (!aid) return;
    const g = v.groups.find((x) => x.id === gid);
    const items = [...g.items, { allergenId: aid, result: '' }];
    const problem = groupingError(items);
    if (problem) { setGroupMsg((m) => ({ ...m, [gid]: problem })); return; }
    setGroupMsg((m) => ({ ...m, [gid]: '' }));
    updGroup(gid, (x) => ({ ...x, items }));
  }
  function moveItem(fromId, aid, toId) {
    if (!toId) return;
    const src = v.groups.find((x) => x.id === fromId); const dst = v.groups.find((x) => x.id === toId);
    const item = src.items.find((i) => i.allergenId === aid);
    const items = [...dst.items, item];
    const problem = groupingError(items);
    if (problem) { setGroupMsg((m) => ({ ...m, [toId]: `Cannot move ${nameOf(ALLERGENS, aid)} here. ${problem}` })); return; }
    setGroupMsg((m) => ({ ...m, [toId]: '', [fromId]: '' }));
    set({ groups: v.groups.map((g) => g.id === fromId ? { ...g, items: g.items.filter((i) => i.allergenId !== aid) } : g.id === toId ? { ...g, items } : g) });
  }
  function addFiles(list) {
    const files = [...list];
    const msg = validateAttachments(files, v.attachments);
    setFileMsg(msg);
    if (!msg) set({ attachments: [...v.attachments, ...files.map((f) => ({ name: f.name, size: f.size, type: f.type }))] });
  }
  function register(e) {
    e.preventDefault();
    const { patient: created, errors: errs } = demoStore.registerPatient(reg);
    if (errs && Object.keys(errs).length) {
      setRegErrors(errs);
      const order_ = ['name', 'age', 'gender', 'phone', 'address-line1', 'address-pincode', 'address-city', 'address-state', 'address-country', 'doctorId', 'mrId'];
      const first = order_.find((k) => errs[k]);
      const map = { name: 'imm-reg-name', age: 'imm-reg-age', gender: 'imm-reg-gender', phone: reg.dialCountry ? 'imm-reg-phone' : 'imm-reg-dialCountry', doctorId: 'imm-reg-doctor', mrId: 'imm-reg-mr' };
      focusId(map[first] || `imm-reg-${String(first).replace('address-', '')}`);
      return;
    }
    setReg(null); setRegErrors({});
    set({ patientId: created.id, doctorId: created.doctorId, mrId: created.mrId, dosage: '', shipping: 'patient' });
    setExplain('Demo patient registered with no administration history. Choose a dosage explicitly.');
    requestAnimationFrame(() => document.getElementById('imm-patientId')?.focus());
  }
  function guarded(href) { if (dirtyRef.current) setLeave({ kind: 'href', href }); else navigate(href); }
  function save() {
    if (reg) { setErrors({ registration: 'Finish or cancel the patient registration before saving the order.' }); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    const { order: saved, errors: errs } = demoStore.saveOrder(v, order?.id);
    if (errs && Object.keys(errs).length) { setErrors(errs); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    initial.current = v; dirtyRef.current = false; setErrors({});
    navigate(`${BASE}`);
    return saved;
  }
  const proceed = () => {
    const r = leave; setLeave(null); dirtyRef.current = false; initial.current = v;
    if (r?.kind === 'run') r.run();
    else if (r?.kind === 'raw' && r.href) {
      const target = new URL(r.href, window.location.href);
      if (target.origin === window.location.origin) navigate(`${target.pathname}${target.search}${target.hash}`);
      else window.location.assign(target.href);
    }
    else if (r?.href) navigate(r.href);
  };
  const errList = Object.entries(errors);
  const gIndex = (gid) => v.groups.findIndex((g) => g.id === gid);
  const labelFor = (k) => {
    if (ERROR_LABEL[k]) return ERROR_LABEL[k];
    if (k.startsWith('group-')) return `Bottle ${gIndex(k.slice(6)) + 1}`;
    if (k.startsWith('mrp-')) return `Bottle ${gIndex(k.slice(4)) + 1} MRP`;
    if (k.startsWith('result-')) { const gi = v.groups.findIndex((g) => k.startsWith(`result-${g.id}-`)); const aid = gi >= 0 ? k.slice(`result-${v.groups[gi].id}-`.length) : ''; return `Bottle ${gi + 1} ${nameOf(ALLERGENS, aid)} result`; }
    return k;
  };
  const targetFor = (k) => {
    if (k === 'dosage') return `imm-dose-${v.dosage || DOSES[0]}`;
    if (k === 'shipping') return `imm-ship-${v.shipping}`;
    if (k === 'groups') return 'imm-add-bottle';
    if (k === 'attachments') return readOnly ? 'imm-files-hint' : 'imm-files';
    if (k === 'registration') return 'imm-reg-name';
    if (k.startsWith('group-')) return `imm-add-${gIndex(k.slice(6))}`;
    if (k.startsWith('mrp-')) return `imm-mrp-${gIndex(k.slice(4))}`;
    if (k.startsWith('result-')) { const gi = v.groups.findIndex((g) => k.startsWith(`result-${g.id}-`)); const aid = k.slice(`result-${v.groups[gi]?.id}-`.length); return `imm-r-${gi}-${v.groups[gi]?.items.findIndex((i) => i.allergenId === aid)}`; }
    return `imm-${k}`;
  };
  const dis = readOnly;
  const rf = (k, label, props = {}) => <label className="imm-field">{label}
    <input id={`imm-reg-${k}`} ref={k === 'name' ? regNameRef : undefined} value={reg[k]} onChange={(e) => setReg({ ...reg, [k]: e.target.value })} aria-invalid={Boolean(regErrors[k])} aria-describedby={regErrors[k] ? `imm-reg-${k}-err` : undefined} data-testid={`input-imm-reg-${k}`} {...props} />
    <Err id={`imm-reg-${k}-err`} text={regErrors[k]} /></label>;
  const af = (k, label) => <label className="imm-field">{label}
    <input id={`imm-reg-${k}`} value={reg.address[k]} onChange={(e) => setReg({ ...reg, address: { ...reg.address, [k]: e.target.value } })} aria-invalid={Boolean(regErrors[`address-${k}`])} aria-describedby={regErrors[`address-${k}`] ? `imm-reg-a-${k}-err` : undefined} data-testid={`input-imm-reg-${k}`} />
    <Err id={`imm-reg-a-${k}-err`} text={regErrors[`address-${k}`]} /></label>;

  return <AdminLayout title="IMMUNOTHERAPY"><div className="imm">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders / Immunotherapy</p>
        <h1>{isNew ? 'Add order' : `${readOnly ? 'Order' : 'Edit'} ${order.number}`}</h1>
        <p className="admin-page-head__description">{readOnly ? 'Read-only review of this demo order.' : 'Patient first, then dosage, bottles and shipping.'}</p></div>
      <div className="imm-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => guarded(BASE)} data-testid="button-imm-back"><ArrowLeft size={15} aria-hidden="true" />{readOnly ? 'Back' : 'Cancel'}</button>
        {readOnly && <Link href={`${BASE}/${order.id}/edit`} className="admin-button" data-testid="link-imm-to-edit"><Pencil size={15} aria-hidden="true" />Edit</Link>}
      </div>
    </div>
    <p className="imm-boundary">Fictional demo data kept in browser memory. Patients registered here are not Patient Master records.</p>
    {errList.length > 0 && <div className="imm-errors" role="alert" tabIndex={-1} ref={summaryRef} data-testid="error-imm-summary"><strong>Fix {errList.length} problem{errList.length > 1 ? 's' : ''} before saving</strong>
      <ul>{errList.map(([k, m]) => <li key={k}><button type="button" className="imm-link-btn" onClick={() => focusId(targetFor(k))} data-testid={`link-imm-error-${k}`}>{labelFor(k)}: {m}</button></li>)}</ul></div>}
    <div className="imm-layout">
      <div className="imm-main">
        <section className="admin-panel imm-section" aria-labelledby="imm-h-patient"><h2 id="imm-h-patient">Patient</h2>
          <p className="imm-hint">Search by name, ID or phone.</p>
          <div className="imm-grid" style={{ marginTop: 12 }}>
            <div className="imm-field"><label htmlFor="imm-patientId">Patient</label>
              <SearchableSelect id="imm-patientId" label="Patient" value={v.patientId} options={patientOptions} onChange={choosePatient} placeholder="Find a demo patient" invalid={errors.patientId} describedBy={errors.patientId ? 'imm-patientId-err' : undefined} disabled={dis} />
              <Err id="imm-patientId-err" text={errors.patientId} /></div>
            <div className="imm-field"><label htmlFor="imm-doctorId">Doctor</label>
              <SearchableSelect id="imm-doctorId" label="Doctor" value={v.doctorId} options={doctorOptions} onChange={(x) => set({ doctorId: x })} placeholder="Select doctor" invalid={errors.doctorId} describedBy={errors.doctorId ? 'imm-doctorId-err' : undefined} disabled={dis} />
              <Err id="imm-doctorId-err" text={errors.doctorId} /></div>
            <div className="imm-field"><label htmlFor="imm-mrId">MR</label>
              <SearchableSelect id="imm-mrId" label="MR" value={v.mrId} options={mrOptions} onChange={(x) => set({ mrId: x })} placeholder="Select MR" invalid={errors.mrId} describedBy={errors.mrId ? 'imm-mrId-err' : undefined} disabled={dis} />
              <Err id="imm-mrId-err" text={errors.mrId} /></div>
          </div>
          {patient && <dl className="imm-facts" data-testid="imm-patient-facts"><div><dt>Name</dt><dd>{patient.name}</dd></div><div><dt>Age / gender</dt><dd>{patient.age} / {patient.gender}</dd></div><div><dt>Phone</dt><dd>{patient.phone}</dd></div><div><dt>Address</dt><dd>{addr(patient.address)}</dd></div></dl>}
          {!readOnly && !reg && <div className="imm-btn-row" style={{ marginTop: 14 }}><button type="button" className="admin-button admin-button--secondary" onClick={(e) => { openerRef.current = e.currentTarget; setReg({ ...blankReg(), doctorId: v.doctorId, mrId: v.mrId }); setRegErrors({}); }} data-testid="button-imm-register"><UserPlus size={15} aria-hidden="true" />Register demo patient</button></div>}
          {reg && <form className="imm-reg" onSubmit={register} noValidate aria-label="Register demo patient" data-testid="form-imm-register">
            <h3>Register demo patient</h3>
            <p className="imm-hint">Creates a session-only patient and selects it. Your order stays as it is. City and state are typed manually; there is no PIN lookup.</p>
            <div className="imm-grid">{rf('name', 'Name')}{rf('age', 'Age', { inputMode: 'numeric' })}
              <label className="imm-field">Gender<select id="imm-reg-gender" value={reg.gender} onChange={(e) => setReg({ ...reg, gender: e.target.value })} aria-invalid={Boolean(regErrors.gender)} aria-describedby={regErrors.gender ? 'imm-reg-gender-err' : undefined} data-testid="select-imm-reg-gender"><option value="">Select</option>{GENDERS.map((g) => <option key={g}>{g}</option>)}</select><Err id="imm-reg-gender-err" text={regErrors.gender} /></label></div>
            <div className="imm-field"><span>Phone</span>
              <PhoneInput prefix="imm-reg" country={reg.dialCountry} onCountryChange={(c) => setReg({ ...reg, dialCountry: c })} countryError={regErrors.phone && !reg.dialCountry ? regErrors.phone : ''}
                inputProps={{ id: 'imm-reg-phone', name: 'phone', value: reg.phone, onChange: (e) => setReg({ ...reg, phone: e.target.value }), 'aria-label': 'Phone number', 'aria-invalid': Boolean(regErrors.phone), 'aria-describedby': regErrors.phone ? 'imm-reg-phone-err' : undefined, 'data-testid': 'input-imm-reg-phone' }} />
              <Err id="imm-reg-phone-err" text={regErrors.phone} /></div>
            <div className="imm-grid">{af('line1', 'Address line 1')}{af('line2', 'Address line 2 (optional)')}{af('landmark', 'Landmark (optional)')}{af('pincode', 'PIN code')}{af('city', 'City')}{af('state', 'State')}{af('country', 'Country')}</div>
            <div className="imm-grid">
              <label className="imm-field">Doctor<select id="imm-reg-doctor" value={reg.doctorId} onChange={(e) => setReg({ ...reg, doctorId: e.target.value })} aria-invalid={Boolean(regErrors.doctorId)} aria-describedby={regErrors.doctorId ? 'imm-reg-doctor-err' : undefined} data-testid="select-imm-reg-doctor"><option value="">Select</option>{DOCTORS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><Err id="imm-reg-doctor-err" text={regErrors.doctorId} /></label>
              <label className="imm-field">MR<select id="imm-reg-mr" value={reg.mrId} onChange={(e) => setReg({ ...reg, mrId: e.target.value })} aria-invalid={Boolean(regErrors.mrId)} aria-describedby={regErrors.mrId ? 'imm-reg-mr-err' : undefined} data-testid="select-imm-reg-mr"><option value="">Select</option>{MRS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><Err id="imm-reg-mr-err" text={regErrors.mrId} /></label></div>
            <div className="imm-reg__actions"><button type="submit" className="admin-button" data-testid="button-imm-reg-save">Register and select</button><button type="button" className="admin-button admin-button--secondary" onClick={closeReg} data-testid="button-imm-reg-cancel">Cancel registration</button></div>
          </form>}
        </section>

        <section className="admin-panel imm-section" aria-labelledby="imm-h-dose"><h2 id="imm-h-dose">Dosage and reactions</h2>
          <p className="imm-hint">An illustrative mock sequence, not a clinical recommendation.</p>
          <fieldset className="imm-chips" id="imm-dosage" style={{ marginTop: 12 }} aria-describedby={errors.dosage ? 'imm-dosage-err' : undefined}><legend>Dosage</legend>
            {DOSES.map((d) => <label className="imm-chip" key={d}><input id={`imm-dose-${d}`} type="radio" name="dosage" value={d} checked={v.dosage === d} disabled={dis} onChange={() => set({ dosage: d })} data-testid={`radio-imm-dose-${d}`} /><span>{d}</span></label>)}</fieldset>
          <Err id="imm-dosage-err" text={errors.dosage} />
          {explain && <p className="imm-explain" role="status" data-testid="text-imm-dose-explain">{explain}</p>}
          <div className="imm-grid" style={{ marginTop: 14 }}>
            {['histamine', 'saline'].map((k) => <div className="imm-field" key={k}><label htmlFor={`imm-${k}`}>{k === 'histamine' ? 'Histamine (mm)' : 'Saline (mm)'}</label>
              <input id={`imm-${k}`} inputMode="decimal" value={v[k]} disabled={dis} onChange={(e) => set({ [k]: e.target.value })} aria-invalid={Boolean(errors[k])} aria-describedby={`imm-${k}-hint${errors[k] ? ` imm-${k}-err` : ''}`} data-testid={`input-imm-${k}`} />
              <p className="imm-hint" id={`imm-${k}-hint`}>Measured wheal in mm.</p><Err id={`imm-${k}-err`} text={errors[k]} /></div>)}
          </div>
        </section>

        <section className="admin-panel imm-section" aria-labelledby="imm-h-bottle"><h2 id="imm-h-bottle">Bottles and allergens</h2>
          <p className="imm-hint">Mix allergens may share a bottle. No Mix allergens need a bottle of their own.</p>
          <Err id="imm-groups-err" text={errors.groups} />
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {v.groups.map((g, gi) => {
              const err = groupMsg[g.id] || errors[`group-${g.id}`];
              const solo = g.items.length === 1 && !ALLERGENS.find((a) => a.id === g.items[0].allergenId)?.mix;
              return <div className={`imm-bottle${err ? ' imm-bottle--error' : ''}`} key={g.id} data-testid={`imm-bottle-${gi}`}>
                <div className="imm-bottle__head"><strong>Bottle {gi + 1}{g.items.length > 0 && <span className={`imm-tag${solo ? ' imm-tag--solo' : ''}`}>{solo ? 'Single (No Mix)' : g.items.length > 1 ? 'Mixed' : 'Single'}</span>}</strong>
                  <span className="imm-cell-sub" data-testid={`text-imm-group-id-${gi}`}>Bottle ID {g.id}</span>
                  {!dis && v.groups.length > 1 && <button type="button" className="admin-button admin-button--secondary" onClick={() => set({ groups: v.groups.filter((x) => x.id !== g.id) })} aria-label={`Remove bottle ${gi + 1}`}><Trash2 size={14} aria-hidden="true" />Remove bottle</button>}</div>
                {g.items.map((it, ii) => { const a = ALLERGENS.find((x) => x.id === it.allergenId); const ek = `result-${g.id}-${it.allergenId}`;
                  return <div className="imm-item" key={it.allergenId}>
                    <div className="imm-item__name">{a?.name}<span className={`imm-tag${a?.mix ? '' : ' imm-tag--solo'}`}>{a?.mix ? 'Mix' : 'No Mix'}</span></div>
                    <div className="imm-field"><label htmlFor={`imm-r-${gi}-${ii}`}>Result (mm)</label><input id={`imm-r-${gi}-${ii}`} inputMode="decimal" value={it.result} disabled={dis} aria-invalid={Boolean(errors[ek])} aria-describedby={errors[ek] ? `${ek}-err` : undefined} onChange={(e) => updGroup(g.id, (x) => ({ ...x, items: x.items.map((y) => y.allergenId === it.allergenId ? { ...y, result: e.target.value } : y) }))} /><Err id={`${ek}-err`} text={errors[ek]} /></div>
                    {!dis && <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>{v.groups.length > 1 && <label className="imm-field">Move to<select value="" onChange={(e) => moveItem(g.id, it.allergenId, e.target.value)} aria-label={`Move ${a?.name} to another bottle`} data-testid={`select-imm-move-${gi}-${ii}`}><option value="">Choose</option>{v.groups.filter((x) => x.id !== g.id).map((x) => <option key={x.id} value={x.id}>Bottle {gIndex(x.id) + 1} ({x.id})</option>)}</select></label>}<button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Remove ${a?.name} from bottle ${gi + 1}`} onClick={() => updGroup(g.id, (x) => ({ ...x, items: x.items.filter((y) => y.allergenId !== it.allergenId) }))}><Trash2 size={16} aria-hidden="true" /></button></div>}
                  </div>; })}
                <div className="imm-bottle__foot">
                  {!dis ? <div className="imm-field"><label htmlFor={`imm-add-${gi}`}>Add allergen</label><SearchableSelect id={`imm-add-${gi}`} label="Allergen" value="" options={allergenOptions} onChange={(aid) => addAllergen(g.id, aid)} placeholder="Search allergens" /></div> : <span />}
                  <div className="imm-field"><label htmlFor={`imm-mrp-${gi}`}>MRP (INR)</label><input id={`imm-mrp-${gi}`} inputMode="decimal" value={g.mrp} disabled={dis} aria-invalid={Boolean(errors[`mrp-${g.id}`])} aria-describedby={errors[`mrp-${g.id}`] ? `mrp-${g.id}-err` : undefined} onChange={(e) => updGroup(g.id, (x) => ({ ...x, mrp: e.target.value }))} data-testid={`input-imm-mrp-${gi}`} /><Err id={`mrp-${g.id}-err`} text={errors[`mrp-${g.id}`]} /></div>
                </div>
                <Err id={`group-${g.id}-err`} text={err} />
              </div>; })}
          </div>
          {!dis && <div className="imm-btn-row" style={{ marginTop: 12 }}><button id="imm-add-bottle" type="button" className="admin-button admin-button--secondary" onClick={() => set({ groups: [...v.groups, newGroup()] })} data-testid="button-imm-add-bottle"><Plus size={15} aria-hidden="true" />Add bottle</button></div>}
        </section>

        <section className="admin-panel imm-section" aria-labelledby="imm-h-more"><h2 id="imm-h-more">Details and shipping</h2>
          <div className="imm-grid" style={{ marginTop: 12 }}>
            <div className="imm-field"><label htmlFor="imm-poNumber">PO number (optional)</label><input id="imm-poNumber" value={v.poNumber} disabled={dis} onChange={(e) => set({ poNumber: e.target.value })} data-testid="input-imm-po" /></div>
            {!isNew && <div className="imm-field"><label htmlFor="imm-status">Status (demo control)</label><select id="imm-status" value={v.status} disabled={dis} onChange={(e) => set({ status: e.target.value })} data-testid="select-imm-order-status">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select><p className="imm-hint">Demo only. Not an approval or fulfilment step.</p></div>}
          </div>
          <div className="imm-field" style={{ marginTop: 14 }}><label htmlFor="imm-remarks">Remarks</label><textarea id="imm-remarks" value={v.remarks} disabled={dis} onChange={(e) => set({ remarks: e.target.value })} data-testid="input-imm-remarks" /></div>
          <fieldset className="imm-chips" style={{ marginTop: 14, display: 'grid' }} id="imm-shipping" aria-describedby={errors.shipping ? 'imm-shipping-err' : undefined}><legend>Ship to</legend>
            {['patient', 'doctor'].map((s) => <label className="imm-radio" key={s}><input id={`imm-ship-${s}`} type="radio" name="shipping" checked={v.shipping === s} disabled={dis} onChange={() => set({ shipping: s })} data-testid={`radio-imm-ship-${s}`} /><span>{s === 'patient' ? 'Patient' : 'Doctor'}{(() => { const r = shippingRecipient({ ...v, shipping: s }, snap.patients); return r ? <span className="imm-cell-sub">{r.name}, {addr(r.address)}</span> : <span className="imm-cell-sub">Choose a {s} first</span>; })()}</span></label>)}</fieldset>
          <Err id="imm-shipping-err" text={errors.shipping} />
          <div className="imm-field" style={{ marginTop: 14 }}><label htmlFor="imm-files">Prescription files</label>
            {!dis && <input id="imm-files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" aria-describedby="imm-files-hint imm-files-err" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-testid="input-imm-files" />}
            <p className="imm-hint" id="imm-files-hint" tabIndex={-1}>Up to 10 PDF, JPEG, PNG or WebP files, 10 MB each. Names only are kept for this demo; nothing is uploaded.</p>
            <Err id="imm-files-err" text={fileMsg || errors.attachments} /></div>
          {v.attachments.length > 0 ? <ul className="imm-files" aria-label="Attached files">{v.attachments.map((f, i) => <li key={`${f.name}-${i}`}><span><Paperclip size={13} aria-hidden="true" /> {f.name} ({kb(f.size)})</span>{!dis && <button type="button" className="imm-link-btn" onClick={() => set({ attachments: v.attachments.filter((_, j) => j !== i) })} aria-label={`Remove ${f.name}`}>Remove</button>}</li>)}</ul> : <p className="imm-hint">No files attached.</p>}
        </section>

        {!readOnly && <div className="imm-actions"><button type="button" className="admin-button" onClick={save} data-testid="button-imm-save">{isNew ? 'Save order' : 'Update order'}</button>
          <button type="button" className="admin-button admin-button--secondary" onClick={() => guarded(BASE)} data-testid="button-imm-cancel">Cancel</button></div>}
      </div>
      <aside className="imm-aside" aria-label="Order summary">
        <div className="admin-panel imm-section"><h2>Summary</h2>
          <dl className="imm-facts" style={{ gridTemplateColumns: '1fr' }}>
            <div><dt>Patient</dt><dd>{patient?.name || 'Not chosen'}</dd></div>
            <div><dt>Doctor / MR</dt><dd>{nameOf(DOCTORS, v.doctorId) || '-'} / {nameOf(MRS, v.mrId) || '-'}</dd></div>
            <div><dt>Dosage</dt><dd>{v.dosage || 'Awaiting choice'}</dd></div>
            <div><dt>Ship to ({v.shipping})</dt><dd data-testid="text-imm-recipient">{recipient ? <>{recipient.name}<span className="imm-cell-sub">{recipient.phone}</span><span className="imm-cell-sub">{addr(recipient.address)}</span></> : '-'}</dd></div>
            {order && <div><dt>Status</dt><dd><StatusPill status={v.status} /></dd></div>}</dl></div>
        <div className="admin-panel imm-section"><h2>Billing</h2>
          <div className="imm-totals">{v.groups.map((g, i) => <div key={g.id}><span>Bottle {i + 1}</span><span className="imm-num">{money(parseAmount(g.mrp) ?? 0n)}</span></div>)}
            <div className="imm-total"><span>Total</span><span className="imm-num" data-testid="text-imm-total">{money(total)}</span></div></div>
          <dl className="imm-facts" style={{ gridTemplateColumns: '1fr' }}><div><dt>Billing doctor</dt><dd data-testid="text-imm-billing-doctor">{doctor ? <>{doctor.name}<span className="imm-cell-sub">{doctor.phone}</span><span className="imm-cell-sub">{addr(doctor.address)}</span></> : 'Not chosen'}</dd></div></dl>
          <p className="imm-hint">Sum of valid bottle MRPs. Blank or invalid prices are excluded and must be corrected before saving. No tax, payment or invoice.</p></div>
      </aside>
    </div>
    {leave && <ImmDialog title="Leave without saving?" eyebrow="Unsaved changes" className="imm-dialog--sm" description="Your edits to this demo order will be lost." onClose={() => setLeave(null)} testId="dialog-imm-leave">
      <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => setLeave(null)} data-testid="button-imm-stay">Keep editing</button>
        <button type="button" className="admin-button admin-button--danger" onClick={proceed} data-testid="button-imm-leave">Leave</button></div></ImmDialog>}
  </div></AdminLayout>;
}
