import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus } from 'lucide-react';
import PhoneInput from '../components/admin/PhoneInput.jsx';
import { addDoctor, doctorErrors, money, orderBalance, orderPaymentStatus } from '../services/mrWorkspaceDemo.js';
import { Empty, Field, Head, PatientLock, statusPill, useDate, useDirtyGuard, useWs } from './common.jsx';

export function DoctorList() {
  const { state } = useWs();
  const [q, setQ] = useState('');
  const rows = state.doctors.filter((d) => `${d.name} ${d.clinic} ${d.registration}`.toLowerCase().includes(q.trim().toLowerCase()));
  return <>
    <Head eyebrow="My Doctors" title="My Doctors" text="Fictional doctors assigned to this demo MR."><Link href="/mr/doctors/new" className="admin-button" data-testid="link-onboard-doctor"><Plus size={16} aria-hidden="true" /> Onboard doctor</Link></Head>
    <div className="mrw-bar"><input type="search" aria-label="Search doctors" placeholder="Search by name, clinic or registration" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-doctors" /></div>
    {rows.length === 0 ? <div className="mrw-card"><Empty title="No doctors found" text={q ? 'Try a different search.' : 'Onboard your first demo doctor.'} to="/mr/doctors/new" action="Onboard doctor" /></div> :
      <div className="mrw-grid">{rows.map((d) => <Link key={d.id} href={`/mr/doctors/${encodeURIComponent(d.id)}`} className="mrw-card"  data-testid={`card-doctor-${d.id}`}>
        <strong>{d.name}</strong><div className="mrw-notice">{d.qualification}</div><p className="mrw-tight">{d.clinic}</p><div className="mrw-notice">{d.phone} {d.email ? `· ${d.email}` : ''}</div><div style={{ marginTop: 10 }}>{statusPill(String(d.status).toLowerCase())}</div></Link>)}</div>}
  </>;
}

export function DoctorDetail({ id }) {
  const { state } = useWs();
  const date = useDate();
  const d = state.doctors.find((x) => x.id === id);
  if (!d) return <div className="mrw-card"><Empty title="Doctor not found" text="This demo doctor is not in your workspace." to="/mr/doctors" action="Back to doctors" /></div>;
  const orders = state.orders.filter((o) => o.doctorId === d.id);
  const pays = state.payments.filter((p) => p.doctorId === d.id);
  const advance = pays.filter((p) => p.kind === 'advance').reduce((s, p) => s + p.amount, 0);
  return <>
    <Head eyebrow="My Doctors" title={d.name} text={`${d.qualification} · Reg. ${d.registration}`}>
      <Link href={`/mr/orders/new?doctor=${encodeURIComponent(d.id)}`} className="admin-button">Place order</Link>
      <Link href={`/mr/payments/new?doctor=${encodeURIComponent(d.id)}&kind=advance`} className="admin-button admin-button--secondary">Add payment</Link></Head>
    <div className="mrw-split">
      <div className="mrw-card"><h2>Profile</h2><dl className="mrw-dl"><dt>Clinic</dt><dd>{d.clinic}</dd><dt>Phone</dt><dd>{d.phone}</dd><dt>Email</dt><dd>{d.email || '—'}</dd><dt>Address</dt><dd>{d.address}</dd><dt>Status</dt><dd>{statusPill(String(d.status).toLowerCase())}</dd><dt>Assigned MR</dt><dd>You (fixed)</dd></dl></div>
      <div className="mrw-card"><h2>Patients</h2><PatientLock /><div className="mrw-stat" style={{ marginTop: 12 }}><span>Unapplied advance credit</span><strong>{money(advance)}</strong></div></div>
    </div>
    <div className="mrw-card"><h2>Orders</h2>{orders.length === 0 ? <p className="mrw-notice">No orders yet.</p> : <ul className="mrw-list">{orders.map((o) => <li key={o.id}><Link href={`/mr/orders/${encodeURIComponent(o.id)}`}><span>{o.id} · {date(o.date)}</span><span>{money(o.total)} {statusPill(o.status)} {o.status === 'placed' && statusPill(orderPaymentStatus(state, o))}{o.status === 'placed' && <small> bal {money(orderBalance(state, o))}</small>}</span></Link></li>)}</ul>}</div>
  </>;
}

const STEPS = [['Identity', ['name', 'qualification', 'registration']], ['Clinic and contact', ['clinic', 'phone', 'email']], ['Address', ['address']], ['Review', []]];
const EMPTY = { name: '', qualification: '', registration: '', clinic: '', phoneCountry: 'IN', phone: '', email: '', address: '' };
const REQUIRED = new Set(['name', 'qualification', 'registration', 'clinic', 'phone', 'address']);
const LABELS = { name: 'Doctor name', qualification: 'Qualification', registration: 'Registration number', clinic: 'Clinic', phone: 'Phone number', email: 'Email (optional)', address: 'Address' };

