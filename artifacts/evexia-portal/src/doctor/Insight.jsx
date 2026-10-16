import { useMemo, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import * as store from './doctorStore.js';
import { pname } from './Care.jsx';
import { Badge, Empty, Field, Head, Notice, Stars, PrintPageStyle, describe, msg, uid, useDemo, useDirty, useFmt, useGuard } from './ui.jsx';

const KINDS = [['patients', 'Patient history'], ['tests', 'Allergy tests'], ['doses', 'Dosage and adherence'], ['orders', 'Orders'], ['payments', 'Payments']];

export function Reports() {
  const S = useDemo();
  const fd = useFmt();
  const [kind, setKind] = useState('patients');
  const [patientId, setPatientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  useDirty(false);
  const report = useMemo(() => {
    try { return { rows: store.reportRows(kind, S, { patientId, from, to }), error: '' }; }
    catch (error) { return { rows: [], error: msg(error) }; }
  }, [kind, S, patientId, from, to]);
  const all = report.rows;
  const statuses = [...new Set(all.map((r) => r.status).filter(Boolean))];
  const selectedStatus = statuses.includes(status) ? status : '';
  const rows = selectedStatus ? all.filter((r) => r.status === selectedStatus) : all;
  const label = KINDS.find((k) => k[0] === kind)[1];
  return (
    <>
      <Head eyebrow="Insight" title="Reports" description="Print previews built from the current demo records. Use the browser Print or Save as PDF." actions={<button type="button" className="admin-button" onClick={() => window.print()}><Printer size={15} /> Print report</button>} />
      <div className="admin-panel dr-noprint">
        <div className="admin-toolbar"><div className="admin-toolbar__fields">
          <div className="admin-filter"><label htmlFor="rk">Report</label><select id="rk" className="admin-select" value={kind} onChange={(e) => { setKind(e.target.value); setStatus(''); }}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="admin-filter"><label htmlFor="rp">Patient</label><select id="rp" className="admin-select" value={patientId} onChange={(e) => setPatientId(e.target.value)}><option value="">All patients</option>{S.patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="admin-filter"><label htmlFor="rf">From</label><input id="rf" type="date" className="admin-select" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="admin-filter"><label htmlFor="rt">To</label><input id="rt" type="date" className="admin-select" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="admin-filter"><label htmlFor="rs">Status</label><select id="rs" className="admin-select" value={selectedStatus} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select></div>
        </div></div>
      </div>
      {report.error && <Notice tone="error">{report.error}</Notice>}
      <article className="dr-sheet dr-sheet--doc dr-printable" aria-label={`${label} report preview`}>
        <PrintPageStyle />
        <p className="dr-sheet__demo">SAMPLE REPORT. Fictional demo records, not a clinical or legal document.</p>
        <h2>{label} summary</h2>
        <p className="dr-fine">{store.doctor.name}, {store.doctor.clinic}. {rows.length} record{rows.length === 1 ? '' : 's'}.
          {kind === 'doses' && ' Completed means a demo completion was recorded manually; scheduled and overdue doses are not evidence of administration.'}</p>
        <p className="dr-fine">Patient: {patientId ? pname(S, patientId) : 'All fictional patients'} · Period: {from ? fd(from) : 'Any start date'} to {to ? fd(to) : 'Any end date'} · Status: {selectedStatus || 'All'}</p>
        {!rows.length ? <Empty title="No records for these filters">Change the filters to see matching demo records.</Empty> :
          <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Report table, scrolls sideways if needed">
            <table className="admin-table dr-table"><thead><tr><th>Date</th><th>Patient</th><th>Record</th><th>Detail</th><th>Status</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={`${r.id}`}><td>{fd(r.date)}</td><td>{pname(S, r.patientId)}</td><td>{r.title}</td><td>{r.detail}{kind === 'doses' && <><br />Originally scheduled {fd(r.date)} · {r.completedDate ? `Recorded demo completion ${fd(r.completedDate)}` : 'No completion recorded'} · In-app reminder {r.reminderDate ? fd(r.reminderDate) : 'not set'}</>}</td><td>{r.status ? <Badge status={r.status} /> : '-'}</td></tr>)}</tbody></table></div>}
      </article>
    </>
  );
}

export function Feedback() {
  const [tab, setTab] = useState('reviews');
  const guard = useGuard();
  const changeTab = (value) => guard.run(() => setTab(value));
  return (
    <>
      <Head eyebrow="Insight" title="Feedback" description="Two separate areas: sample patient reviews of the clinic, and your feedback about this portal." />
      <div className="dr-tabs dr-noprint" role="tablist" aria-label="Feedback areas">
        {[['reviews', 'Clinic Reviews'], ['system', 'System Feedback']].map(([k, l]) => <button key={k} role="tab" type="button" id={`tab-${k}`} aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} aria-controls={`panel-${k}`} className={tab === k ? 'is-active' : ''} onClick={() => changeTab(k)} onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 'reviews' : event.key === 'End' ? 'system' : tab === 'reviews' ? 'system' : 'reviews';
            changeTab(next); requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
          }
        }}>{l}</button>)}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>{tab === 'reviews' ? <Reviews /> : <SystemFeedback />}</div>
    </>
  );
}

