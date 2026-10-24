import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Pencil, Plus, Trash2, UserPlus, Paperclip } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderPortal, useOrderActions } from '../../components/orders/OrderPortalContext.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import PhoneInput from '../../components/admin/PhoneInput.jsx';
import ImmDialog from '../../components/immunotherapy/ImmDialog.jsx';
import { StatusPill } from './ImmunotherapyOrders.jsx';
import { continueNavigation, setNavigationGuard } from '../../auth/navigationGuard.js';
import { DOSES, GENDERS, PRELIMINARY_DOSES, STATUSES, request, saveOrder, uploadPrescription, downloadPrescription, prescriptionMetadata, groupingError, money, newGroup, bottleLabel, nextDose, orderErrors, saveErrors, parseAmount, shippingRecipient, totalMinor, validateAttachments } from '../../services/serverImmunotherapy.js';
import { createPatient, patientLanguageChoices } from '../../services/serverPatients.js';
import { getSession, reportingIdentityGuard, subscribeSession } from '../../auth/adminSession.js';
import useImmunotherapyReferences from '../../hooks/useImmunotherapyReferences.js';
import ReferenceState from '../../components/immunotherapy/ReferenceState.jsx';
import '../../excel-import.css';
import '../../immunotherapy.css';

const blankReg = () => ({ name: '', dateOfBirth: '', instructionsLanguage: '', gender: '', phone: '', dialCountry: 'IN', address: { line1: '', line2: '', landmark: '', pincode: '', city: '', state: '', country: 'India' }, doctorId: '' });
const blank = () => ({ patientId: '', doctorId: '', mrId: '', dosage: '', histamine: '', saline: '', groups: [newGroup()], remarks: '', attachments: [], shipping: 'patient', status: 'Confirmed' });
const fromOrder = (o) => structuredClone({ patientId: o.patientId, doctorId: o.doctorId, mrId: o.mrId, dosage: o.dosage, histamine: o.histamine, saline: o.saline, groups: o.groups, remarks: o.remarks || '', attachments: o.attachments || [], shipping: o.shipping, status: o.status });
const addr = (a) => a ? [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';
const nameOf = (list, id) => list.find((x) => x.id === id)?.name || '';
const ERROR_LABEL = { form: 'Order', patientId: 'Patient', doctorId: 'Doctor', mrId: 'MR', dosage: 'Dosage', histamine: 'Histamine (mm)', saline: 'Saline (mm)', shipping: 'Shipping', groups: 'Bottles', attachments: 'Prescription files', status: 'Status', remarks: 'Remarks', registration: 'Patient registration' };
const kb = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function Err({ id, text }) { return text ? <p className="imm-error" id={id} role="alert">{text}</p> : null; }

export default function ImmunotherapyOrderFormPage({ id, mode }) {
  const BASE = useOrderBase('immunotherapy');
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    setOrder(null); setError('');
    request(`/${id}`, { signal: controller.signal }).then(setOrder).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id, revision]);
  if (id && !order) return <AdminLayout title="IMMUNOTHERAPY"><div className="imm admin-panel imm-empty">
    <h1>{error ? 'Order unavailable' : 'Loading order…'}</h1>{error && <><p role="alert">{error}</p><button type="button" className="admin-button" onClick={() => setRevision((n) => n + 1)}>Retry</button></>}
    <Link href={BASE}>Back to orders</Link></div></AdminLayout>;
  return <Editor key={`${id || 'new'}-${mode}`} order={order} mode={mode} />;
}

