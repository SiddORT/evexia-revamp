import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import AdminLayout, { useOrderBase, useOrderPortal, useOrderActions } from '../../components/orders/OrderPortalContext.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import SptReferenceSelect from '../../components/admin/SptReferenceSelect.jsx';
import { request, GENDERS, money, totalMinor, validateOrder, orderInput } from '../../services/serverSpt.js';
import useOrderDraftNavigation from '../../components/orders/useOrderDraftNavigation.jsx';
import '../../sptOrders.css';
import '../../orderEntry.css';
import OrderApproval from '../../components/orders/OrderApproval.jsx';

function Shell({ children, entry = false }) {
  return <AdminLayout title="SPT"><div className={`spt spt-form${entry ? ' order-entry spt-entry' : ''}`}>{children}</div></AdminLayout>;
}

function OrderForm({ order, mode }) {
  const can = useOrderActions('spt');
  const BASE = useOrderBase('spt');
  const { portal, mr } = useOrderPortal();
  const mrPortal = portal === 'mr';
  const [record, setRecord] = useState(order);
  const readOnly = record ? mode !== 'edit' || !record.mrEditable || !can.edit : !can.add;
  const [doctorId, setDoctorId] = useState(order?.doctorId || '');
  const [mrId, setMrId] = useState(order?.mrId || mr?.id || '');
  const [patients, setPatients] = useState(() => order ? order.patients.map((p) => ({ ...p })) : []);
  const [remarks, setRemarks] = useState(order?.remarks || '');
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState('');
  const [registering, setRegistering] = useState(false);
  const [reg, setReg] = useState({ name: '', gender: '', age: '' });
  const [regErrors, setRegErrors] = useState({});
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState('');
  const submission = useRef(null), sending = useRef(false);
  const outcomeUnknown = useRef(false);
  const registerBtn = useRef(null);
  const regName = useRef(null);
  const summaryRef = useRef(null);

  const [preview, setPreview] = useState(null);
  const [registered, setRegistered] = useState([]);
  const total = totalMinor(patients);
  const values = { doctorId, mrId, patients, remarks };
  const initialDraft = useRef(JSON.stringify(values));
  const leaveDialog = useOrderDraftNavigation({
    dirty: !readOnly && initialDraft.current !== JSON.stringify(values),
    pending: busy || uncertain,
    onBlocked: () => setErrors({ form: 'Submission outcome is not yet confirmed. Keep this page open and retry the unchanged submission.' }),
  });

  function add() {
    if (!preview || patients.some((p) => p.id === preview.id) || patients.length >= 200) return;
    setPatients((list) => [...list, { ...preview, amount: '' }]);
    setPending(''); setPreview(null);
    setErrors((e) => ({ ...e, patients: undefined }));
  }
  const remove = (pid) => {
    setPatients((list) => list.filter((p) => p.id !== pid));
    setErrors((e) => ({ ...e, [`amount-${pid}`]: undefined }));
  };
  const setAmount = (pid, amount) => {
    setPatients((list) => list.map((p) => p.id === pid ? { ...p, amount } : p));
    setErrors((e) => ({ ...e, [`amount-${pid}`]: undefined }));
  };

  function openRegister() { setRegistering(true); setRegErrors({}); setTimeout(() => regName.current?.focus(), 0); }
  function closeRegister() { setRegistering(false); setReg({ name: '', gender: '', age: '' }); setRegErrors({}); setTimeout(() => registerBtn.current?.focus(), 0); }
  async function sendPending() {
    if (sending.current || !submission.current) return;
    sending.current = true; setBusy(true); setSuccess(''); setErrors({});
    const current = submission.current;
    try {
      const result = await request(current.path, { body: current.body });
      submission.current = null; outcomeUnknown.current = false; setUncertain(false);
      if (current.kind === 'registration') {
        setRegistered((list) => [result, ...list]);
        setPending(result.id); setPreview(result); closeRegister();
        setSuccess(`${result.code} registered for SPT. Select Add patient to include this patient in the order. No Patient Master or login account was created.`);
      } else {
        initialDraft.current = JSON.stringify({ doctorId: result.doctorId || '', mrId: result.mrId || '', patients: result.patients, remarks: result.remarks });
        setRecord(result); setPatients(result.patients);
        setSuccess(`${result.number} ${result.status === 'Draft' ? 'saved as Draft' : 'saved'}. Total INR ${result.total}.`);
      }
    } catch (error) {
      // A pre-send/session failure on a retry cannot prove what happened to
      // the earlier uncertain write. Retain its key until a confirmed response.
      outcomeUnknown.current = outcomeUnknown.current || Boolean(error.ambiguous);
      setUncertain(outcomeUnknown.current);
      if (!outcomeUnknown.current) submission.current = null;
      setErrors({ form: `${error.message}${outcomeUnknown.current ? ' Do not enter a new submission. Retry the unchanged submission below.' : ''}` });
      setTimeout(() => summaryRef.current?.focus(), 0);
    } finally { sending.current = false; setBusy(false); }
  }
  function submitRegister(event) {
    event.preventDefault();
    if (sending.current || submission.current) return;
    const errs = {};
    if (!reg.name.trim() || reg.name.trim().length > 100) errs.name = 'Enter a name of 1–100 characters.';
    if (!GENDERS.includes(reg.gender)) errs.gender = 'Choose a gender.';
    if (!/^\d{1,3}$/.test(reg.age) || Number(reg.age) > 120) errs.age = 'Enter a whole age from 0 to 120.';
    if (Object.keys(errs).length) {
      setRegErrors(errs);
      document.getElementById(`spt-reg-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    submission.current = { kind: 'registration', path: '/patients',
      body: { name: reg.name.trim(), gender: reg.gender, age: Number(reg.age), idempotencyKey: crypto.randomUUID() } };
    void sendPending();
  }

  function save(status) {
    if (sending.current || submission.current || readOnly) return;
    const errs = validateOrder(values, status);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    submission.current = { kind: 'order', path: record?.id ? `/${record.id}/edit` : '',
      body: { ...orderInput(values, status), expected_version: record?.version ?? null, idempotencyKey: crypto.randomUUID() } };
    void sendPending();
  }

  const errorList = Object.entries(errors).filter(([, m]) => m);
  const labelFor = (key) => key === 'form' ? 'Submission' : key === 'doctorId' ? 'Doctor' : key === 'mrId' ? 'MR' : key === 'patients' ? 'Patients'
    : mr ? `Amount for ${patients.find((p) => key === `amount-${p.id}`)?.name || 'selected patient'}` : `Amount for ${key.replace('amount-', '')}`;
  const focusField = (key) => document.getElementById(key === 'doctorId' ? 'spt-doctor' : key === 'mrId' ? 'spt-mr' : key === 'patients' ? 'spt-patient' : `spt-${key}`)?.focus();

  const columns = [
    { key: 'id', label: 'Patient ID', render: (p) => <>{p.code}<span className="spt-patient-source">{p.source === 'spt' ? 'SPT registration' : 'Patient Master'}</span></> },
    { key: 'name', label: 'Name', render: (p) => <strong>{p.name}</strong> },
    { key: 'gender', label: 'Gender', render: (p) => p.gender },
    { key: 'age', label: 'Age', render: (p) => p.age },
    { key: 'amount', label: 'Amount (INR)', render: (p) => readOnly ? <span className="spt-num">{money(totalMinor([p]))}</span> : <>
      <input id={`spt-amount-${p.id}`} className="spt-input spt-amount" inputMode="decimal" aria-label={`Amount for ${p.name}`} value={p.amount} onChange={(e) => setAmount(p.id, e.target.value)} aria-invalid={Boolean(errors[`amount-${p.id}`])} aria-describedby={errors[`amount-${p.id}`] ? `spt-err-${p.id}` : undefined} placeholder="0.00" data-testid={`input-spt-amount-${p.id}`} />
      {errors[`amount-${p.id}`] && <p className="spt-error" id={`spt-err-${p.id}`}>{errors[`amount-${p.id}`]}</p>}</> },
    { key: 'remove', label: 'Remove', render: (p) => readOnly ? '' : <button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)} data-testid={`button-spt-remove-${p.id}`}><Trash2 size={16} aria-hidden="true" /></button> },
  ];

  return (
    <Shell entry={!readOnly}>
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Orders / SPT</p>
          <h1>{readOnly ? `View ${record.number}` : record ? `Edit ${record.number}` : 'Add Order'}</h1>
          <p className="admin-page-head__description">{readOnly ? 'Saved order details.' : mr ? 'Your MR is fixed. Choose Doctor and patients, then enter amounts.' : 'Choose Doctor, MR and patients, then enter amounts.'}</p>
        </div>
        <Link href={BASE} className="admin-button admin-button--secondary" data-testid="link-spt-back"><ArrowLeft size={16} aria-hidden="true" />All orders</Link>
      </div>
      {success && <p className="spt-notice" role="status">{success}</p>}
      {record && readOnly && <>{can.edit && record.mrEditable && <Link href={`${BASE}/${record.id}/edit`} className="admin-button">{record.status === 'Draft' ? 'Resume draft' : 'Edit order'}</Link>}
        <OrderApproval kind="spt" order={record} request={request} onApproved={setRecord} /></>}
      {busy && <p role="status">Saving on the server… Keep this page open.</p>}
      {errorList.length > 0 && <div className="spt-summary" role="alert" tabIndex={-1} ref={summaryRef} data-testid="status-spt-errors">
        <strong>Please fix the following before saving:</strong>
        <ul>{errorList.map(([key, msg]) => <li key={key}><button type="button" onClick={() => focusField(key)}>{labelFor(key)}</button>: {msg}</li>)}</ul>
      </div>}
      {uncertain && <button type="button" className="admin-button" disabled={busy} onClick={sendPending}>Retry unchanged submission</button>}
      <fieldset className="spt-editor" disabled={busy || uncertain}>
      <section className="spt-card" aria-labelledby="spt-h-details">
        <h2 id="spt-h-details">Order details</h2>
        <div className="spt-grid">
          <div className={`spt-field${errors.doctorId ? ' spt-field--error' : ''}`}>
            {readOnly ? <div className="spt-readonly"><strong>Doctor</strong><p>{record.doctorName || 'Not selected'}</p><p>{[record.doctor?.phone, record.doctor?.email].filter(Boolean).join(' · ')}</p></div> : <SptReferenceSelect disabled={busy || uncertain} id="spt-doctor" kind="doctors" label="Doctor" value={doctorId} saved={[record?.doctor]} onChange={(v) => { setDoctorId(v); setErrors((e) => ({ ...e, doctorId: undefined })); }} invalid={Boolean(errors.doctorId)} describedBy={errors.doctorId ? 'spt-err-doctor' : undefined} />}
            {errors.doctorId && <p className="spt-error" id="spt-err-doctor">{errors.doctorId}</p>}
          </div>
          <div className={`spt-field${errors.mrId ? ' spt-field--error' : ''}`}>
            {readOnly || mr ? <div className="spt-readonly"><strong>MR</strong><p>{readOnly ? record.mrName || 'Not selected' : mr.name}</p><p>{readOnly ? [record.mr?.phone, record.mr?.email].filter(Boolean).join(' · ') : 'Your verified saved MR identity. Assignment cannot be changed.'}</p></div> : <SptReferenceSelect disabled={busy || uncertain} id="spt-mr" kind="mrs" label="MR" value={mrId} saved={[record?.mr]} onChange={(v) => { setMrId(v); setErrors((e) => ({ ...e, mrId: undefined })); }} invalid={Boolean(errors.mrId)} describedBy={errors.mrId ? 'spt-err-mr' : undefined} />}
            {errors.mrId && <p className="spt-error" id="spt-err-mr">{errors.mrId}</p>}
          </div>
        </div>
      </section>

      <section className="spt-card" aria-labelledby="spt-h-patients">
        <h2 id="spt-h-patients">Patients</h2>
        {!readOnly && <>
          <p className="spt-card__sub">Search by patient ID or name, check the details, then add.</p>
          <div className={`spt-picker${errors.patients ? ' spt-field--error' : ''}`}>
            <SptReferenceSelect disabled={busy || uncertain} id="spt-patient" kind="patients" label="Find patient" value={pending} saved={registered}
              exclude={patients.map((p) => p.id)} onChange={setPending} onPerson={setPreview}
              invalid={Boolean(errors.patients)} describedBy={errors.patients ? 'spt-err-patients' : undefined} />
            <div className="spt-picker__actions">
              <button type="button" className="admin-button" onClick={add} disabled={!preview || patients.length >= 200} data-testid="button-spt-add-patient">Add patient</button>
              {!mrPortal && <button type="button" ref={registerBtn} className="admin-button admin-button--secondary" onClick={openRegister} aria-expanded={registering} data-testid="button-spt-register"><UserPlus size={16} aria-hidden="true" />Register Patient</button>}
            </div>
          </div>
          {errors.patients && <p className="spt-error" id="spt-err-patients">{errors.patients}</p>}
          {preview && <dl className="spt-preview" data-testid="preview-spt-patient">
            <div><dt>ID</dt><dd>{preview.code} · {preview.source === 'spt' ? 'SPT' : 'Patient Master'}</dd></div><div><dt>Name</dt><dd>{preview.name}</dd></div>
            <div><dt>Gender</dt><dd>{preview.gender}</dd></div><div><dt>Age</dt><dd>{preview.age}</dd></div>
          </dl>}
          {!mrPortal && registering && <form className="spt-register" onSubmit={submitRegister} aria-labelledby="spt-h-reg" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRegister(); } }} data-testid="form-spt-register">
            <h3 id="spt-h-reg">Register SPT patient</h3>
            {Object.keys(regErrors).length > 0 && <p role="alert" className="spt-error">Check the highlighted patient fields.</p>}
            <p className="spt-card__sub" style={{ margin: 0 }}>Saved for future SPT orders only. This does not create a Patient Master record or login account.</p>
            <div className="spt-grid spt-register__fields">
              <div className="spt-field"><label htmlFor="spt-reg-name">Patient name</label>
                <input id="spt-reg-name" maxLength={100} ref={regName} className="spt-input" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} aria-invalid={Boolean(regErrors.name)} aria-describedby={regErrors.name ? 'spt-reg-name-err' : undefined} />
                {regErrors.name && <p className="spt-error" id="spt-reg-name-err">{regErrors.name}</p>}</div>
              <div className="spt-field"><label htmlFor="spt-reg-gender">Gender</label>
                <select id="spt-reg-gender" value={reg.gender} onChange={(e) => setReg({ ...reg, gender: e.target.value })} aria-invalid={Boolean(regErrors.gender)} aria-describedby={regErrors.gender ? 'spt-reg-gender-err' : undefined}>
                  <option value="">Select gender</option>{GENDERS.map((g) => <option key={g}>{g}</option>)}</select>
                {regErrors.gender && <p className="spt-error" id="spt-reg-gender-err">{regErrors.gender}</p>}</div>
              <div className="spt-field"><label htmlFor="spt-reg-age">Age</label>
                <input id="spt-reg-age" className="spt-input" inputMode="numeric" value={reg.age} onChange={(e) => setReg({ ...reg, age: e.target.value })} aria-invalid={Boolean(regErrors.age)} aria-describedby={regErrors.age ? 'spt-reg-age-err' : undefined} />
                {regErrors.age && <p className="spt-error" id="spt-reg-age-err">{regErrors.age}</p>}</div>
            </div>
            <div className="spt-actions">
              <button type="button" className="admin-button admin-button--secondary" onClick={closeRegister} data-testid="button-spt-register-cancel">Cancel registration</button>
              <button type="submit" className="admin-button" data-testid="button-spt-register-submit">Register patient</button>
            </div>
          </form>}
        </>}
        {patients.length > 0 && <p className="spt-scroll-hint">Scroll horizontally to see all patient columns. Keyboard: focus the table region and use arrow keys.</p>}
        <div className="spt-patient-table">
        <DataTable columns={columns} rows={patients} rowKey={(p) => p.id} label="Selected patients (scrolls horizontally)" testIdPrefix="spt-patient"
          empty={<div className="spt-empty"><strong>No patients added</strong><p>{readOnly ? 'This order has no patients.' : mrPortal ? 'Select an existing patient above.' : 'Select an existing patient above, or register an SPT patient.'}</p></div>} />
        </div>
        {patients.length > 0 && <div className="spt-total">
          <span>{readOnly ? 'Saved total' : 'Entry total'}</span><span className="spt-num" aria-live="polite" data-testid="text-spt-total">{readOnly ? `INR ${record.total}` : money(total)}</span></div>}
      </section>

      <section className="spt-card" aria-labelledby="spt-h-remarks">
        <h2 id="spt-h-remarks">Remarks</h2>
        <div className="spt-field"><label htmlFor="spt-remarks" className="sr-only">Remarks</label>
          <textarea id="spt-remarks" maxLength={4000} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={readOnly} placeholder={readOnly ? 'No remarks' : 'Optional order remarks'} data-testid="input-spt-remarks" /></div>
      </section>
      </fieldset>
        <div className="spt-actions">
          {readOnly ? <Link href={BASE} className="admin-button">All orders</Link> : <>
            {record?.status !== 'Saved' && <button type="button" disabled={busy || uncertain} className="admin-button admin-button--secondary" onClick={() => save('Draft')} data-testid="button-spt-save-draft">Save as Draft</button>}
            <button type="button" disabled={busy || uncertain} className="admin-button" onClick={() => save('Saved')} data-testid="button-spt-save">Save</button></>}
        </div>
      {leaveDialog}
    </Shell>
  );
}

export default function SptOrderFormPage({ id, mode = 'view' }) {
  const BASE = useOrderBase('spt');
  const [order, setOrder] = useState(null), [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!id) return undefined;
    const controller = new AbortController();
    setLoading(true); setError('');
    request(`/${id}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setOrder(data); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, revision]);
  if (loading) return <Shell><div className="spt-card" role="status">Loading SPT order…</div></Shell>;
  if (id && (error || !order)) {
    return <Shell>
      <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / SPT</p><h1>Order unavailable</h1></div></div>
      <div className="spt-card" role="alert" data-testid="status-spt-missing">
        <p style={{ margin: 0, lineHeight: 1.5 }}>{error || 'This order was not found on the server. Check the link or return to all orders.'}</p>
        <div className="spt-actions"><button type="button" className="admin-button" onClick={() => setRevision((n) => n + 1)}>Retry</button><Link href={BASE} className="admin-button">All orders</Link></div>
      </div>
    </Shell>;
  }
  return <OrderForm key={`${id || 'new'}-${mode}`} order={order} mode={mode} />;
}
