import { useMemo, useState } from 'react';
import { useSearch } from 'wouter';
import { Plus, Search, ClipboardList, ShoppingCart, Pill, FlaskConical, Printer, ArrowRight } from 'lucide-react';
import SearchableSelect from '../components/admin/SearchableSelect.jsx';
import * as store from './doctorStore.js';
import { A, Badge, Empty, Field, Head, Notice, Row, Steps, RecordList, PrintPageStyle, describe, msg, useDemo, useDirty, useFmt, useGuard } from './ui.jsx';

const { money, doseStatus, dashboard, patientHistory, today } = store;
export const pname = (S, id) => S.patients.find((p) => p.id === id)?.name || 'Unknown patient';
export const patientOptions = (S) => S.patients.map((p) => ({ value: p.id, label: p.name }));
const cnt = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
const byDateDesc = (key) => (a, b) => String(b[key]).localeCompare(String(a[key]));

function NotFound({ what, back, to }) {
  return <Empty title={`${what} not found`} action={<A to={to} className="admin-button admin-button--secondary">{back}</A>}>This record does not exist in the current demo workspace. It may have been reset.</Empty>;
}

export function Dashboard() {
  const S = useDemo();
  const fd = useFmt();
  const d = dashboard(S) || {};
  const upcoming = S.doses.filter((x) => doseStatus(x) === 'Upcoming').sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  const overdue = S.doses.filter((x) => doseStatus(x) === 'Overdue');
  const tests = [...S.tests].sort(byDateDesc('date')).slice(0, 4);
  const active = S.orders.filter((o) => o.status !== 'Delivered' && o.status !== 'Draft');
  const cards = [
    ['Patients', cnt(d.patientCount), '/doctor/patients'],
    ['Overdue doses', overdue.length, '/doctor/doses'],
    ['Upcoming doses', upcoming.length, '/doctor/doses'],
    ['Active orders', cnt(d.activeOrders) || active.length, '/doctor/orders'],
    ['Outstanding balance', money(Number(d.outstandingMinor) || 0), '/doctor/payments'],
  ];
  return (
    <>
      <Head eyebrow="Today" title="Good day, Dr. Sen" description="Fictional workspace. Summaries below come from the same demo records you edit." actions={<>
        <A to="/doctor/patients/new" className="admin-button"><Plus size={15} /> Add patient</A>
        <A to="/doctor/tests/new" className="admin-button admin-button--secondary"><FlaskConical size={15} /> Record allergy test</A>
        <A to="/doctor/orders/new" className="admin-button admin-button--secondary"><ShoppingCart size={15} /> Place order</A></>} />
      <div className="dr-stats">{cards.map(([l, v, to]) => <A key={l} to={to} className="dr-stat admin-panel"><small>{l}</small><strong>{v}</strong><ArrowRight size={14} aria-hidden="true" /></A>)}</div>
      <div className="dr-grid2">
        <section className="admin-panel dr-section"><h2>Doses needing attention</h2>
          {overdue.length + upcoming.length === 0 ? <Empty title="No scheduled doses">Add a scheduled dose from a patient profile.</Empty> :
            [...overdue, ...upcoming].slice(0, 6).map((x) => <Row key={x.id} to={`/doctor/doses/${x.id}`} title={pname(S, x.patientId)} sub={x.details} meta={fd(x.scheduledDate)} badge={<Badge status={doseStatus(x)} />} />)}
        </section>
        <section className="admin-panel dr-section"><h2>Recent test records</h2>
          {!tests.length ? <Empty title="No test records">Saved sample tests appear here.</Empty> :
            tests.map((t) => <Row key={t.id} to={`/doctor/tests/${t.id}`} title={pname(S, t.patientId)} sub={`${t.allergen}: ${t.result} ${t.unit}`} meta={fd(t.date)} />)}
        </section>
        <section className="admin-panel dr-section"><h2>Active orders</h2>
          {!active.length ? <Empty title="No active orders">Placed and shipped orders appear here.</Empty> :
            active.slice(0, 5).map((o) => <Row key={o.id} to={`/doctor/orders/${o.id}`} title={`Order ${o.id}`} sub={pname(S, o.patientId)} meta={money(o.totalMinor)} badge={<Badge status={o.status} />} />)}
        </section>
        <section className="admin-panel dr-section"><h2>Recent patient activity</h2>
          {!S.patients.length ? <Empty title="No patients">Add your first fictional patient.</Empty> :
            [...S.patients].sort(byDateDesc('createdDate')).slice(0, 5).map((p) => <Row key={p.id} to={`/doctor/patients/${p.id}`} title={p.name} sub={`Added ${fd(p.createdDate)}`} />)}
        </section>
      </div>
    </>
  );
}