function Editor({ order, mode }) {
  const can = useOrderActions('immunotherapy');
  const BASE = useOrderBase('immunotherapy');
  const { portal, mr: authenticatedMR } = useOrderPortal();
  const mrPortal = portal === 'mr';
  const languageChoices = mrPortal
    ? (params, signal) => request('/patient-languages', { params, signal })
    : patientLanguageChoices;
  const [, navigate] = useLocation();
  const readOnly = mode === 'view' || !(order ? can.edit : can.add);
  const isNew = !order;
  const initial = useRef(order ? fromOrder(order) : { ...blank(), mrId: authenticatedMR?.id || '' });
  const issuedBottleIds = useRef(new Set(initial.current.groups.map((g) => g.id)));
  // Only server-loaded saved associations or successful verified uploads count.
  // A filename, local metadata, pending upload or transfer claim is not evidence.
  const verifiedFiles = useRef(new Map((order?.attachments || []).map((f) => [f.id, order.patientId])));
  const [v, setV] = useState(initial.current);
  const [errors, setErrors] = useState({});
  const [groupMsg, setGroupMsg] = useState({});
  const [explain, setExplain] = useState('');
  const [reg, setReg] = useState(null);
  const [regErrors, setRegErrors] = useState({});
  const [leave, setLeave] = useState(null);
  const [fileMsg, setFileMsg] = useState('');
  const [pending, setPending] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [uploads, setUploads] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [policyError, setPolicyError] = useState('');
  const [policyRevision, setPolicyRevision] = useState(0);
  const [languages, setLanguages] = useState({ items: [], nextCursor: null });
  const [languageQuery, setLanguageQuery] = useState('');
  const [languageError, setLanguageError] = useState('');
  const [languageRevision, setLanguageRevision] = useState(0);
  const [languageBusy, setLanguageBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const saveBase = useRef(order);
  const mutation = useRef(null);
  const busy = useRef(false);
  const owner = useRef(getSession().user?.id);
  const alive = useRef(true);
  const patients = useImmunotherapyReferences('patients', order ? [order.patient] : [], v.patientId);
  const doctors = useImmunotherapyReferences('doctors', order ? [order.doctor] : [], v.doctorId);
  const mrs = useImmunotherapyReferences('mrs', order ? [order.mr] : [], v.mrId);
  const allergens = useImmunotherapyReferences('allergens', order?.groups.flatMap((g) => g.items.map((i) => i.allergen)) || []);
  const DOCTORS = doctors.items, MRS = mrs.items, ALLERGENS = allergens.items;
  const snap = { patients: patients.items };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id && getSession().user.id !== owner.current) {
        setV(blank()); initial.current = blank(); mutation.current = null; setUploads([]);
        verifiedFiles.current.clear();
        setErrors({ form: 'Session owner changed. Return to orders before continuing.' });
      }
    });
    return () => { alive.current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!can.upload_attachment) return undefined;
    const controller = new AbortController();
    request('/policy', { signal: controller.signal }).then((data) => { setPolicy(data); setPolicyError(''); })
      .catch((e) => { if (!controller.signal.aborted) setPolicyError(e.message); });
    return () => controller.abort();
  }, [policyRevision, can.upload_attachment]);
  useEffect(() => {
    if (!reg) return undefined;
    const controller = new AbortController();
    setLanguageBusy(true); setLanguageError('');
    const timer = setTimeout(() => languageChoices({ query: languageQuery, limit: 25 }, controller.signal)
      .then(setLanguages).catch((e) => { if (!controller.signal.aborted) setLanguageError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLanguageBusy(false); }), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [Boolean(reg), languageQuery, languageRevision]);
  async function moreLanguages() {
    if (!languages.nextCursor || languageBusy) return;
    setLanguageBusy(true);
    try { const page = await languageChoices({ query: languageQuery, cursor: languages.nextCursor, limit: 25 }); setLanguages((p) => ({ ...page, items: [...p.items, ...page.items] })); }
    catch (e) { setLanguageError(e.message); }
    finally { setLanguageBusy(false); }
  }
  const openerRef = useRef(null);
  const regNameRef = useRef(null);
  const focusId = (target) => requestAnimationFrame(() => { const el = document.getElementById(target); if (el) { el.scrollIntoView?.({ block: 'center' }); el.focus(); } });
  const summaryRef = useRef(null);
  const dirtyRef = useRef(false);
  const dirty = !readOnly && JSON.stringify(v) !== JSON.stringify(initial.current);
  const regOpen = Boolean(reg);
  dirtyRef.current = dirty || regOpen || Boolean(pending) || uncertain || uploads.length > 0;
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    if (readOnly) return undefined;
    return setNavigationGuard((request) => { if (!dirtyRef.current) return false; setLeave((current) => current || request); return true; });
  }, [readOnly]);

  useEffect(() => { if (regOpen) regNameRef.current?.focus(); }, [regOpen]);
  const closeReg = () => { setReg(null); setRegErrors({}); requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus()); };

  const patient = snap.patients.find((p) => p.id === v.patientId);
  const patientOptions = useMemo(() => snap.patients.map((p) => ({ value: p.id, label: `${p.name} - ${p.id} - ${p.phone}` })), [snap.patients]);
  const doctorOptions = DOCTORS.map((d) => ({ value: d.id, label: d.name }));
  const mrOptions = MRS.map((m) => ({ value: m.id, label: m.name }));
  const allergenOptions = ALLERGENS.map((a) => ({ value: a.id, label: a.name }));
  const total = totalMinor(v.groups);
  const doctor = DOCTORS.find((d) => d.id === v.doctorId);
  const recipientFor = (shipping) => {
    if (order && shipping === order.shipping && v[`${shipping}Id`] === order[`${shipping}Id`]) return order.recipient;
    if (order && shipping !== order.shipping) {
      return (shipping === 'patient' ? patients.liveItems : doctors.liveItems).find((p) => p.id === v[`${shipping}Id`]);
    }
    return shipping === 'patient' ? patient : doctor;
  };
  const recipient = recipientFor(v.shipping);

  function choosePatient(pid) {
    if (mrPortal && order?.attachments?.length && pid !== order.patientId) {
      setErrors({ patientId: 'This saved order has patient-bound prescriptions. Its patient cannot be changed in the MR portal.' });
      return;
    }
    setUploads([]);
    const p = (mrPortal && patients.liveItems.find((x) => x.id === pid)) || snap.patients.find((x) => x.id === pid);
    const patch = { patientId: pid, shipping: 'patient', doctorId: p?.doctorId || '', mrId: authenticatedMR?.id || p?.mrId || '', attachments: pid === v.patientId ? v.attachments : [] };
    if (p && order && pid === order.patientId) { patch.dosage = initial.current.dosage; setExplain('Saved dosage for this order restored. You may change it.'); }
    else if (p) { const n = nextDose(p); patch.dosage = n.dosage; setExplain(n.explanation); }
    else { patch.dosage = ''; setExplain(''); }
    set(patch);
  }
  const updGroup = (gid, fn) => set({ groups: v.groups.map((g) => g.id === gid ? fn(g) : g) });
  function addBottle() {
    const group = newGroup(issuedBottleIds.current);
    issuedBottleIds.current.add(group.id);
    set({ groups: [...v.groups, group] });
  }
  function attachVerified(file, patientId) {
    if (file.state !== 'verified' || file.scanner_status !== 'clean'
        || file.patient_id !== patientId || file.category !== 'documents' || !file.size) {
      throw new Error('Only a verified, clean-scanned prescription for the selected patient can be attached.');
    }
    verifiedFiles.current.set(file.id, patientId);
    setErrors((current) => { const { attachments, ...remaining } = current; return remaining; });
    setV((current) => current.patientId !== patientId || current.attachments.some((f) => f.id === file.id) ? current
      : { ...current, attachments: [...current.attachments, { id: file.id, name: file.display_name, size: file.size, type: file.content_type, state: file.state }] });
  }
  function addAllergen(gid, aid) {
    if (!aid) return;
    const g = v.groups.find((x) => x.id === gid);
    const items = [...g.items, { allergenId: aid, result: '', allergen: ALLERGENS.find((a) => a.id === aid) }];
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
  async function addFiles(list) {
    if (!can.upload_attachment || busy.current || !policy || !v.patientId) { setFileMsg('Upload Prescription permission, a patient and the current upload policy are required.'); return; }
    const files = [...list];
    const msg = validateAttachments(files, [...v.attachments, ...uploads.filter((u) => u.state !== 'error')], policy.maxBytes);
    setFileMsg(msg);
    if (msg) return;
    const guard = reportingIdentityGuard();
    busy.current = true; setPending('upload');
    for (const file of files) {
      const key = crypto.randomUUID();
      setUploads((rows) => [...rows, { key, name: file.name, state: 'pending', file }]);
      try {
        const result = await uploadPrescription(file, v.patientId);
        guard();
        if (!alive.current) return;
        if (result.state === 'verified' && result.scanner_status === 'clean') {
          attachVerified(result, v.patientId);
          setUploads((rows) => rows.filter((u) => u.key !== key));
          setFileMsg('Prescription uploaded privately and verified. Save the order to attach it.');
        } else setUploads((rows) => rows.map((u) => u.key === key ? { ...u, id: result.id, state: result.state, message: `Not attached: ${result.state}; scanner ${result.scanner_status}.` } : u));
      } catch (e) {
        try { guard(); } catch { break; }
        if (alive.current) setUploads((rows) => rows.map((u) => u.key === key ? { ...u, id: e.fileId || undefined, state: 'error', message: `Not attached. ${e.message}` } : u));
      }
    }
    busy.current = false; if (alive.current) setPending('');
  }
  async function register(e) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true; setPending('registration'); setRegErrors({});
    try {
      const registerPatient = mrPortal ? (body) => request('/patient-registration', { body }) : createPatient;
      const created = await registerPatient({
        name: reg.name, dateOfBirth: reg.dateOfBirth, gender: reg.gender, phone: reg.phone, dialCountry: reg.dialCountry,
        email: '', doctorId: reg.doctorId, instructionsLanguage: reg.instructionsLanguage, status: 'active',
        addressLine1: reg.address.line1, addressLine2: reg.address.line2, landmark: reg.address.landmark,
        pincode: reg.address.pincode, city: reg.address.city, state: reg.address.state, country: reg.address.country,
      });
      if (!alive.current) return;
      patients.remember({ ...created, address: { ...reg.address } });
      setReg(null); setRegErrors({});
      set({ patientId: created.id, doctorId: created.doctorId, mrId: created.mrId || '', dosage: '', shipping: 'patient', attachments: [] });
      setExplain('Patient Master record created. No administration history inferred; choose a dosage explicitly.');
      requestAnimationFrame(() => document.getElementById('imm-patientId')?.focus());
    } catch (cause) {
      if (alive.current) setRegErrors({ form: `${cause.message} Registration was not confirmed; search ${mrPortal ? 'the patient choices in this order' : 'Patient Master'} before retrying an uncertain registration.` });
    } finally {
      busy.current = false; if (alive.current) setPending('');
    }
  }
  function guarded(href) { if (dirtyRef.current) setLeave({ kind: 'href', href }); else navigate(href); }
  async function save() {
    if (busy.current || getSession().user?.id !== owner.current) return;
    if (reg) { setErrors({ registration: 'Finish or cancel the patient registration before saving the order.' }); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    if (uploads.some((u) => u.state === 'pending')) { setErrors({ attachments: 'Wait for uploads to finish. Only verified prescriptions count.' }); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    // An unconfirmed submission must retain its exact payload/key, not be
    // revalidated or changed into a different mutation during a safe retry.
    if (!mutation.current) {
      const problems = orderErrors(v, v.attachments.some((f) => verifiedFiles.current.get(f.id) === v.patientId));
      if (Object.keys(problems).length) { setErrors(problems); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    }
    busy.current = true; setPending('save'); setErrors({});
    if (!mutation.current) mutation.current = { values: structuredClone(v), key: crypto.randomUUID() };
    try {
      await saveOrder(mutation.current.values, saveBase.current, mutation.current.key);
      if (!alive.current) return;
      initial.current = v; dirtyRef.current = false; setErrors({}); setUncertain(false);
      navigate(BASE);
    } catch (cause) {
      if (alive.current) {
        setUncertain(Boolean(cause.ambiguous));
        if (!cause.ambiguous) mutation.current = null;
        setErrors(cause.ambiguous ? { form: cause.message } : saveErrors(cause, v));
        if (cause.code === 'imm_stale' && order) {
          try { const latest = await request(`/${order.id}`); if (alive.current) setConflict(latest); }
          catch { /* The stale draft remains mounted; explicit retry can fetch again. */ }
        }
        requestAnimationFrame(() => summaryRef.current?.focus());
      }
    } finally { busy.current = false; if (alive.current) setPending(''); }
  }
  const proceed = () => {
    if (!leave) return;
    const r = leave; setLeave(null); dirtyRef.current = false; initial.current = v;
    continueNavigation(r, navigate);
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
    if (k === 'attachments') return readOnly || !can.upload_attachment || !policy || !v.patientId ? 'imm-files-hint' : 'imm-files';
    if (k === 'registration') return 'imm-reg-name';
    if (k.startsWith('group-')) return `imm-add-${gIndex(k.slice(6))}`;
    if (k.startsWith('mrp-')) return `imm-mrp-${gIndex(k.slice(4))}`;
    if (k.startsWith('result-')) { const gi = v.groups.findIndex((g) => k.startsWith(`result-${g.id}-`)); const aid = k.slice(`result-${v.groups[gi]?.id}-`.length); return `imm-r-${gi}-${v.groups[gi]?.items.findIndex((i) => i.allergenId === aid)}`; }
    return `imm-${k}`;
  };
  const dis = readOnly || Boolean(pending) || uncertain;
  const rf = (k, label, props = {}) => <label className="imm-field">{label}
    <input id={`imm-reg-${k}`} disabled={Boolean(pending)} ref={k === 'name' ? regNameRef : undefined} value={reg[k]} onChange={(e) => setReg({ ...reg, [k]: e.target.value })} aria-invalid={Boolean(regErrors[k])} aria-describedby={regErrors[k] ? `imm-reg-${k}-err` : undefined} data-testid={`input-imm-reg-${k}`} {...props} />
    <Err id={`imm-reg-${k}-err`} text={regErrors[k]} /></label>;
  const af = (k, label) => <label className="imm-field">{label}
    <input id={`imm-reg-${k}`} disabled={Boolean(pending)} value={reg.address[k]} onChange={(e) => setReg({ ...reg, address: { ...reg.address, [k]: e.target.value } })} aria-invalid={Boolean(regErrors[`address-${k}`])} aria-describedby={regErrors[`address-${k}`] ? `imm-reg-a-${k}-err` : undefined} data-testid={`input-imm-reg-${k}`} />
    <Err id={`imm-reg-a-${k}-err`} text={regErrors[`address-${k}`]} /></label>;

  return <AdminLayout title="IMMUNOTHERAPY"><div className="imm">
    <div className="admin-page-head">
      <div><p className="admin-page-head__eyebrow">Orders / Immunotherapy</p>
        <h1>{isNew ? 'Add order' : `${readOnly ? 'Order' : 'Edit'} ${order.number}`}</h1>
        <p className="admin-page-head__description">{readOnly ? 'Saved historical order details.' : 'Patient first, then dosage, bottles and shipping.'}</p></div>
      <div className="imm-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => guarded(BASE)} data-testid="button-imm-back"><ArrowLeft size={15} aria-hidden="true" />{readOnly ? 'Back' : 'Cancel'}</button>
        {readOnly && <Link href={`${BASE}/${order.id}/edit`} className="admin-button" data-testid="link-imm-to-edit"><Pencil size={15} aria-hidden="true" />Edit</Link>}
      </div>
    </div>
    {uncertain && <p role="alert" className="imm-boundary">Save outcome is unconfirmed. Editing is locked; retry the same submission below to recover it without creating a duplicate. Your draft remains mounted.</p>}
    {errList.length > 0 && <div className="imm-errors" role="alert" tabIndex={-1} ref={summaryRef} data-testid="error-imm-summary"><strong>Fix {errList.length} problem{errList.length > 1 ? 's' : ''} before saving</strong>
      <ul>{errList.map(([k, m]) => <li key={k}><button type="button" className="imm-link-btn" onClick={() => focusId(targetFor(k))} data-testid={`link-imm-error-${k}`}>{labelFor(k)}: {m}</button></li>)}</ul></div>}
    <div className="imm-layout">
      <div className="imm-main">
        <section className="admin-panel imm-section" aria-labelledby="imm-h-patient"><h2 id="imm-h-patient">Patient</h2>
          <p className="imm-hint">Search by name, ID or phone.</p>
          <div className="imm-grid" style={{ marginTop: 12 }}>
            <div className="imm-field"><label htmlFor="imm-patientId">Patient</label>
              <SearchableSelect viewportMenu id="imm-patientId" label="Patient" value={v.patientId} options={patientOptions} onSearch={patients.onSearch} searchOptions={() => mrPortal ? patients.liveItems.map((p) => ({ value: p.id, label: `${p.name} - ${p.id} - ${p.phone}` })) : patientOptions} onChange={choosePatient} placeholder="Find a patient" invalid={errors.patientId} describedBy={errors.patientId ? 'imm-patientId-err' : undefined} disabled={dis} />
              {!readOnly && <ReferenceState source={patients} label="patients" />}
              <Err id="imm-patientId-err" text={errors.patientId} /></div>
            <div className="imm-field"><label htmlFor="imm-doctorId">Doctor</label>
               <SearchableSelect viewportMenu id="imm-doctorId" label="Doctor" value={v.doctorId} options={doctorOptions} onSearch={doctors.onSearch} searchOptions={() => mrPortal ? doctors.liveItems.map((d) => ({ value: d.id, label: d.name })) : doctorOptions} onChange={(x) => set({ doctorId: x, mrId: authenticatedMR?.id || DOCTORS.find((d) => d.id === x)?.mrId || '' })} placeholder="Select doctor" invalid={errors.doctorId} describedBy={errors.doctorId ? 'imm-doctorId-err' : undefined} disabled={dis} />
              {!readOnly && <ReferenceState source={doctors} label="doctors" />}
              <Err id="imm-doctorId-err" text={errors.doctorId} /></div>
            <div className="imm-field"><label htmlFor="imm-mrId">MR</label>
              {mrPortal ? <input id="imm-mrId" readOnly value={order?.mr?.name || authenticatedMR.name} aria-label="MR (signed-in account)" aria-invalid={Boolean(errors.mrId)} aria-describedby={errors.mrId ? 'imm-mrId-err' : undefined} /> : <SearchableSelect viewportMenu id="imm-mrId" label="MR" value={v.mrId} options={mrOptions} onSearch={mrs.onSearch} searchOptions={() => mrOptions} onChange={(x) => set({ mrId: x })} placeholder="Select MR" invalid={errors.mrId} describedBy={errors.mrId ? 'imm-mrId-err' : undefined} disabled={dis} />}
              {!readOnly && !mrPortal && <ReferenceState source={mrs} label="MRs" />}
              <Err id="imm-mrId-err" text={errors.mrId} /></div>
          </div>
          {patient && <dl className="imm-facts" data-testid="imm-patient-facts"><div><dt>Name</dt><dd>{patient.name}</dd></div><div><dt>Age / gender</dt><dd>{patient.age} / {patient.gender}</dd></div><div><dt>Phone</dt><dd>{patient.phone}</dd></div><div><dt>Address</dt><dd>{addr(patient.address)}</dd></div></dl>}
          {!dis && !reg && (mrPortal || can.protected) && <div className="imm-btn-row" style={{ marginTop: 14 }}><button type="button" className="admin-button admin-button--secondary" onClick={(e) => { openerRef.current = e.currentTarget; setReg({ ...blankReg(), doctorId: v.doctorId }); setRegErrors({}); }} data-testid="button-imm-register"><UserPlus size={15} aria-hidden="true" />Register patient</button></div>}
          {reg && <form className="imm-reg" onSubmit={register} noValidate aria-label="Register patient" data-testid="form-imm-register"><fieldset disabled={Boolean(pending)} style={{ display: 'contents', border: 0, padding: 0, margin: 0 }}>
            <h3>Register patient</h3>
            <p className="imm-hint">Creates a real Patient Master record using its existing validation and Doctor/MR assignments. Patient Master creation is separate from saving this order. Enter the postal address manually.</p>
            {regErrors.form && <p role="alert" className="imm-error">{regErrors.form}</p>}
            <div className="imm-grid">{rf('name', 'Name')}{rf('dateOfBirth', 'Date of birth', { type: 'date' })}
              <label className="imm-field">Gender<select id="imm-reg-gender" value={reg.gender} onChange={(e) => setReg({ ...reg, gender: e.target.value })} aria-invalid={Boolean(regErrors.gender)} aria-describedby={regErrors.gender ? 'imm-reg-gender-err' : undefined} data-testid="select-imm-reg-gender"><option value="">Select</option>{GENDERS.map((g) => <option key={g}>{g}</option>)}</select><Err id="imm-reg-gender-err" text={regErrors.gender} /></label></div>
            <div className="imm-field"><span>Phone</span>
              <PhoneInput prefix="imm-reg" country={reg.dialCountry} onCountryChange={(c) => setReg({ ...reg, dialCountry: c })} countryError={regErrors.phone && !reg.dialCountry ? regErrors.phone : ''}
                inputProps={{ id: 'imm-reg-phone', name: 'phone', value: reg.phone, onChange: (e) => setReg({ ...reg, phone: e.target.value }), 'aria-label': 'Phone number', 'aria-invalid': Boolean(regErrors.phone), 'aria-describedby': regErrors.phone ? 'imm-reg-phone-err' : undefined, 'data-testid': 'input-imm-reg-phone' }} />
              <Err id="imm-reg-phone-err" text={regErrors.phone} /></div>
            <div className="imm-grid">{af('line1', 'Address line 1')}{af('line2', 'Address line 2 (optional)')}{af('landmark', 'Landmark (optional)')}{af('pincode', 'PIN code')}{af('city', 'City')}{af('state', 'State')}{af('country', 'Country')}</div>
            <div className="imm-grid">
              <label className="imm-field">Doctor<select id="imm-reg-doctor" value={reg.doctorId} onChange={(e) => setReg({ ...reg, doctorId: e.target.value })} aria-invalid={Boolean(regErrors.doctorId)} aria-describedby={regErrors.doctorId ? 'imm-reg-doctor-err' : undefined} data-testid="select-imm-reg-doctor"><option value="">Select</option>{(mrPortal ? doctors.liveItems : DOCTORS).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select><Err id="imm-reg-doctor-err" text={regErrors.doctorId} /></label>
              <div className="imm-field"><label htmlFor="imm-reg-language">Instructions language</label><SearchableSelect viewportMenu id="imm-reg-language" label="Instructions language" value={reg.instructionsLanguage} options={languages.items.map((l) => ({ value: l.name, label: l.name }))} onSearch={setLanguageQuery} searchOptions={() => languages.items.map((l) => ({ value: l.name, label: l.name }))} onChange={(x) => setReg({ ...reg, instructionsLanguage: x })} disabled={Boolean(pending)} />
                {languageBusy && <span role="status">Loading languages…</span>}{languageError && <span role="alert">{languageError}</span>}
                {!languageBusy && !languageError && !languages.items.length && <span>No saved languages found. Add a language in Language Master first.</span>}
                {languageError && <button type="button" className="imm-link-btn" onClick={() => setLanguageRevision((n) => n + 1)}>Retry languages</button>}
                {languages.nextCursor && <button type="button" className="imm-link-btn" disabled={languageBusy} onClick={moreLanguages}>Load next language section</button>}</div></div>
            <p className="imm-hint">The MR is assigned through the selected Doctor. Search the Doctor selector above to load additional real Doctor choices.</p>
            <div className="imm-reg__actions"><button type="submit" className="admin-button" disabled={Boolean(pending)} data-testid="button-imm-reg-save">{pending === 'registration' ? 'Registering…' : 'Register and select'}</button><button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending)} onClick={closeReg} data-testid="button-imm-reg-cancel">Cancel registration</button></div>
          </fieldset></form>}
        </section>

        <section className="admin-panel imm-section" aria-labelledby="imm-h-dose"><h2 id="imm-h-dose">Dosage and reactions</h2>
          <p className="imm-hint" id="imm-dosage-hint">Choose one dosage. PD and DD are optional preliminary choices; you can start at B1 without either. The ordered series is B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8. Manually editable; not a clinical recommendation.</p>
          <fieldset className="imm-chips" id="imm-dosage" style={{ marginTop: 12 }} aria-describedby={`imm-dosage-hint${errors.dosage ? ' imm-dosage-err' : ''}`}><legend>Dosage (required)</legend>
            {DOSES.map((d) => <label className="imm-chip" key={d}><input id={`imm-dose-${d}`} type="radio" name="dosage" value={d} checked={v.dosage === d} disabled={dis} onChange={() => set({ dosage: d })} data-testid={`radio-imm-dose-${d}`} /><span>{d}{PRELIMINARY_DOSES.includes(d) ? ' (optional preliminary)' : ''}</span></label>)}</fieldset>
          <Err id="imm-dosage-err" text={errors.dosage} />
          {explain && <p className="imm-explain" role="status" data-testid="text-imm-dose-explain">{explain}</p>}
          <div className="imm-grid" style={{ marginTop: 14 }}>
            {['histamine', 'saline'].map((k) => <div className="imm-field" key={k}><label htmlFor={`imm-${k}`}>{k === 'histamine' ? 'Histamine (mm)' : 'Saline (mm)'}</label>
              <input id={`imm-${k}`} inputMode="decimal" required value={v[k]} disabled={dis} onChange={(e) => set({ [k]: e.target.value })} aria-invalid={Boolean(errors[k])} aria-describedby={errors[k] ? `imm-${k}-err` : undefined} data-testid={`input-imm-${k}`} />
              <Err id={`imm-${k}-err`} text={errors[k]} /></div>)}
          </div>
        </section>

        <section className="admin-panel imm-section" aria-labelledby="imm-h-bottle"><h2 id="imm-h-bottle">Bottles and allergens</h2>
          <p className="imm-hint">Combine any eligible allergens in a bottle, irrespective of Mix/No Mix. Each allergen can appear only once per bottle.</p>
          {!readOnly && <ReferenceState source={allergens} label="allergens" />}
          <Err id="imm-groups-err" text={errors.groups} />
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {v.groups.map((g, gi) => {
              const err = groupMsg[g.id] || errors[`group-${g.id}`];
              return <div className={`imm-bottle${err ? ' imm-bottle--error' : ''}`} key={g.id} data-testid={`imm-bottle-${gi}`}>
                <div className="imm-bottle__head"><strong>Bottle {gi + 1}{g.items.length > 0 && <span className="imm-tag">{g.items.length === 1 ? 'Single allergen' : `${g.items.length} allergens`}</span>}</strong>
                  <span className="imm-cell-sub" data-testid={`text-imm-group-id-${gi}`}>{bottleLabel(g, gi)}</span>
                  {!dis && v.groups.length > 1 && <button type="button" className="admin-button admin-button--secondary" onClick={() => set({ groups: v.groups.filter((x) => x.id !== g.id) })} aria-label={`Remove bottle ${gi + 1}`}><Trash2 size={14} aria-hidden="true" />Remove bottle</button>}</div>
                {g.items.map((it, ii) => { const a = ALLERGENS.find((x) => x.id === it.allergenId); const ek = `result-${g.id}-${it.allergenId}`;
                  return <div className="imm-item" key={it.allergenId}>
                    <div className="imm-item__name">{it.allergen?.name || a?.name || 'Saved allergen'}<span className="imm-cell-sub">{it.allergen?.concentration || a?.concentration}</span></div>
                    <div className="imm-field"><label htmlFor={`imm-r-${gi}-${ii}`}>Result (mm)</label><input id={`imm-r-${gi}-${ii}`} inputMode="decimal" value={it.result} disabled={dis} aria-invalid={Boolean(errors[ek])} aria-describedby={errors[ek] ? `${ek}-err` : undefined} onChange={(e) => updGroup(g.id, (x) => ({ ...x, items: x.items.map((y) => y.allergenId === it.allergenId ? { ...y, result: e.target.value } : y) }))} /><Err id={`${ek}-err`} text={errors[ek]} /></div>
                    {!dis && <div style={{ display: 'flex', gap: 6, alignItems: 'end' }}>{v.groups.length > 1 && <label className="imm-field">Move to<select value="" onChange={(e) => moveItem(g.id, it.allergenId, e.target.value)} aria-label={`Move ${a?.name} to another bottle`} data-testid={`select-imm-move-${gi}-${ii}`}><option value="">Choose</option>{v.groups.filter((x) => x.id !== g.id).map((x) => <option key={x.id} value={x.id}>Bottle {gIndex(x.id) + 1} ({bottleLabel(x, gIndex(x.id))})</option>)}</select></label>}<button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Remove ${a?.name} from bottle ${gi + 1}`} onClick={() => updGroup(g.id, (x) => ({ ...x, items: x.items.filter((y) => y.allergenId !== it.allergenId) }))}><Trash2 size={16} aria-hidden="true" /></button></div>}
                  </div>; })}
                <div className="imm-bottle__foot">
                  {!dis ? <div className="imm-field"><label htmlFor={`imm-add-${gi}`}>Add allergen</label><SearchableSelect viewportMenu id={`imm-add-${gi}`} label="Allergen" value="" options={allergenOptions} onSearch={allergens.onSearch} searchOptions={() => allergenOptions} onChange={(aid) => addAllergen(g.id, aid)} placeholder="Search allergens" invalid={Boolean(err)} describedBy={err ? `group-${g.id}-err` : undefined} /></div> : <span />}
                  <div className="imm-field"><label htmlFor={`imm-mrp-${gi}`}>MRP (INR)</label><input id={`imm-mrp-${gi}`} inputMode="decimal" value={g.mrp} disabled={dis} aria-invalid={Boolean(errors[`mrp-${g.id}`])} aria-describedby={errors[`mrp-${g.id}`] ? `mrp-${g.id}-err` : undefined} onChange={(e) => updGroup(g.id, (x) => ({ ...x, mrp: e.target.value }))} data-testid={`input-imm-mrp-${gi}`} /><Err id={`mrp-${g.id}-err`} text={errors[`mrp-${g.id}`]} /></div>
                </div>
                <Err id={`group-${g.id}-err`} text={err} />
              </div>; })}
          </div>
          {!dis && <div className="imm-btn-row" style={{ marginTop: 12 }}><button id="imm-add-bottle" type="button" className="admin-button admin-button--secondary" onClick={addBottle} data-testid="button-imm-add-bottle"><Plus size={15} aria-hidden="true" />Add bottle</button></div>}
        </section>

        <section className="admin-panel imm-section" aria-labelledby="imm-h-more"><h2 id="imm-h-more">Details and shipping</h2>
          <div className="imm-grid" style={{ marginTop: 12 }}>
            {!isNew && <div className="imm-field"><label htmlFor="imm-status">Status</label><select id="imm-status" value={v.status} disabled={dis} onChange={(e) => set({ status: e.target.value })} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'imm-status-err' : undefined} data-testid="select-imm-order-status">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select><Err id="imm-status-err" text={errors.status} /><p className="imm-hint">Order tracking only; does not record treatment administration, stock or payments.</p></div>}
          </div>
          <div className="imm-field" style={{ marginTop: 14 }}><label htmlFor="imm-remarks">Remarks</label><textarea id="imm-remarks" value={v.remarks} disabled={dis} onChange={(e) => set({ remarks: e.target.value })} aria-invalid={Boolean(errors.remarks)} aria-describedby={errors.remarks ? 'imm-remarks-err' : undefined} data-testid="input-imm-remarks" /><Err id="imm-remarks-err" text={errors.remarks} /></div>
          <fieldset className={`imm-chips${isNew ? ' imm-shipping-choices' : ''}`} style={{ marginTop: 14, display: 'grid' }} id="imm-shipping" aria-describedby={errors.shipping ? 'imm-shipping-err' : undefined}><legend>Ship to</legend>
            {['patient', 'doctor'].map((s) => <label className="imm-radio" key={s}><input id={`imm-ship-${s}`} type="radio" name="shipping" checked={v.shipping === s} disabled={dis} onChange={() => set({ shipping: s })} data-testid={`radio-imm-ship-${s}`} /><span>{s === 'patient' ? 'Patient' : 'Doctor'}{(() => { const r = recipientFor(s); return r ? <span className="imm-cell-sub">{r.name}, {addr(r.address)}</span> : <span className="imm-cell-sub">Choose a {s} first</span>; })()}</span></label>)}</fieldset>
          <Err id="imm-shipping-err" text={errors.shipping} />
          <div className="imm-field" style={{ marginTop: 14 }}><label htmlFor="imm-files">Prescription files{!readOnly && ' (required)'}</label>
            {!readOnly && <label className="excel-import__picker"><Paperclip size={19} /><span>{pending === 'upload' ? 'Uploading privately…' : 'Choose prescription files'}</span><input id="imm-files" type="file" multiple disabled={!can.upload_attachment || dis || !policy || !v.patientId} accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp" aria-required="true" aria-invalid={Boolean(errors.attachments)} aria-describedby="imm-files-hint imm-files-err" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} data-testid="input-imm-files" /></label>}
            <p className="imm-hint" id="imm-files-hint" tabIndex={-1}>{!readOnly && 'At least one verified prescription for the selected patient is required to save. '}{policy ? `Up to ${policy.maxFiles} PDF, JPEG, PNG or WebP files, ${(policy.maxBytes / 1048576).toFixed(1)} MiB each.` : 'Upload limits unavailable.'} Files remain private. Only successfully uploaded, clean-scanned files can be attached. {mrPortal ? 'Saved attachments must be retained. You can remove unsaved selections without deleting shared files.' : 'Removing a selection detaches it when you save; it does not delete shared files.'}</p>
            {policyError && <p role="alert">{policyError} <button type="button" className="imm-link-btn" onClick={() => setPolicyRevision((n) => n + 1)}>Retry upload policy</button></p>}
            <Err id="imm-files-err" text={errors.attachments || fileMsg} /></div>
          {v.attachments.length > 0 ? <ul className="imm-files" aria-label="Attached files">{v.attachments.map((f, i) => <li key={f.id}><span><Paperclip size={13} aria-hidden="true" /> {f.name}{!f.restricted && ` (${kb(f.size)}) — Uploaded / verified`}</span><button type="button" className="imm-link-btn" disabled={!can.read_attachment || f.restricted} onClick={() => downloadPrescription(f).catch((e) => setFileMsg(`Download unavailable: ${e.message}`))}>Download</button>{!dis && !(mrPortal && order?.attachments?.some((saved) => saved.id === f.id)) && <button type="button" className="imm-link-btn" onClick={() => set({ attachments: v.attachments.filter((_, j) => j !== i) })} aria-label={`Remove ${f.name}`}>Remove</button>}</li>)}</ul> : <p className="imm-hint">No files attached.</p>}
          {uploads.length > 0 && <ul className="imm-files" aria-label="Pending or failed uploads">{uploads.map((u) => <li key={u.key}><span role={u.state === 'pending' ? 'status' : undefined}>{u.name}: {u.state === 'pending' ? 'Uploading — not attached yet' : u.message}</span>{!pending && !uncertain && <><button type="button" className="imm-link-btn" onClick={() => setUploads((rows) => rows.filter((r) => r.key !== u.key))}>Remove selection</button>{u.id ? <button type="button" className="imm-link-btn" onClick={async () => {
            if (busy.current || uncertain) return;
            busy.current = true; setPending('upload');
            const guard = reportingIdentityGuard(); const patientId = v.patientId;
            try { const f = await prescriptionMetadata(u.id); guard(); if (!alive.current) return; attachVerified(f, patientId); setUploads((rows) => rows.filter((r) => r.key !== u.key)); } catch (e) { if (alive.current) setFileMsg(e.message); }
            finally { busy.current = false; if (alive.current) setPending(''); }
          }}>Check availability</button> : <button type="button" className="imm-link-btn" onClick={() => { setUploads((rows) => rows.filter((r) => r.key !== u.key)); addFiles([u.file]); }}>Retry upload</button>}</>}</li>)}</ul>}
        </section>

        {!readOnly && <div className="imm-actions"><button type="button" className="admin-button" disabled={Boolean(pending)} onClick={save} data-testid="button-imm-save">{pending === 'save' ? 'Saving…' : uncertain ? 'Retry same save safely' : isNew ? 'Save order' : 'Update order'}</button>
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
    {leave && <ImmDialog title="Leave without saving?" eyebrow="Unsaved changes" className="imm-dialog--sm" description={pending || uncertain ? 'A save or upload may still be unresolved. Keep this draft open and retry the same operation before leaving.' : 'Your unsaved edits will be lost. Patient Master records already registered are not undone.'} onClose={() => setLeave(null)} testId="dialog-imm-leave">
      <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => setLeave(null)} data-testid="button-imm-stay">Keep editing</button>
        <button type="button" className="admin-button admin-button--danger" disabled={Boolean(pending) || uncertain} onClick={proceed} data-testid="button-imm-leave">Leave</button></div></ImmDialog>}
    {conflict && <ImmDialog title="Reconcile a newer saved version" eyebrow="Order changed" description="Your draft has not been discarded or saved. Compare the latest saved record with your draft. Confirming below keeps your values for another explicit Save; it does not save immediately." onClose={() => setConflict(null)}>
      <details><summary>Latest saved order — version {conflict.version}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(conflict, null, 2)}</pre></details>
      <details><summary>Your mounted draft</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(v, null, 2)}</pre></details>
      <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => setConflict(null)}>Keep draft without rebasing</button>
        <button type="button" className="admin-button" onClick={() => { saveBase.current = conflict; mutation.current = null; setConflict(null); setErrors({ form: 'Draft retained against the reviewed current version. Review your values, then save explicitly. Another concurrent change will be rejected again.' }); }}>Use reviewed version and keep my draft</button></div>
    </ImmDialog>}
  </div></AdminLayout>;
}
