import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Eye, Pencil, Plus, Trash2, UserPlus, Paperclip, X } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderPortal, useOrderActions } from '../../components/orders/OrderPortalContext.jsx';
import { useAdminDateFormatters } from '../../components/admin/adminPreferences.js';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import PhoneInput from '../../components/admin/PhoneInput.jsx';
import ImmDialog from '../../components/immunotherapy/ImmDialog.jsx';
import PrescriptionViewer from '../../components/immunotherapy/PrescriptionViewer.jsx';
import { StatusPill } from './ImmunotherapyOrders.jsx';
import { continueNavigation, setNavigationGuard } from '../../auth/navigationGuard.js';
import { DOSES, GENDERS, PRELIMINARY_DOSES, STATUSES, request, prepareOrderSave, submitOrderSave, downloadPrescription, groupingError, money, newGroup, nextDose, orderErrors, saveErrors, parseAmount, totalMinor, orderTotalMinor, prescriptionBlob, skinResultError, mrEditable } from '../../services/serverImmunotherapy.js';
import { createPatient, patientLanguageChoices } from '../../services/serverPatients.js';
import { getSession, subscribeSession } from '../../auth/adminSession.js';
import usePrescriptionSelections from '../../hooks/usePrescriptionSelections.js';
import useImmunotherapyReferences from '../../hooks/useImmunotherapyReferences.js';
import ReferenceState from '../../components/immunotherapy/ReferenceState.jsx';
import ImmunotherapyOrderSummary from '../../components/immunotherapy/ImmunotherapyOrderSummary.jsx';
import ImmunotherapyConflictDetails from '../../components/immunotherapy/ImmunotherapyConflictDetails.jsx';
import { DownloadOrderFile, OrderFileList, OrderFileRow } from '../../components/orders/OrderFiles.jsx';
import '../../excel-import.css';
import '../../immunotherapy.css';

const blankReg = () => ({ name: '', dateOfBirth: '', instructionsLanguage: '', gender: '', phone: '', dialCountry: 'IN', address: { line1: '', line2: '', landmark: '', pincode: '', city: '', state: '', country: 'India' }, doctorId: '' });
const blank = () => ({ patientId: '', doctorId: '', mrId: '', dosage: '', histamine: '', saline: '', groups: [newGroup()], remarks: '', attachments: [], shipping: 'patient', status: 'Confirmed', poNumber: '', pricingBasis: 'allergen_rates' });
const fromOrder = (o) => structuredClone({ patientId: o.patientId, doctorId: o.doctorId, mrId: o.mrId, dosage: o.dosage, histamine: o.histamine, saline: o.saline, groups: o.groups, remarks: o.remarks || '', attachments: o.attachments || [], shipping: o.shipping, status: o.status, poNumber: o.poNumber || '', pricingBasis: o.pricingBasis || 'legacy_bottle_mrp' });
const addr = (a) => a ? [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, a.country].filter(Boolean).join(', ') : '';
const nameOf = (list, id) => list.find((x) => x.id === id)?.name || '';
const patientLabel = (p, mrPortal) => mrPortal
  ? [p.name || 'Patient name unavailable', p.phone].filter(Boolean).join(' - ')
  : `${p.name} - ${p.id} - ${p.phone}`;
const ERROR_LABEL = { form: 'Order', patientId: 'Patient', doctorId: 'Doctor', mrId: 'MR', dosage: 'Dosage', histamine: 'Histamine (mm)', saline: 'Saline (mm)', shipping: 'Shipping', groups: 'Allergen Details', attachments: 'Prescription files', status: 'Status', remarks: 'Remarks', registration: 'Patient registration', poNumber: 'PO number' };

function Err({ id, text }) { return text ? <p className="imm-error" id={id} role="alert">{text}</p> : null; }
function ReviewPerson({ title, person, patient = false }) {
  const facts = [['Name', person?.name], ...(patient ? [['Age / gender', [person?.age, person?.gender].filter((x) => x != null && x !== '').join(' / ')]] : [['Email', person?.email]]),
    ['Phone', person?.phone], ['Address', addr(person?.address)]];
  return <section className="admin-panel imm-section"><h2>{title}</h2><dl className="imm-facts imm-facts--side">
    {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Unavailable'}</dd></div>)}
  </dl></section>;
}

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
  if (order && mode === 'view') return <ImmunotherapyOrderSummary key={order.id} order={order} />;
  return <Editor key={`${id || 'new'}-${mode}`} order={order} mode={mode} />;
}