export function Patients() {
  const S = useDemo();
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const rows = useMemo(() => S.patients.filter((p) => {
    const t = q.trim().toLowerCase();
    if (t && !`${p.name} ${p.phone} ${p.email}`.toLowerCase().includes(t)) return false;
    const has = S.tests.some((x) => x.patientId === p.id) || S.doses.some((x) => x.patientId === p.id) || S.orders.some((x) => x.patientId === p.id);
    if (f === 'none') return !has;
    if (f === 'overdue') return S.doses.some((x) => x.patientId === p.id && doseStatus(x) === 'Overdue');
    if (f === 'orders') return S.orders.some((x) => x.patientId === p.id && x.status !== 'Delivered');
    return true;
  }), [S, q, f]);
  return (
    <>
      <Head eyebrow="Care" title="Patients" description="Fictional patients assigned to Dr. Mira Sen." actions={<A to="/doctor/patients/new" className="admin-button"><Plus size={15} /> Add patient</A>} />
      <div className="admin-panel">
        <div className="admin-toolbar"><div className="admin-toolbar__fields">
          <div className="admin-search"><Search size={15} aria-hidden="true" /><input aria-label="Search patients" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="admin-filter"><label htmlFor="pf">Show</label><select id="pf" className="admin-select" value={f} onChange={(e) => setF(e.target.value)}>
            <option value="all">All patients</option><option value="none">No records yet</option><option value="overdue">Has overdue dose</option><option value="orders">Has open order</option></select></div>
        </div></div>
        {!rows.length ? <Empty title="No patients match" action={<A to="/doctor/patients/new" className="admin-button">Add patient</A>}>Adjust the search or filter, or add a fictional patient.</Empty> :
          <RecordList rows={rows} total={S.patients.length} label="patients" render={(p) => <Row key={p.id} to={`/doctor/patients/${p.id}`} title={p.name} sub={`Age ${p.age} · ${p.phone || 'No phone'} · ${p.email || 'No email'}`} />} />}
      </div>
    </>
  );
}