export function DoctorForm() {
  const { state, apply, setFlash } = useWs();
  const [, navigate] = useLocation();
  const [form, setForm] = useState(EMPTY);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const focusKey = useRef(null);
  const saved = useRef(false);
  const dirty = !saved.current && JSON.stringify(form) !== JSON.stringify(EMPTY);
  useDirtyGuard(dirty);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const all = useMemo(() => doctorErrors(form) || {}, [form]);
  function next() {
    const mine = Object.fromEntries(STEPS[step][1].filter((k) => all[k]).map((k) => [k, all[k]]));
    setErrors(mine);
    focusKey.current = Object.keys(mine)[0] || null;
    if (Object.keys(mine).length === 0) setStep(step + 1);
  }
  useEffect(() => {
    if (focusKey.current) { document.getElementById(`doc-${focusKey.current}`)?.focus(); focusKey.current = null; }
  }, [errors]);
  function save() {
    if (busy.current) return;
    busy.current = true;
    const before = new Set(state.doctors.map((d) => d.id));
    const r = apply((s) => addDoctor(s, form));
    busy.current = false;
    if (!r.ok) { setMessage(r.message); return; }
    saved.current = true;
    const created = r.state.doctors.find((d) => !before.has(d.id));
    setFlash(`${created?.name || 'Doctor'} onboarded to your demo workspace.`, `/mr/doctors/${created?.id}`);
    navigate(`/mr/doctors/${encodeURIComponent(created?.id)}`);
  }
  const field = (k, props = {}) => <Field id={`doc-${k}`} label={REQUIRED.has(k) ? `${LABELS[k]} (required)` : LABELS[k]} error={errors[k]}>{props.area ?
    <textarea className="mrw-input" id={`doc-${k}`} aria-required={REQUIRED.has(k)} value={form[k]} onChange={set(k)} aria-invalid={Boolean(errors[k])} aria-describedby={errors[k] ? `doc-${k}-error` : undefined} data-testid={`input-doctor-${k}`} /> :
    <input className="mrw-input" id={`doc-${k}`} aria-required={REQUIRED.has(k)} value={form[k]} onChange={set(k)} aria-invalid={Boolean(errors[k])} aria-describedby={errors[k] ? `doc-${k}-error` : undefined} data-testid={`input-doctor-${k}`} {...props} />}</Field>;
  return <>
    <Head eyebrow="My Doctors" title="Onboard doctor" text="Use fictional details only. Do not enter a real doctor, clinic or phone number." />
    <div className="mrw-card">
      <p className="mrw-notice">Fields marked required must be completed. Use fictional details only.</p>
      <ol className="mrw-steps" aria-label="Progress">{STEPS.map(([n], i) => <li key={n} aria-current={i === step ? 'step' : undefined}>{i + 1}. {n}</li>)}</ol>
      {message && <div className="mrw-alert" role="alert">{message}</div>}
      <div className="mrw-form" style={{ marginTop: 16 }}>
        {step === 0 && <>{field('name')}{field('qualification')}{field('registration')}</>}
        {step === 1 && <>{field('clinic')}<Field id="doc-phone" label="Phone number (required)" error={errors.phone}><PhoneInput prefix="doc" country={form.phoneCountry} onCountryChange={(v) => setForm((f) => ({ ...f, phoneCountry: v }))} inputProps={{ id: 'doc-phone', name: 'phone', value: form.phone, onChange: set('phone'), className: 'mrw-input', 'aria-required': true, 'aria-invalid': Boolean(errors.phone), 'aria-describedby': errors.phone ? 'doc-phone-error' : undefined, 'data-testid': 'input-doctor-phone' }} /></Field>{field('email', { type: 'email' })}</>}
        {step === 2 && <div className="mrw-wide">{field('address', { area: true })}</div>}
        {step === 3 && <div className="mrw-wide"><dl className="mrw-dl">{Object.keys(LABELS).map((k) => <Fragment key={k}><dt>{LABELS[k]}</dt><dd>{k === 'phone' ? `${form.phoneCountry} ${form.phone}` : form[k] || '—'}</dd></Fragment>)}<dt>Assigned MR</dt><dd>You (fixed)</dd></dl></div>}
      </div>
      <div className="mrw-actions" style={{ marginTop: 20 }}>
        {step > 0 && <button type="button" className="admin-button admin-button--secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 3 ? <button type="button" className="admin-button" onClick={next} data-testid="button-doctor-next">Continue</button> : <button type="button" className="admin-button" onClick={save} data-testid="button-doctor-save">Save doctor</button>}
        <Link href="/mr/doctors" className="admin-button admin-button--secondary" data-testid="link-doctor-cancel">Cancel</Link>
      </div>
    </div>
  </>;
}