function Reviews() {
  const fd = useFmt();
  const [sel, setSel] = useState(() => new Set(store.reviews.map((r) => r.id)));
  const chosen = store.reviews.filter((r) => sel.has(r.id));
  const avg = store.reviewAverage(chosen);
  const toggle = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  return (
    <>
      <section className="admin-panel dr-section dr-noprint">
        <h2>Fictional patient reviews</h2>
        <p className="dr-fine">All reviews are samples. Select which to include on the printable clinic sheet.</p>
        <p><strong>Displayed average:</strong> <Stars value={store.reviewAverage()} /> across all {store.reviews.length} samples</p>
        <div className="dr-rows">{store.reviews.map((r) => (
          <label key={r.id} className="dr-row dr-row--check"><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
            <span className="dr-row__main"><strong>{r.name} <Stars value={r.rating} label={false} /></strong><small>{r.text}</small></span><small>{fd(r.date)}</small></label>))}</div>
        <div className="dr-actions"><button type="button" className="admin-button" disabled={!chosen.length} onClick={() => window.print()}><Printer size={15} /> Print clinic sheet</button></div>
      </section>
      <article className="dr-sheet dr-sheet--a4 dr-printable" aria-label="Clinic review sheet preview">
        <PrintPageStyle />
        <p className="dr-sheet__demo">SAMPLE REVIEWS. Fictional, not verified, and not permission to publish.</p>
        <h2>{store.doctor.name}</h2>
        <p className="dr-sheet__clinic">{store.doctor.clinic} · {store.doctor.specialty}</p>
        {chosen.length ? <>
          <p className="dr-sheet__avg"><Stars value={avg} /> <span>average of {chosen.length} sample review{chosen.length === 1 ? '' : 's'}</span></p>
          {chosen.map((r) => <blockquote key={r.id}><Stars value={r.rating} label={false} /><p>{r.text}</p><cite>{r.name}, {fd(r.date)}</cite></blockquote>)}</> :
          <p className="dr-fine">Select at least one sample review to preview the sheet.</p>}
      </article>
    </>
  );
}

function SystemFeedback() {
  const [v, setV] = useState({ category: '', rating: '', message: '' });
  const [errors, setErrors] = useState({});
  const [fail, setFail] = useState('');
  const [done, setDone] = useState(false);
  const req = useRef(uid());
  void req;
  useDirty((v.message.trim() || v.category || v.rating) && !done);
  function submit(e) {
    e.preventDefault();
    if (done) return;
    const n = {};
    if (!v.category) n.category = 'Choose a category.';
    if (!v.message.trim()) n.message = 'Write a short message.';
    setErrors(n); setFail('');
    if (Object.keys(n).length) return;
    try { store.addFeedback({ category: v.category, rating: v.rating ? Number(v.rating) : undefined, message: v.message.trim() }); setDone(true); }
    catch (err) { setFail(msg(err)); }
  }
  if (done) return <div className="dr-ack" role="status"><strong>Saved locally in this demo</strong><p>Your feedback was not sent to support or anyone else, and is cleared when the demo resets.</p>
    <button type="button" className="admin-button admin-button--secondary" onClick={() => { setV({ category: '', rating: '', message: '' }); setDone(false); }}>Write another</button></div>;
  return (
    <form className="admin-panel dr-formpanel dr-form" onSubmit={submit} noValidate>
      <Notice>This form is about the portal. It is stored in this tab only and is not sent to support.</Notice>
      {fail && <Notice tone="error">{fail}</Notice>}
      <Field id="sf-cat" label="Category" error={errors.category}><select id="sf-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} aria-invalid={Boolean(errors.category)} aria-describedby={describe('sf-cat', errors.category)}><option value="">Choose...</option>{['Suggestion', 'Issue', 'Experience', 'Other'].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field id="sf-rate" label="Rating (optional)"><select id="sf-rate" value={v.rating} onChange={(e) => setV({ ...v, rating: e.target.value })}><option value="">No rating</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} out of 5</option>)}</select></Field>
      <Field id="sf-msg" label="Message" error={errors.message}><textarea id="sf-msg" rows={5} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} aria-invalid={Boolean(errors.message)} aria-describedby={describe('sf-msg', errors.message)} /></Field>
      <div className="dr-actions"><button type="submit" className="admin-button">Save feedback locally</button></div>
    </form>
  );
}
