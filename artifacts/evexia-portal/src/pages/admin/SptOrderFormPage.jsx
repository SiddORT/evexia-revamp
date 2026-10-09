import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Trash2, UserPlus } from 'lucide-react';
import AdminLayout from '../../components/admin/AdminLayout.jsx';
import DataTable from '../../components/admin/DataTable.jsx';
import SearchableSelect from '../../components/admin/SearchableSelect.jsx';
import { DOCTORS, MRS, demoStore, money, totalMinor, validateOrder } from '../../services/sptOrdersDemo.js';
import '../../sptOrders.css';

const BASE = '/admin/orders/spt';
const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const toOptions = (list) => list.map((x) => ({ value: x.id, label: x.name }));
const DOCTOR_OPTIONS = toOptions(DOCTORS);
const MR_OPTIONS = toOptions(MRS);

function Shell({ children }) {
  return <AdminLayout title="SPT"><div className="spt">{children}</div></AdminLayout>;
}

function OrderForm({ order, id }) {
  const [, navigate] = useLocation();
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const readOnly = order?.status === 'Saved';
  const [doctorId, setDoctorId] = useState(order?.doctorId || '');
  const [mrId, setMrId] = useState(order?.mrId || '');
  const [patients, setPatients] = useState(() => order ? order.patients.map((p) => ({ ...p })) : []);
  const [remarks, setRemarks] = useState(order?.remarks || '');
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState('');
  const [registering, setRegistering] = useState(false);
  const [reg, setReg] = useState({ name: '', gender: '', age: '' });
  const [regErrors, setRegErrors] = useState({});
  const registerBtn = useRef(null);
  const regName = useRef(null);
  const summaryRef = useRef(null);

  const options = useMemo(() => snap.patients.filter((p) => !patients.some((x) => x.id === p.id))
    .map((p) => ({ value: p.id, label: `${p.id} - ${p.name}` })), [snap.patients, patients]);
  const preview = snap.patients.find((p) => p.id === pending);
  const total = totalMinor(patients);
  const values = { doctorId, mrId, patients, remarks };

  function add() {
    if (!preview || patients.some((p) => p.id === preview.id)) return;
    setPatients((list) => [...list, { id: preview.id, name: preview.name, gender: preview.gender, age: preview.age, amount: '' }]);
    setPending('');
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
  function submitRegister(event) {
    event.preventDefault();
    const { patient, errors: errs } = demoStore.registerPatient({ name: reg.name.trim(), gender: reg.gender, age: reg.age });
    if (errs && Object.keys(errs).length) {
      setRegErrors(errs);
      document.getElementById(`spt-reg-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    setPending(patient.id);
    closeRegister();
  }

  function save(status) {
    const errs = status === 'Saved' ? validateOrder(values) : {};
    if (Object.keys(errs).length) {
      setErrors(errs);
      setTimeout(() => summaryRef.current?.focus(), 0);
      return;
    }
    const result = demoStore.saveOrder(values, status, id);
    if (result.errors && Object.keys(result.errors).length) { setErrors(result.errors); setTimeout(() => summaryRef.current?.focus(), 0); return; }
    navigate(BASE);
  }

  const errorList = Object.entries(errors).filter(([, m]) => m);
  const labelFor = (key) => key === 'doctorId' ? 'Doctor' : key === 'mrId' ? 'MR' : key === 'patients' ? 'Patients' : `Amount for ${key.replace('amount-', '')}`;
  const focusField = (key) => document.getElementById(key === 'doctorId' ? 'spt-doctor' : key === 'mrId' ? 'spt-mr' : key === 'patients' ? 'spt-patient' : `spt-${key}`)?.focus();

  const columns = [
    { key: 'id', label: 'Patient ID', render: (p) => p.id },
    { key: 'name', label: 'Name', render: (p) => <strong>{p.name}</strong> },
    { key: 'gender', label: 'Gender', render: (p) => p.gender },
    { key: 'age', label: 'Age', render: (p) => p.age },
    { key: 'amount', label: 'Amount (INR)', render: (p) => readOnly ? <span className="spt-num">{money(totalMinor([p]))}</span> : <>
      <input id={`spt-amount-${p.id}`} className="spt-input spt-amount" inputMode="decimal" aria-label={`Amount for ${p.name}`} value={p.amount} onChange={(e) => setAmount(p.id, e.target.value)} aria-invalid={Boolean(errors[`amount-${p.id}`])} aria-describedby={errors[`amount-${p.id}`] ? `spt-err-${p.id}` : undefined} placeholder="0.00" data-testid={`input-spt-amount-${p.id}`} />
      {errors[`amount-${p.id}`] && <p className="spt-error" id={`spt-err-${p.id}`}>{errors[`amount-${p.id}`]}</p>}</> },
    { key: 'remove', label: 'Remove', render: (p) => readOnly ? '' : <button type="button" className="admin-icon-button admin-icon-button--danger" aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)} data-testid={`button-spt-remove-${p.id}`}><Trash2 size={16} aria-hidden="true" /></button> },
  ];

  return (
    <Shell>
      <div className="admin-page-head">
        <div>
          <p className="admin-page-head__eyebrow">Orders / SPT</p>
          <h1>{readOnly ? `Review ${order.number}` : order ? `Edit draft ${order.number}` : 'Add Order'}</h1>
          <p className="admin-page-head__description">{readOnly ? 'This saved mock order is read only.' : 'Choose doctor, MR and patients, then enter amounts.'}</p>
        </div>
        <Link href={BASE} className="admin-button admin-button--secondary" data-testid="link-spt-back"><ArrowLeft size={16} aria-hidden="true" />All orders</Link>
      </div>
      <p className="spt-boundary">Mock only: doctors, MRs and patients are fictional. Nothing is submitted, paid or fulfilled. Registered patients are not added to Patient Master. A page reload resets this session-only demo.</p>
      {errorList.length > 0 && <div className="spt-summary" role="alert" tabIndex={-1} ref={summaryRef} data-testid="status-spt-errors">
        <strong>Please fix the following before saving:</strong>
        <ul>{errorList.map(([key, msg]) => <li key={key}><button type="button" onClick={() => focusField(key)}>{labelFor(key)}</button>: {msg}</li>)}</ul>
      </div>}

      <section className="spt-card" aria-labelledby="spt-h-details">
        <h2 id="spt-h-details">Order details</h2>
        <div className="spt-grid">
          <div className={`spt-field${errors.doctorId ? ' spt-field--error' : ''}`}>
            <label htmlFor="spt-doctor">Doctor</label>
            <SearchableSelect id="spt-doctor" label="Doctor" value={doctorId} options={DOCTOR_OPTIONS} onChange={(v) => { setDoctorId(v); setErrors((e) => ({ ...e, doctorId: undefined })); }} placeholder="Select doctor" invalid={Boolean(errors.doctorId)} describedBy={errors.doctorId ? 'spt-err-doctor' : undefined} disabled={readOnly} />
            {errors.doctorId && <p className="spt-error" id="spt-err-doctor">{errors.doctorId}</p>}
          </div>
          <div className={`spt-field${errors.mrId ? ' spt-field--error' : ''}`}>
            <label htmlFor="spt-mr">MR</label>
            <SearchableSelect id="spt-mr" label="MR" value={mrId} options={MR_OPTIONS} onChange={(v) => { setMrId(v); setErrors((e) => ({ ...e, mrId: undefined })); }} placeholder="Select MR" invalid={Boolean(errors.mrId)} describedBy={errors.mrId ? 'spt-err-mr' : undefined} disabled={readOnly} />
            {errors.mrId && <p className="spt-error" id="spt-err-mr">{errors.mrId}</p>}
          </div>
        </div>
      </section>

      <section className="spt-card" aria-labelledby="spt-h-patients">
        <h2 id="spt-h-patients">Patients</h2>
        {!readOnly && <>
          <p className="spt-card__sub">Search by patient ID or name, check the details, then add.</p>
          <div className={`spt-picker${errors.patients ? ' spt-field--error' : ''}`}>
            <div className="spt-field">
              <label htmlFor="spt-patient">Find patient</label>
              <SearchableSelect id="spt-patient" label="Patient search" value={pending} options={options} onChange={setPending} placeholder="Patient ID or name" invalid={Boolean(errors.patients)} describedBy={errors.patients ? 'spt-err-patients' : undefined} />
            </div>
            <div className="spt-picker__actions">
              <button type="button" className="admin-button" onClick={add} disabled={!preview} data-testid="button-spt-add-patient">Add patient</button>
              <button type="button" ref={registerBtn} className="admin-button admin-button--secondary" onClick={openRegister} aria-expanded={registering} data-testid="button-spt-register"><UserPlus size={16} aria-hidden="true" />Register Patient</button>
            </div>
          </div>
          {errors.patients && <p className="spt-error" id="spt-err-patients">{errors.patients}</p>}
          {preview && <dl className="spt-preview" data-testid="preview-spt-patient">
            <div><dt>ID</dt><dd>{preview.id}</dd></div><div><dt>Name</dt><dd>{preview.name}</dd></div>
            <div><dt>Gender</dt><dd>{preview.gender}</dd></div><div><dt>Age</dt><dd>{preview.age}</dd></div>
          </dl>}
          {registering && <form className="spt-register" onSubmit={submitRegister} aria-labelledby="spt-h-reg" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRegister(); } }} data-testid="form-spt-register">
            <h3 id="spt-h-reg">Register demo patient</h3>
            {Object.keys(regErrors).length > 0 && <p role="alert" className="spt-error">Check the highlighted patient fields.</p>}
            <p className="spt-card__sub" style={{ margin: 0 }}>Demo only. This does not create a Patient Master record.</p>
            <div className="spt-grid">
              <div className="spt-field"><label htmlFor="spt-reg-name">Patient name</label>
                <input id="spt-reg-name" ref={regName} className="spt-input" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} aria-invalid={Boolean(regErrors.name)} aria-describedby={regErrors.name ? 'spt-reg-name-err' : undefined} />
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
              <button type="submit" className="admin-button" data-testid="button-spt-register-submit">Create demo patient</button>
            </div>
          </form>}
        </>}
        {patients.length > 0 && <p className="spt-scroll-hint">Scroll horizontally to see all patient columns. Keyboard: focus the table region and use arrow keys.</p>}
        <DataTable columns={columns} rows={patients} rowKey={(p) => p.id} label="Selected patients" testIdPrefix="spt-patient"
          empty={<div className="spt-empty"><strong>No patients added</strong><p>{readOnly ? 'This order has no patients.' : 'Search for a patient above, or register a demo patient.'}</p></div>} />
        {patients.length > 0 && <div className="spt-total" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 8, background: 'var(--admin-table-head)', fontWeight: 800 }}>
          <span>Total</span><span className="spt-num" aria-live="polite" data-testid="text-spt-total">INR {money(total)}</span></div>}
        {!readOnly && <p className="spt-card__sub">Total includes valid amounts only. Blank or invalid amounts are excluded and must be corrected before Save. Save as Draft keeps incomplete entries.</p>}
      </section>

      <section className="spt-card" aria-labelledby="spt-h-remarks">
        <h2 id="spt-h-remarks">Remarks</h2>
        <div className="spt-field"><label htmlFor="spt-remarks" className="sr-only">Remarks</label>
          <textarea id="spt-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={readOnly} placeholder={readOnly ? 'No remarks' : 'Optional notes for this mock order'} data-testid="input-spt-remarks" /></div>
        <div className="spt-actions">
          {readOnly ? <Link href={BASE} className="admin-button">All orders</Link> : <>
            <button type="button" className="admin-button admin-button--secondary" onClick={() => save('Draft')} data-testid="button-spt-save-draft">Save as Draft</button>
            <button type="button" className="admin-button" onClick={() => save('Saved')} data-testid="button-spt-save">Save</button></>}
        </div>
      </section>
    </Shell>
  );
}

export default function SptOrderFormPage({ id }) {
  const snap = useSyncExternalStore(demoStore.subscribe, demoStore.getSnapshot, demoStore.getSnapshot);
  const order = id ? snap.orders.find((o) => o.id === id) : undefined;
  if (id && !order) {
    return <Shell>
      <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Orders / SPT</p><h1>Order not found</h1></div></div>
      <div className="spt-card" role="status" data-testid="status-spt-missing">
        <p style={{ margin: 0, lineHeight: 1.5 }}>This mock order is not available. Demo data lives in browser memory and resets when the page is reloaded.</p>
        <div className="spt-actions"><Link href={BASE} className="admin-button">All orders</Link></div>
      </div>
    </Shell>;
  }
  return <OrderForm key={id || 'new'} order={order} id={id} />;
}