function Editor({ order, mode }) {
  const { date } = useAdminDateFormatters();
  const can = useOrderActions('immunotherapy');
  const BASE = useOrderBase('immunotherapy');
  const { portal, mr: authenticatedMR } = useOrderPortal();
  const mrPortal = portal === 'mr';
  const languageChoices = mrPortal
    ? (params, signal) => request('/patient-languages', { params, signal })
    : patientLanguageChoices;
  const [, navigate] = useLocation();
  const readOnly = mode === 'view' || !(order ? can.edit : can.add) || (mrPortal && order && !mrEditable(order));
  const isNew = !order;
  const initial = useRef(order ? fromOrder(order) : { ...blank(), mrId: authenticatedMR?.id || '' });
  // Only server-loaded saved associations or successful verified uploads count.
  // A filename, local metadata, pending upload or transfer claim is not evidence.
  const verifiedFiles = useRef(new Map((order?.attachments || []).map((f) => [f.id, order.patientId])));
  const [v, setV] = useState(initial.current);
  const [errors, setErrors] = useState({});
  const [groupMsg, setGroupMsg] = useState({});
  const [allergenEntries, setAllergenEntries] = useState({});
  const [explain, setExplain] = useState('');
  const [reg, setReg] = useState(null);
  const [regErrors, setRegErrors] = useState({});
  const [leave, setLeave] = useState(null);
  const [fileMsg, setFileMsg] = useState('');
  const [pending, setPending] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [recoveryIssue, setRecoveryIssue] = useState('');
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
  const { uploads, addFiles, removeUpload, retryUpload, clearUploads } = usePrescriptionSelections({
    patientId: v.patientId, attachments: v.attachments, policy, allowed: can.upload_attachment,
    busy, alive, setPending, attachVerified, setFileMsg,
  });
  const patients = useImmunotherapyReferences('patients', order ? [order.patient] : [], v.patientId);
  const doctors = useImmunotherapyReferences('doctors', order ? [order.doctor] : [], v.doctorId);
  const mrs = useImmunotherapyReferences('mrs', order ? [order.mr] : [], v.mrId);
  const allergens = useImmunotherapyReferences('allergens', [
    ...v.groups.flatMap((g) => g.items.map((i) => i.allergen)),
    ...Object.values(allergenEntries).map((entry) => entry.allergen),
  ]);
  const DOCTORS = doctors.items, MRS = mrs.items, ALLERGENS = allergens.items;
  const snap = { patients: patients.items };
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeSession(() => {
      if (getSession().user?.id && getSession().user.id !== owner.current) {
        setV(blank()); initial.current = blank(); mutation.current = null; clearUploads(); setAllergenEntries({});
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
  const hasAllergenEntry = Object.values(allergenEntries).some((entry) => entry.allergenId || entry.result);
  dirtyRef.current = dirty || regOpen || Boolean(pending) || uncertain || uploads.length > 0 || hasAllergenEntry;
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));

  useEffect(() => {
    if (readOnly) return undefined;
    return setNavigationGuard((request) => { if (!dirtyRef.current) return false; setLeave((current) => current || request); return true; });
  }, [readOnly]);

  useEffect(() => { if (regOpen) regNameRef.current?.focus(); }, [regOpen]);
  const closeReg = () => { setReg(null); setRegErrors({}); requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus()); };

  const patient = snap.patients.find((p) => p.id === v.patientId);
  const patientOptions = useMemo(() => snap.patients.map((p) => ({ value: p.id, label: patientLabel(p, mrPortal) })), [snap.patients, mrPortal]);
  const doctorOptions = DOCTORS.map((d) => ({ value: d.id, label: d.name }));
  const mrOptions = MRS.map((m) => ({ value: m.id, label: m.name }));
  const allergenOptions = ALLERGENS.map((a) => ({ value: a.id, label: a.name }));
  const total = order && v.pricingBasis === 'legacy_bottle_mrp' ? orderTotalMinor(order) : totalMinor(v.groups, v.pricingBasis);
  const legacy = v.pricingBasis === 'legacy_bottle_mrp';
  const repriced = legacy ? totalMinor(v.groups, 'allergen_rates') : total;
  const [viewing, setViewing] = useState(null);
  const adminReview = !mrPortal;
  const editRates = !legacy;
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
    if (pid !== v.patientId) {
      if (uploads.length || v.attachments.length) setFileMsg('Prescription selections were cleared because the patient changed. Choose prescriptions for the selected patient.');
      clearUploads();
    }
    const p = (mrPortal && patients.liveItems.find((x) => x.id === pid)) || snap.patients.find((x) => x.id === pid);
    const patch = { patientId: pid, shipping: 'patient', doctorId: p?.doctorId || '', mrId: authenticatedMR?.id || p?.mrId || '', attachments: pid === v.patientId ? v.attachments : [] };
    if (p && order && pid === order.patientId) { patch.dosage = initial.current.dosage; setExplain('Saved dosage for this order restored. You may change it.'); }
    else if (p) { const n = nextDose(p); patch.dosage = n.dosage; setExplain(n.explanation); }
    else { patch.dosage = ''; setExplain(''); }
    set(patch);
  }
  const updGroup = (gid, fn) => set({ groups: v.groups.map((g) => g.id === gid ? fn(g) : g) });
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
  function addAllergen(gid) {
    const entry = allergenEntries[gid] || {};
    const aid = entry.allergenId;
    const g = v.groups.find((x) => x.id === gid);
    const items = [...g.items, { suborderId: null, allergenId: aid, result: entry.result, allergen: entry.allergen }];
    const problem = !DOSES.includes(v.dosage) ? 'Choose a dosage before adding an allergen.'
      : !aid || !entry.allergen ? 'Select an Allergen Name.'
        : skinResultError(entry.result || '') || groupingError(items)
          || (items.length > 100 ? 'Use at most 100 allergens in this saved group.' : '')
          || (v.groups.reduce((n, group) => n + group.items.length, 0) >= 1000 ? 'Use at most 1,000 allergen items per order.' : '');
    if (problem) { setGroupMsg((m) => ({ ...m, [gid]: problem })); return; }
    setGroupMsg((m) => ({ ...m, [gid]: '' }));
    updGroup(gid, (x) => ({ ...x, items }));
    setAllergenEntries((entries) => ({ ...entries, [gid]: { allergenId: '', result: '' } }));
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
      patients.remember(mrPortal ? created : { ...created, address: { ...reg.address } });
      clearUploads();
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
  async function save(decision) {
    if (typeof decision !== 'string') decision = undefined;
    if (busy.current || getSession().user?.id !== owner.current) return;
    if (reg) { setErrors({ registration: 'Finish or cancel the patient registration before saving the order.' }); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    if (hasAllergenEntry) { setErrors({ groups: 'Add the entered allergen or explicitly clear its entry before saving.' }); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    if (uploads.some((u) => ['queued', 'uploading'].includes(u.state))) { setErrors({ attachments: 'Wait for uploads to finish. Only verified prescriptions count.' }); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    // An unconfirmed submission must retain its exact payload/key, not be
    // revalidated or changed into a different mutation during a safe retry.
    const submission = decision ? { ...v, status: decision } : v;
    if (!mutation.current) {
      if (decision) set({ status: decision });
      const problems = orderErrors(submission, v.attachments.some((f) => verifiedFiles.current.get(f.id) === v.patientId), { mr: mrPortal, previous: saveBase.current });
      if (Object.keys(problems).length) { setErrors(problems); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    }
    const wasUncertain = uncertain;
    busy.current = true; setPending('save'); setErrors({});
    if (!mutation.current) mutation.current = prepareOrderSave(submission, saveBase.current, crypto.randomUUID());
    try {
      const saved = await submitOrderSave(mutation.current);
      if (!alive.current) return;
      initial.current = v; dirtyRef.current = false; setErrors({}); setUncertain(false);
      navigate(isNew ? `${BASE}/${saved.id}` : BASE);
    } catch (cause) {
      if (alive.current) {
        // After a lost response, only an owner/key-bound terminal rejection
        // under the server's mutation lock proves the original cannot commit.
        // Schema/auth/transport failures before that lock cannot clear unknown.
        const unresolved = Boolean(cause.ambiguous) || (wasUncertain && !cause.terminal);
        setUncertain(unresolved);
        setRecoveryIssue(unresolved && [401, 403].includes(cause.status)
          ? 'Session or permission recovery is required. Only the original account with current edit access can recover this request; no replacement save has been created.'
          : unresolved && cause.code === 'imm_retry'
            ? 'The server could not match this request identity. Keep this draft open and ask the operator to investigate; do not create a replacement save.'
            : '');
        if (!unresolved) mutation.current = null;
        setErrors(unresolved ? { form: cause.message } : saveErrors(cause, v));
        if (!unresolved && cause.code === 'imm_stale' && order) {
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
    if (k.startsWith('group-')) return `Group ${gIndex(k.slice(6)) + 1}`;
    if (k.startsWith('mrp-')) return 'Legacy bottle MRP';
    if (k.startsWith('rate-')) return 'Allergen rate (INR)';
    if (k.startsWith('result-')) { const gi = v.groups.findIndex((g) => k.startsWith(`result-${g.id}-`)); const aid = gi >= 0 ? k.slice(`result-${v.groups[gi].id}-`.length) : ''; return `${nameOf(ALLERGENS, aid)} result (group ${gi + 1})`; }
    return mrPortal ? 'Order field' : k;
  };
  const targetFor = (k) => {
    if (k === 'dosage') return `imm-dose-${v.dosage || DOSES[0]}`;
    if (k === 'shipping') return `imm-ship-${v.shipping}`;
    if (k === 'groups') return 'imm-h-allergens';
    if (k === 'attachments') return readOnly || !can.upload_attachment || !policy || !v.patientId ? 'imm-files-hint' : 'imm-files';
    if (k === 'registration') return 'imm-reg-name';
    if (k.startsWith('group-')) return `imm-add-${gIndex(k.slice(6))}`;
    if (k.startsWith('mrp-')) return 'imm-h-allergens';
    if (k.startsWith('rate-')) return `imm-${k}`;
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
        <p className="admin-page-head__description">{readOnly ? 'Saved historical order details.' : adminReview && order ? 'Review clinical details, prescriptions and suborder rates before your decision.' : 'Patient first, then dosage, allergens and shipping.'}</p></div>
      <div className="imm-actions">
        <button type="button" className="admin-button admin-button--secondary" onClick={() => guarded(BASE)} data-testid="button-imm-back"><ArrowLeft size={15} aria-hidden="true" />{readOnly ? 'Back' : 'Cancel'}</button>
        {order && readOnly && can.edit && (!mrPortal || mrEditable(order)) && <Link href={`${BASE}/${order.id}/edit`} className="admin-button" data-testid="link-imm-to-edit"><Pencil size={15} aria-hidden="true" />Edit</Link>}
      </div>
    </div>
    {uncertain && <section className="imm-boundary imm-recovery" role="alert" tabIndex={-1} ref={summaryRef} aria-labelledby="imm-recovery-title">
      <h2 id="imm-recovery-title">Save outcome is unconfirmed</h2>
      <p>{errors.form || 'The server response did not confirm the outcome.'}</p>
      <p>Your draft is preserved and editing is locked. Retry the exact submitted request to recover a committed save or finish it safely. The payload, expected version and request key will not change. Do not reload, leave this page or create another order to dismiss this notice.</p>
      {recoveryIssue && <p>{recoveryIssue}</p>}
      <button type="button" className="admin-button" disabled={Boolean(pending)} onClick={() => save()}>{pending === 'save' ? 'Recovering same save…' : 'Recover this same save safely'}</button>
    </section>}
    {mrPortal && order && !mrEditable(order) && <p className="imm-boundary">This saved order is read-only for MR because it has Admin review or historical pricing data.</p>}
    {!uncertain && errList.length > 0 && <div className="imm-errors" role="alert" tabIndex={-1} ref={summaryRef} data-testid="error-imm-summary"><strong>{errors.form && errList.length === 1 ? 'Save not completed — draft preserved' : `Fix ${errList.length} problem${errList.length > 1 ? 's' : ''} before saving`}</strong>
      <ul>{errList.map(([k, m]) => <li key={k}><button type="button" className="imm-link-btn" onClick={() => focusId(targetFor(k))} data-testid={`link-imm-error-${k}`}>{labelFor(k)}: {m}</button></li>)}</ul></div>}
    <div className="imm-layout">
      <div className="imm-main">
        <section className="admin-panel imm-section" aria-labelledby="imm-h-patient"><h2 id="imm-h-patient">Patient</h2>
          <p className="imm-hint">Search by name, ID or phone.</p>
          <div className="imm-grid" style={{ marginTop: 12 }}>
            <div className="imm-field"><label htmlFor="imm-patientId">Patient</label>
               <SearchableSelect viewportMenu id="imm-patientId" label="Patient" value={v.patientId} options={patientOptions} onSearch={patients.onSearch} searchOptions={() => mrPortal ? patients.liveItems.map((p) => ({ value: p.id, label: patientLabel(p, mrPortal) })) : patientOptions} onChange={choosePatient} placeholder="Find a patient" invalid={errors.patientId} describedBy={errors.patientId ? 'imm-patientId-err' : undefined} disabled={dis} />
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
          {!dis && !reg && !mrPortal && can.protected && <div className="imm-btn-row" style={{ marginTop: 14 }}><button type="button" className="admin-button admin-button--secondary" onClick={(e) => { openerRef.current = e.currentTarget; setReg({ ...blankReg(), doctorId: v.doctorId }); setRegErrors({}); }} data-testid="button-imm-register"><UserPlus size={15} aria-hidden="true" />Register patient</button></div>}
          {!mrPortal && reg && <form className="imm-reg" onSubmit={register} noValidate aria-label="Register patient" data-testid="form-imm-register"><fieldset disabled={Boolean(pending)} style={{ display: 'contents', border: 0, padding: 0, margin: 0 }}>
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

        <section className="admin-panel imm-section" aria-labelledby="imm-h-allergens"><h2 id="imm-h-allergens" tabIndex={-1}>Allergen Details</h2>
          <p className="imm-hint">Select an allergen, enter its Skin Test Result (mm), then press Add. Each allergen can appear only once in the same group.</p>
          {adminReview && legacy && <div className="imm-reprice">
            <strong>Historical bottle-MRP pricing — allergen rates are read-only</strong>
            <p className="imm-hint">Enable rate editing explicitly to draft a sum of allergen/suborder rates. Every rate is required to save the conversion. Viewing or cancelling does not change the saved basis or total.</p>
            {!readOnly && <button type="button" className="admin-button" disabled={dis} onClick={() => set({ pricingBasis: 'allergen_rates' })}>Enable rate editing / Reprice</button>}
          </div>}
          {adminReview && !legacy && order && (order.pricingBasis || 'legacy_bottle_mrp') === 'legacy_bottle_mrp' && <p className="imm-explain">Rate editing enabled for this draft only. Total: {money(total)}. Saving requires every rate; cancelling or discarding keeps historical pricing.</p>}
          {v.groups.length > 1 && <p className="imm-hint">Saved bottle associations are retained below. Results remain in their original group.</p>}
          {!readOnly && <ReferenceState source={allergens} label="allergens" />}
          <Err id="imm-groups-err" text={errors.groups} />
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {v.groups.map((g, gi) => {
              const err = groupMsg[g.id] || errors[`group-${g.id}`];
              const entry = allergenEntries[g.id] || { allergenId: '', result: '' };
              const editEntry = (patch) => setAllergenEntries((entries) => ({ ...entries, [g.id]: { allergenId: '', result: '', ...entries[g.id], ...patch } }));
              return <div className="imm-allergen-results" key={g.id}>
                {v.groups.length > 1 && <h3 className="imm-hint">Saved group {gi + 1} (internal association retained)</h3>}
                {!readOnly && <div className="imm-allergen-entry">
                  <div className="imm-field"><label htmlFor={`imm-add-${gi}`}>Allergen Name</label><SearchableSelect viewportMenu id={`imm-add-${gi}`} label={v.groups.length > 1 ? `Allergen Name for saved group ${gi + 1}` : 'Allergen Name'} value={entry.allergenId} options={allergenOptions} onSearch={allergens.onSearch} searchOptions={() => allergenOptions} onChange={(aid) => editEntry({ allergenId: aid, allergen: ALLERGENS.find((a) => a.id === aid) })} placeholder="Select allergen" invalid={Boolean(err)} describedBy={err ? `group-${g.id}-err` : undefined} disabled={dis || !v.dosage} /></div>
                  <label className="imm-field" htmlFor={`imm-entry-result-${gi}`}>Skin Test Result (mm)<input id={`imm-entry-result-${gi}`} inputMode="decimal" required value={entry.result} disabled={dis || !v.dosage} onChange={(e) => editEntry({ result: e.target.value })} aria-invalid={Boolean(err)} aria-describedby={err ? `group-${g.id}-err` : undefined} /></label>
                  <button type="button" className="admin-button" disabled={dis || !v.dosage} onClick={() => addAllergen(g.id)} aria-label={v.groups.length > 1 ? `Add allergen to saved group ${gi + 1}` : 'Add allergen'}><Plus size={15} aria-hidden="true" />Add</button>
                  {(entry.allergenId || entry.result) && <button type="button" className="imm-link-btn" disabled={dis} onClick={() => { editEntry({ allergenId: '', result: '', allergen: undefined }); setGroupMsg((messages) => ({ ...messages, [g.id]: '' })); }} aria-label={`Clear allergen entry${v.groups.length > 1 ? ` for saved group ${gi + 1}` : ''}`}>Clear entry</button>}
                </div>}
                {!readOnly && !v.dosage && <p className="imm-hint">Choose a dosage to enable allergen entry.</p>}
                <Err id={`group-${g.id}-err`} text={err} />
                {!g.items.length && <p className="imm-hint">No allergens added.</p>}
                {g.items.map((it, ii) => { const a = ALLERGENS.find((x) => x.id === it.allergenId); const ek = `result-${g.id}-${it.allergenId}`;
                  return <div className="imm-item" key={it.allergenId}>
                    <div className="imm-item__name">{it.allergen?.name || a?.name || 'Saved allergen'}<span className="imm-cell-sub">{it.allergen?.concentration || a?.concentration}</span><span className="imm-suborder" data-testid={`text-imm-suborder-${gi}-${ii}`}>Suborder {it.suborderId || 'pending save (server-assigned)'}</span></div>
                    <div className="imm-field"><label htmlFor={`imm-r-${gi}-${ii}`}>Skin Test Result (mm)</label><input id={`imm-r-${gi}-${ii}`} inputMode="decimal" required value={it.result} disabled={dis} aria-invalid={Boolean(errors[ek])} aria-describedby={errors[ek] ? `${ek}-err` : undefined} onChange={(e) => updGroup(g.id, (x) => ({ ...x, items: x.items.map((y) => y.allergenId === it.allergenId ? { ...y, result: e.target.value } : y) }))} /><Err id={`${ek}-err`} text={errors[ek]} /></div>
                    {adminReview && (() => { const rk = `rate-${g.id}-${it.allergenId}`; const locked = dis || (legacy && !editRates); return <div className="imm-field"><label htmlFor={`imm-${rk}`}>Rate (INR)</label><input id={`imm-${rk}`} inputMode="decimal" required={v.status === 'Approved'} value={it.rate ?? ''} disabled={locked} aria-invalid={Boolean(errors[rk])} aria-describedby={errors[rk] ? `${rk}-err` : undefined} onChange={(e) => updGroup(g.id, (x) => ({ ...x, items: x.items.map((y) => y.allergenId === it.allergenId ? { ...y, rate: e.target.value } : y) }))} data-testid={`input-imm-rate-${gi}-${ii}`} /><Err id={`${rk}-err`} text={errors[rk]} /></div>; })()}
                    {!dis && <button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Remove ${it.allergen?.name || a?.name || 'saved allergen'}${v.groups.length > 1 ? ` from saved group ${gi + 1}` : ''}`} onClick={() => updGroup(g.id, (x) => ({ ...x, items: x.items.filter((y) => y.allergenId !== it.allergenId) }))}><Trash2 size={16} aria-hidden="true" /></button>}
                  </div>; })}
              </div>; })}
          </div>
        </section>

        <section className="admin-panel imm-section" aria-labelledby="imm-h-more"><h2 id="imm-h-more">Details and shipping</h2>
          <div className="imm-grid" style={{ marginTop: 12 }}>
            {!isNew && !mrPortal && <div className="imm-field"><label htmlFor="imm-status">Status</label><select id="imm-status" value={v.status} disabled={dis} onChange={(e) => set({ status: e.target.value })} aria-invalid={Boolean(errors.status)} aria-describedby={errors.status ? 'imm-status-err' : undefined} data-testid="select-imm-order-status">{STATUSES.filter((s) => s !== 'Confirmed' || order.status === 'Confirmed').map((s) => <option key={s}>{s}</option>)}</select><Err id="imm-status-err" text={errors.status} /><p className="imm-hint">Order tracking only; does not record treatment administration, stock or payments.</p></div>}
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
          <OrderFileList label="Prescription selections" empty="No files selected or attached.">
            {v.attachments.map((f) => {
              const locked = mrPortal && order?.attachments?.some((saved) => saved.id === f.id);
              return <DownloadOrderFile key={f.id} file={f} allowed={can.read_attachment} download={downloadPrescription} locked={locked}
                status={order?.attachments?.some((saved) => saved.id === f.id) ? 'Saved prescription — retained' : 'Uploaded / verified — selected for this save'}
                actions={<>{!mrPortal && can.read_attachment && !f.restricted && (f.state ?? 'verified') === 'verified' && <button type="button" className="admin-button admin-button--secondary" onClick={() => setViewing(f)} aria-label={`View ${f.name}`} data-testid={`button-imm-view-${f.id}`}><Eye size={15} aria-hidden="true" />View</button>}{!readOnly && !locked && <button type="button" className="admin-icon-button" disabled={uncertain || Boolean(pending && pending !== 'upload')} onClick={() => setV((current) => ({ ...current, attachments: current.attachments.filter((file) => file.id !== f.id) }))} aria-label={f.restricted || !can.read_attachment ? 'Remove restricted attachment' : `Remove ${f.name}`}><X size={16} aria-hidden="true" /></button>}</>} />;
            })}
            {uploads.map((u) => <OrderFileRow key={u.key} name={u.name} size={u.size} progressing={['queued', 'uploading'].includes(u.state)}
              status={`${u.state === 'failed' ? 'Failed' : u.state === 'rejected' ? 'Rejected' : u.state === 'unverified' ? 'Awaiting verification' : u.state === 'queued' ? 'Queued' : 'Uploading'} — ${u.message}`}
              actions={<><button type="button" className="admin-icon-button" disabled={uncertain || Boolean(pending && pending !== 'upload')} onClick={() => removeUpload(u.key)} aria-label={`Remove ${u.name}`}><X size={16} aria-hidden="true" /></button>
                {!['queued', 'uploading'].includes(u.state) && <button type="button" className="admin-button admin-button--secondary" disabled={Boolean(pending) || uncertain || !can.upload_attachment || !policy || !v.patientId} onClick={() => retryUpload(u.key)} aria-label={`${u.id ? 'Check availability of' : 'Retry upload of'} ${u.name}`}>{u.id ? 'Check availability' : 'Retry upload'}</button>}</>} />)}
          </OrderFileList>
        </section>

        {!readOnly && <section className="admin-panel imm-section imm-bottom" aria-labelledby="imm-h-review"><h2 id="imm-h-review">{adminReview ? 'Purchase order and decision' : 'Submit order'}</h2>
          {adminReview && <><label className="imm-field" htmlFor="imm-poNumber">PO number (optional)<input id="imm-poNumber" value={v.poNumber} maxLength={100} disabled={dis} aria-invalid={Boolean(errors.poNumber)} aria-describedby={errors.poNumber ? 'imm-poNumber-err' : undefined} onChange={(e) => set({ poNumber: e.target.value })} data-testid="input-imm-po" /></label>
            <Err id="imm-poNumber-err" text={errors.poNumber} />
            <p className="imm-hint">Approval requires a rate for every suborder and a verified prescription for the patient. PO number may be omitted or cleared. Rejection does not require prices.</p></>}
          <div className="imm-btn-row">
            {adminReview && !isNew && <button type="button" className="admin-button" disabled={dis} onClick={() => save('Approved')} data-testid="button-imm-approve">Approve</button>}
            {adminReview && !isNew && <button type="button" className="admin-button admin-button--danger" disabled={dis} onClick={() => save('Rejected')} data-testid="button-imm-reject">Reject</button>}
            <button type="button" className="admin-button" disabled={Boolean(pending)} onClick={save} data-testid="button-imm-save">{pending === 'save' ? 'Saving…' : uncertain ? 'Retry same save safely' : isNew ? 'Save order' : 'Update'}</button>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => guarded(BASE)} data-testid="button-imm-cancel">Cancel</button></div>
        </section>}
      </div>
      <aside className="imm-aside" aria-label="Order summary">
        <div className="admin-panel imm-section"><h2>Summary</h2>
          <dl className="imm-facts" style={{ gridTemplateColumns: '1fr' }}>
            <div><dt>Patient</dt><dd>{patient?.name || 'Not chosen'}</dd></div>
            <div><dt>Doctor / MR</dt><dd>{nameOf(DOCTORS, v.doctorId) || '-'} / {nameOf(MRS, v.mrId) || '-'}</dd></div>
            <div><dt>Dosage</dt><dd>{v.dosage || 'Awaiting choice'}</dd></div>
            {order && <><div><dt>Order</dt><dd>{order.number}</dd></div><div><dt>Order date</dt><dd>{date(order.date)}</dd></div></>}
            <div><dt>Ship to ({v.shipping})</dt><dd data-testid="text-imm-recipient">{recipient ? <>{recipient.name}<span className="imm-cell-sub">{recipient.phone}</span><span className="imm-cell-sub">{addr(recipient.address)}</span></> : '-'}</dd></div>
            <div><dt>Value</dt><dd>{money(total)}</dd></div>
            {order?.reviewDecision && <div><dt>Admin decision</dt><dd>{order.reviewDecision}</dd></div>}
            {order?.poNumber && <div><dt>Saved PO number</dt><dd>{order.poNumber}</dd></div>}
            {v.status === 'Confirmed' && <div><dt>Admin review</dt><dd>{total === null ? 'Awaiting review and pricing' : 'Awaiting decision'}</dd></div>}
            {order && <div><dt>Status</dt><dd><StatusPill status={v.status} /></dd></div>}</dl></div>
        {adminReview && <div className="admin-panel imm-section"><h2>Pricing</h2>
          <p className="imm-hint">{legacy ? 'Legacy pricing basis: saved bottle MRPs. Historical bottle MRPs cannot be changed here.' : 'Total is the sum of the rate entered for each suborder.'}</p>
          <div className="imm-totals">{v.groups.flatMap((g) => g.items.map((it, ii) => <div key={`${g.id}-${ii}`}><span>{it.suborderId || 'Suborder pending save'}</span><span className="imm-num">{legacy ? 'Legacy' : money(parseAmount(it.rate))}</span></div>))}
            <div className="imm-total"><span>Total{legacy ? ' (legacy bottle MRP)' : ''}</span><span className="imm-num" data-testid="text-imm-total">{money(total)}</span></div></div>
          {legacy && !readOnly && <label className="imm-reprice"><span><input type="checkbox" checked={false} disabled={dis} onChange={() => set({ pricingBasis: 'allergen_rates' })} data-testid="checkbox-imm-reprice" /> Reprice by allergen rates</span>
            <span className="imm-hint">Switches this order to allergen rates. Resulting rate sum with the rates currently entered: {money(repriced)}. Historical bottle MRPs are not edited.</span></label>}
          {!legacy && order && (order.pricingBasis || 'legacy_bottle_mrp') === 'legacy_bottle_mrp' && !readOnly && <button type="button" className="admin-button admin-button--secondary" disabled={dis} onClick={() => set({ pricingBasis: 'legacy_bottle_mrp', groups: v.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, rate: order.groups.find((saved) => saved.id === g.id)?.items.find((saved) => saved.allergenId === i.allergenId)?.rate ?? null })) })) })}>Discard rate changes and keep legacy pricing</button>}
          <dl className="imm-facts" style={{ gridTemplateColumns: '1fr' }}><div><dt>Billing doctor</dt><dd data-testid="text-imm-billing-doctor">{doctor ? <>{doctor.name}<span className="imm-cell-sub">{doctor.phone}</span><span className="imm-cell-sub">{addr(doctor.address)}</span></> : 'Not chosen'}</dd></div></dl>
          <p className="imm-hint">Missing rates mean awaiting pricing, not zero. No tax, payment or invoice.</p></div>}
        {adminReview && <><ReviewPerson title={order && v.patientId === order.patientId ? 'Patient (saved facts)' : 'Patient'} person={patient} patient />
          <ReviewPerson title={order && v.doctorId === order.doctorId ? 'Doctor (saved facts)' : 'Doctor'} person={doctor} />
          <ReviewPerson title={order && v.mrId === order.mrId ? 'MR (saved facts)' : 'MR'} person={MRS.find((m) => m.id === v.mrId)} />
          <ReviewPerson title="Shipping facts" person={recipient} /></>}
      </aside>
    </div>
    {viewing && <PrescriptionViewer file={viewing} load={prescriptionBlob} download={downloadPrescription} allowed={can.read_attachment} onClose={() => setViewing(null)} />}
    {leave && <ImmDialog title="Leave without saving?" eyebrow="Unsaved changes" className="imm-dialog--sm" description={pending || uncertain ? 'A save or upload may still be unresolved. Keep this draft open and retry the same operation before leaving.' : 'Your unsaved edits will be lost. Patient Master records already registered are not undone.'} onClose={() => setLeave(null)} testId="dialog-imm-leave">
      <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => setLeave(null)} data-testid="button-imm-stay">Keep editing</button>
        <button type="button" className="admin-button admin-button--danger" disabled={Boolean(pending) || uncertain} onClick={proceed} data-testid="button-imm-leave">Leave</button></div></ImmDialog>}
    {conflict && <ImmDialog title="Reconcile a newer saved version" eyebrow="Order changed" description="Your draft has not been discarded or saved. Compare the latest saved record with your draft. Confirming below keeps your values for another explicit Save; it does not save immediately." onClose={() => setConflict(null)}>
      <details><summary>Latest saved order — version {conflict.version}</summary>{mrPortal
        ? <ImmunotherapyConflictDetails order={conflict} patient={conflict.patient} doctor={conflict.doctor} mr={conflict.mr} />
        : <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(conflict, null, 2)}</pre>}</details>
      <details><summary>Your mounted draft</summary>{mrPortal
        ? <ImmunotherapyConflictDetails order={v} patient={patient} doctor={doctor} mr={MRS.find((m) => m.id === v.mrId)} />
        : <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(v, null, 2)}</pre>}</details>
      <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => setConflict(null)}>Keep draft without rebasing</button>
        <button type="button" className="admin-button" onClick={() => { saveBase.current = conflict; mutation.current = null; setConflict(null); setErrors({ form: 'Draft retained against the reviewed current version. Review your values, then save explicitly. Another concurrent change will be rejected again.' }); }}>Use reviewed version and keep my draft</button></div>
    </ImmDialog>}
  </div></AdminLayout>;
}