export function PatientForm({ go }) {
  const guard = useGuard();
  const [v, setV] = useState({ name: '', age: '', phone: '', email: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [fail, setFail] = useState('');
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  useDirty(Object.values(v).some((x) => x.trim()) && !saved);
  function submit(e) {
    e.preventDefault();
    if (saved) return;
    const n = {};
    if (!v.name.trim()) n.name = 'Enter the patient name (fictional).';
    if (!/^\d{1,3}$/.test(v.age.trim()) || Number(v.age) > 120 || Number(v.age) < 0) n.age = 'Enter a whole age from 0 to 120.';
    if (v.phone.trim() && !/^[0-9+()\-\s]{6,20}$/.test(v.phone.trim())) n.phone = 'Use digits, spaces, + or - only (6 to 20 characters).';
    if (v.email.trim() && !/^[^\s@]+@example\.invalid$/i.test(v.email.trim())) n.email = 'Use a fictional address ending in @example.invalid.';
    setErrors(n); setFail('');
    if (Object.keys(n).length) return;
    try {
      setSaved(true);
      const p = store.addPatient({ name: v.name.trim(), age: Number(v.age), phone: v.phone.trim(), email: v.email.trim(), notes: v.notes.trim() });
      guard.dirtyRef.current = false;
      go(`/doctor/patients/${p.id}`);
    } catch (err) { setSaved(false); setFail(msg(err)); }
  }
  const field = (id, label, extra = {}) => (
    <Field id={`pt-${id}`} label={label} error={errors[id]}>
      <input id={`pt-${id}`} value={v[id]} onChange={set(id)} aria-invalid={Boolean(errors[id])} aria-describedby={describe(`pt-${id}`, errors[id])} autoComplete="off" {...extra} />
    </Field>
  );
  return (
    <>
      <Head eyebrow="Patients / New" title="Add patient" description="Use fictional details only. The patient is assigned to Dr. Mira Sen automatically." />
      <form className="admin-panel dr-formpanel dr-form" onSubmit={submit} noValidate>
        {fail && <Notice tone="error">{fail}</Notice>}
        {field('name', 'Full name')}
        <div className="dr-cols">{field('age', 'Age (years)', { inputMode: 'numeric' })}{field('phone', 'Phone (fictional)', { type: 'tel' })}</div>
        {field('email', 'Email (fictional)', { type: 'email' })}
        <Field id="pt-notes" label="Care notes (optional)" hint="Short, fictional visit note. It appears in the patient history.">
          <textarea id="pt-notes" rows={4} value={v.notes} onChange={set('notes')} aria-describedby="pt-notes-hint" />
        </Field>
        <div className="dr-actions"><A to="/doctor/patients" className="admin-button admin-button--secondary">Cancel</A><button type="submit" className="admin-button" disabled={saved}>Save patient</button></div>
      </form>
    </>
  );
}

export function PatientDetail({ id }) {
  const S = useDemo();
  const fd = useFmt();
  const p = S.patients.find((x) => x.id === id);
  useDirty(false);
  if (!p) return <NotFound what="Patient" back="Back to patients" to="/doctor/patients" />;
  const hist = patientHistory(p.id, S) || [];
  const link = (base) => `${base}?patient=${p.id}`;
  return (
    <>
      <Head eyebrow="Patients / Profile" title={p.name} description={`Age ${p.age} · ${p.phone || 'No phone'} · ${p.email || 'No email'} · Added ${fd(p.createdDate)}`} actions={<>
        <A to={link('/doctor/tests/new')} className="admin-button admin-button--secondary"><FlaskConical size={15} /> Record test</A>
        <A to={link('/doctor/doses/new')} className="admin-button admin-button--secondary"><Pill size={15} /> Schedule dose</A>
        <A to={link('/doctor/orders/new')} className="admin-button admin-button--secondary"><ShoppingCart size={15} /> Place order</A></>} />
      <div className="dr-grid2">
        <section className="admin-panel dr-section"><h2>Care notes</h2><p className="dr-prose">{p.notes || 'No notes recorded.'}</p><p className="dr-fine">Assigned to {store.doctor.name}. Fictional profile.</p></section>
        <section className="admin-panel dr-section"><h2>History</h2>
          {hist.length === 1 && <Notice>No tests, doses or orders yet. Only the initial patient note is recorded; no past treatment was added.</Notice>}
          {!hist.length ? <Empty title="No history yet">Tests, doses and orders for this patient will appear here. Nothing is seeded automatically.</Empty> :
            <ol className="dr-timeline">{hist.map((h) => <li key={h.id}><time>{fd(h.date)}</time><A to={h.href || '#'}><strong>{h.title}</strong></A><span>{h.detail}</span></li>)}</ol>}
        </section>
      </div>
    </>
  );
}

const TYPES = ['Skin prick test (sample)', 'Intradermal test (sample)', 'Serum-specific IgE (sample)'];
const UNITS = ['mm wheal diameter', 'kU/L', 'mm induration'];
export function TestForm({ go }) {
  const S = useDemo();
  const fd = useFmt();
  const guard = useGuard();
  const pre = new URLSearchParams(useSearch()).get('patient') || '';
  const [step, setStep] = useState(0);
  const [v, setV] = useState({ patientId: S.patients.some((p) => p.id === pre) ? pre : '', date: today(), type: TYPES[0], allergen: '', result: '', unit: UNITS[0], positiveControl: '', negativeControl: '' });
  const [errors, setErrors] = useState({});
  const [fail, setFail] = useState('');
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  useDirty((v.allergen || v.result || v.positiveControl || v.negativeControl || v.patientId || v.date !== today() || v.type !== TYPES[0] || v.unit !== UNITS[0]) && !saved);
  function next() {
    const n = {};
    if (step === 0) {
      if (!v.patientId) n.patientId = 'Choose a patient.';
      if (!v.date || v.date > today()) n.date = 'Choose a test date on or before today.';
    } else {
      if (!v.allergen.trim()) n.allergen = 'Enter the allergen name.';
      const valid = (value) => /^\d+(?:\.\d+)?$/.test(value.trim()) && Number.isFinite(Number(value));
      if (!valid(v.result)) n.result = 'Enter a finite sample value of 0 or more.';
      if (!valid(v.positiveControl)) n.positiveControl = 'Enter a non-negative sample control value.';
      if (!valid(v.negativeControl)) n.negativeControl = 'Enter a non-negative sample control value.';
    }
    setErrors(n);
    if (!Object.keys(n).length) setStep(step + 1);
  }
  function save() {
    if (saved) return;
    try {
      setSaved(true);
      const t = store.addTest({ ...v, allergen: v.allergen.trim() });
      guard.dirtyRef.current = false;
      go(`/doctor/tests/${t.id}`);
    } catch (err) { setSaved(false); setFail(msg(err)); }
  }
  return (
    <>
      <Head eyebrow="Allergy Tests / New" title="Record allergy test" description="Illustrative inputs only. No interpretation, recommendation or real test is performed." />
      <Steps steps={['Patient and date', 'Allergen and result', 'Review and save']} current={step} />
      <div className="admin-panel dr-formpanel dr-form">
        {fail && <Notice tone="error">{fail}</Notice>}
        {step === 0 && <>
          <Field id="tf-patient" label="Patient" error={errors.patientId}>
            <SearchableSelect id="tf-patient" label="Patient" value={v.patientId} options={patientOptions(S)} onChange={(x) => setV({ ...v, patientId: x })} placeholder="Choose a patient" invalid={Boolean(errors.patientId)} describedBy={describe('tf-patient', errors.patientId)} viewportMenu />
          </Field>
          <div className="dr-cols">
            <Field id="tf-date" label="Test date" error={errors.date}><input id="tf-date" type="date" max={today()} value={v.date} onChange={set('date')} aria-invalid={Boolean(errors.date)} aria-describedby={describe('tf-date', errors.date)} /></Field>
            <Field id="tf-type" label="Test type"><select id="tf-type" value={v.type} onChange={set('type')}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          </div></>}
        {step === 1 && <>
          <Field id="tf-allergen" label="Allergen" error={errors.allergen}><input id="tf-allergen" value={v.allergen} onChange={set('allergen')} aria-invalid={Boolean(errors.allergen)} aria-describedby={describe('tf-allergen', errors.allergen)} placeholder="Sample allergen name" /></Field>
          <div className="dr-cols">
            <Field id="tf-result" label="Result value" error={errors.result}><input id="tf-result" inputMode="decimal" value={v.result} onChange={set('result')} aria-invalid={Boolean(errors.result)} aria-describedby={describe('tf-result', errors.result)} /></Field>
            <Field id="tf-unit" label="Unit"><select id="tf-unit" value={v.unit} onChange={set('unit')}>{UNITS.map((t) => <option key={t}>{t}</option>)}</select></Field>
          </div>
          <div className="dr-cols">
            <Field id="tf-pos" label={`Positive control (${v.unit})`} error={errors.positiveControl}><input id="tf-pos" inputMode="decimal" value={v.positiveControl} onChange={set('positiveControl')} aria-invalid={Boolean(errors.positiveControl)} aria-describedby={describe('tf-pos', errors.positiveControl)} /></Field>
            <Field id="tf-neg" label={`Negative control (${v.unit})`} error={errors.negativeControl}><input id="tf-neg" inputMode="decimal" value={v.negativeControl} onChange={set('negativeControl')} aria-invalid={Boolean(errors.negativeControl)} aria-describedby={describe('tf-neg', errors.negativeControl)} /></Field>
          </div></>}
        {step === 2 && <dl className="dr-review">
          {[['Patient', pname(S, v.patientId)], ['Date', fd(v.date)], ['Type', v.type], ['Allergen', v.allergen], ['Result', `${v.result} ${v.unit}`], ['Positive control', `${v.positiveControl} ${v.unit}`], ['Negative control', `${v.negativeControl} ${v.unit}`]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}
          <p className="dr-fine">Saving records these sample inputs in this browser tab only.</p></dl>}
        <div className="dr-actions">
          {step === 0 ? <A to="/doctor/tests" className="admin-button admin-button--secondary">Cancel</A> : <button type="button" className="admin-button admin-button--secondary" onClick={() => setStep(step - 1)}>Back</button>}
          {step < 2 ? <button type="button" className="admin-button" onClick={next}>Continue</button> : <button type="button" className="admin-button" onClick={save} disabled={saved}>Save demo test</button>}
        </div>
      </div>
    </>
  );
}

export function Tests() {
  const S = useDemo();
  const fd = useFmt();
  const [q, setQ] = useState('');
  const [pid, setPid] = useState('');
  const rows = S.tests.filter((t) => (!pid || t.patientId === pid) && `${pname(S, t.patientId)} ${t.allergen} ${t.type}`.toLowerCase().includes(q.trim().toLowerCase())).sort(byDateDesc('date'));
  return (
    <>
      <Head eyebrow="Care" title="Allergy Tests" description="Sample test records. Illustrative inputs only, no diagnostic interpretation." actions={<A to="/doctor/tests/new" className="admin-button"><Plus size={15} /> Record allergy test</A>} />
      <div className="admin-panel">
        <div className="admin-toolbar"><div className="admin-toolbar__fields">
          <div className="admin-search"><Search size={15} aria-hidden="true" /><input aria-label="Search tests" placeholder="Search patient or allergen" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="admin-filter"><label htmlFor="tp">Patient</label><select id="tp" className="admin-select" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">All patients</option>{S.patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        </div></div>
        {!rows.length ? <Empty title="No test records" action={<A to="/doctor/tests/new" className="admin-button">Record allergy test</A>}>No saved sample tests match.</Empty> :
          <RecordList rows={rows} label="tests" render={(t) => <Row key={t.id} to={`/doctor/tests/${t.id}`} title={`${pname(S, t.patientId)} · ${t.allergen}`} sub={`${t.type} · ${t.result} ${t.unit}`} meta={fd(t.date)} />} />}
      </div>
    </>
  );
}

export function TestDetail({ id }) {
  const S = useDemo();
  const fd = useFmt();
  useDirty(false);
  const t = S.tests.find((x) => x.id === id);
  if (!t) return <NotFound what="Test record" back="Back to tests" to="/doctor/tests" />;
  return (
    <>
      <Head eyebrow="Allergy Tests / Record" title={`${t.allergen} sample test`} actions={<button type="button" className="admin-button" onClick={() => window.print()}><Printer size={15} /> Print sample report</button>} />
      <article className="dr-sheet dr-sheet--doc dr-printable">
        <PrintPageStyle />
        <p className="dr-sheet__demo">SAMPLE TEST REPORT. Illustrative demo inputs only, not a diagnosis or a real test.</p>
        <h2>{store.doctor.clinic}</h2>
        <dl className="dr-review">
          {[['Patient', <A key="p" to={`/doctor/patients/${t.patientId}`}>{pname(S, t.patientId)}</A>], ['Test date', fd(t.date)], ['Type', t.type], ['Allergen', t.allergen], ['Result', `${t.result} ${t.unit}`], ['Positive control', `${t.positiveControl} ${t.unit}`], ['Negative control', `${t.negativeControl} ${t.unit}`]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}
        </dl>
        <p className="dr-fine">No interpretation or recommendation is given. Recorded by {store.doctor.name} (fictional).</p>
      </article>
    </>
  );
}

export function Doses() {
  const S = useDemo();
  const fd = useFmt();
  const [st, setSt] = useState('');
  const [pid, setPid] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rows = S.doses.filter((d) => (!st || doseStatus(d) === st) && (!pid || d.patientId === pid) && (!from || d.scheduledDate >= from) && (!to || d.scheduledDate <= to)).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  return (
    <>
      <Head eyebrow="Care" title="Dosage & Reminders" description="Manually entered sample doses. Reminders are in-app examples only; nothing is delivered by SMS, email or push, or while the app is closed." actions={<A to="/doctor/doses/new" className="admin-button"><Plus size={15} /> Add scheduled dose</A>} />
      <div className="admin-panel">
        <div className="admin-toolbar"><div className="admin-toolbar__fields">
          <div className="admin-filter"><label htmlFor="ds">Status</label><select id="ds" className="admin-select" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All</option><option>Upcoming</option><option>Overdue</option><option>Completed</option></select></div>
          <div className="admin-filter"><label htmlFor="dp">Patient</label><select id="dp" className="admin-select" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">All patients</option>{S.patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="admin-filter"><label htmlFor="df">From</label><input id="df" type="date" className="admin-select" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="admin-filter"><label htmlFor="dt">To</label><input id="dt" type="date" className="admin-select" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div></div>
        {!rows.length ? <Empty title="No doses match" action={<A to="/doctor/doses/new" className="admin-button">Add scheduled dose</A>}>Change the filters or add a manual sample dose.</Empty> :
          <RecordList rows={rows} label="doses" render={(d) => <Row key={d.id} to={`/doctor/doses/${d.id}`} title={`${pname(S, d.patientId)} · ${d.details}`} sub={d.completedDate ? `Recorded complete ${fd(d.completedDate)}` : d.reminderDate ? `Reminder example ${fd(d.reminderDate)}` : 'No reminder set'} meta={`Scheduled ${fd(d.scheduledDate)}`} badge={<Badge status={doseStatus(d)} />} />} />}
      </div>
    </>
  );
}

export function DoseForm({ go }) {
  const S = useDemo();
  const guard = useGuard();
  const pre = new URLSearchParams(useSearch()).get('patient') || '';
  const [v, setV] = useState({ patientId: S.patients.some((p) => p.id === pre) ? pre : '', scheduledDate: today(), details: '', reminderDate: '' });
  const [errors, setErrors] = useState({});
  const [fail, setFail] = useState('');
  const [saved, setSaved] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  useDirty((v.details.trim() || v.reminderDate || v.patientId || v.scheduledDate !== today()) && !saved);
  function submit(e) {
    e.preventDefault();
    if (saved) return;
    const n = {};
    if (!v.patientId) n.patientId = 'Choose a patient.';
    if (!v.scheduledDate) n.scheduledDate = 'Choose the scheduled date.';
    if (!v.details.trim()) n.details = 'Enter the sample dose details yourself, for example a label and amount with its unit.';
    if (v.reminderDate && v.scheduledDate && v.reminderDate > v.scheduledDate) n.reminderDate = 'Reminder example should be on or before the scheduled date.';
    setErrors(n); setFail('');
    if (Object.keys(n).length) return;
    try {
      setSaved(true);
      const d = store.addDose({ ...v, details: v.details.trim() });
      guard.dirtyRef.current = false;
      go(`/doctor/doses/${d.id}`);
    } catch (err) { setSaved(false); setFail(msg(err)); }
  }
  return (
    <>
      <Head eyebrow="Dosage & Reminders / New" title="Add scheduled dose" description="Enter sample details manually. Nothing is calculated or inferred from orders." />
      <form className="admin-panel dr-formpanel dr-form" onSubmit={submit} noValidate>
        {fail && <Notice tone="error">{fail}</Notice>}
        <Field id="df-patient" label="Patient" error={errors.patientId}><SearchableSelect id="df-patient" label="Patient" value={v.patientId} options={patientOptions(S)} onChange={(x) => setV({ ...v, patientId: x })} placeholder="Choose a patient" invalid={Boolean(errors.patientId)} describedBy={describe('df-patient', errors.patientId)} viewportMenu /></Field>
        <div className="dr-cols">
          <Field id="df-date" label="Scheduled date" error={errors.scheduledDate}><input id="df-date" type="date" value={v.scheduledDate} onChange={set('scheduledDate')} /></Field>
          <Field id="df-rem" label="Reminder example date (optional)" error={errors.reminderDate}><input id="df-rem" type="date" value={v.reminderDate} onChange={set('reminderDate')} aria-describedby={describe('df-rem', errors.reminderDate)} /></Field>
        </div>
        <Field id="df-details" label="Sample dose details" error={errors.details}><textarea id="df-details" rows={3} value={v.details} onChange={set('details')} aria-invalid={Boolean(errors.details)} aria-describedby={describe('df-details', errors.details)} /></Field>
        <div className="dr-actions"><A to="/doctor/doses" className="admin-button admin-button--secondary">Cancel</A><button type="submit" className="admin-button" disabled={saved}>Save scheduled dose</button></div>
      </form>
    </>
  );
}

export function DoseDetail({ id }) {
  const S = useDemo();
  const fd = useFmt();
  const d = S.doses.find((x) => x.id === id);
  const [cdate, setCdate] = useState(today());
  const [rdate, setRdate] = useState('');
  const [fail, setFail] = useState('');
  const [ok, setOk] = useState('');
  useDirty(!d?.completedDate && Boolean(rdate || cdate !== today()));
  if (!d) return <NotFound what="Dose" back="Back to doses" to="/doctor/doses" />;
  const status = doseStatus(d);
  const run = (fn, okText) => { try { fn(); setFail(''); setOk(okText); setRdate(''); setCdate(today()); } catch (e) { setOk(''); setFail(msg(e)); } };
  return (
    <>
      <Head eyebrow="Dosage & Reminders / Dose" title={`${pname(S, d.patientId)} · scheduled ${fd(d.scheduledDate)}`} actions={<Badge status={status} />} />
      {fail && <Notice tone="error">{fail}</Notice>}
      {ok && <Notice>{ok}</Notice>}
      <div className="dr-grid2">
        <section className="admin-panel dr-section"><h2>Details</h2>
          <dl className="dr-review">
            <div><dt>Patient</dt><dd><A to={`/doctor/patients/${d.patientId}`}>{pname(S, d.patientId)}</A></dd></div>
            <div><dt>Sample dose details</dt><dd>{d.details}</dd></div>
            <div><dt>Originally scheduled</dt><dd>{fd(d.scheduledDate)}</dd></div>
            <div><dt>Recorded demo completion</dt><dd>{d.completedDate ? fd(d.completedDate) : 'Not recorded'}</dd></div>
            <div><dt>Reminder example</dt><dd>{d.reminderDate ? fd(d.reminderDate) : 'None set'}</dd></div>
          </dl>
          <p className="dr-fine">Reminders are visible in-app examples only. Nothing will be sent or delivered.</p>
        </section>
        <section className="admin-panel dr-section dr-form"><h2>Actions</h2>
          {!d.completedDate && <>
            <Field id="dd-c" label="Completion date to record"><input id="dd-c" type="date" value={cdate} onChange={(e) => setCdate(e.target.value)} /></Field>
            <button type="button" className="admin-button" onClick={() => run(() => store.completeDose(d.id, cdate), 'Demo dose marked completed. The scheduled date is preserved.')}>Mark demo dose completed</button></>}
          {!d.completedDate && <>
            <Field id="dd-r" label="Reminder example date"><input id="dd-r" type="date" value={rdate} onChange={(e) => setRdate(e.target.value)} /></Field>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => run(() => store.setReminder(d.id, rdate), 'Reminder example saved in-app only.')}>Set or reschedule reminder</button></>}
          {d.completedDate && <p>This dose is recorded as completed (demo). No further actions.</p>}
        </section>
      </div>
    </>
  );
}
export { ClipboardList };
