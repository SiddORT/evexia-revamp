import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog.jsx';
import RemoteSelect from './RemoteSelect.jsx';
import SearchableSelect from './SearchableSelect.jsx';
import useSalesTargetYears from '../../hooks/useSalesTargetYears.js';
import { getSalesTarget, salesTargetChoices } from '../../services/serverSalesTargets.js';
import { QUARTERS, defaultTarget, formatAmount, formatCents, sumDraft, targetBody, targetDraftErrors } from '../../services/salesTargetFields.js';
import '../../salesTarget.css';

export const mrOption = (mr) => ({ value: mr.id, label: `${mr.name} (${mr.employeeCode})`, raw: mr });
export const fetchMrs = (extra = {}) => async (query, offset, signal, cursor) => {
  const page = await salesTargetChoices({ query, offset, cursor, limit: 20, ...extra }, signal);
  return { items: page.mrs.map(mrOption), total: page.total, nextCursor: page.nextCursor, partial: page.partial };
};
export const fetchZones = async (query, offset, signal) => {
  const page = await salesTargetChoices({ limit: 1, zoneQuery: query, zoneOffset: offset }, signal);
  return { items: page.zones.map((z) => ({ value: z.id, label: z.name, raw: z })), total: page.zonesTotal ?? page.zones.length };
};

const pick = (record) => record ? { mrId: record.mrId, startYear: String(record.startYear), endYear: String(record.endYear), ...Object.fromEntries(QUARTERS.map((k) => [k, record[k]])), status: record.status } : defaultTarget();

export default function SalesTargetForm({ record, onSave, onClose }) {
  const [values, setValues] = useState(() => pick(record));
  const [mr, setMr] = useState(() => record ? { id: record.mrId, name: record.mrName, employeeCode: record.employeeCode, zoneName: record.zoneName, headquarterName: record.headquarterName } : null);
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [current, setCurrent] = useState(null);
  const [staleRecord, setStaleRecord] = useState(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const busy = useRef(false);
  const { years, error: yearError } = useSalesTargetYears([values.startYear, values.endYear, record?.startYear, record?.endYear]);
  useEffect(() => {
    if (!record) return undefined;
    const controller = new AbortController();
    setNotice('');
    getSalesTarget(record.id, controller.signal).then((fresh) => {
      if (controller.signal.aborted) return;
      if (fresh.version !== record.version) { setStaleRecord(fresh); setBlocked(true); return; }
      setCurrent(fresh);
      setMr({ id: fresh.mrId, name: fresh.mrName, employeeCode: fresh.employeeCode, zoneName: fresh.zoneName, headquarterName: fresh.headquarterName });
    }).catch((cause) => { if (!controller.signal.aborted) { setNotice(cause.message || 'Current record could not be confirmed.'); if (cause.status === 404) setBlocked(true); } });
    return () => controller.abort();
  }, [record, detailRevision]);
  function change(key, value) {
    setValues((old) => {
      const next = { ...old, [key]: value };
      if (key === 'startYear' && value && Number(old.endYear) === Number(old.startYear) + 1) next.endYear = String(Number(value) + 1);
      if (attempted) setErrors(targetDraftErrors(next));
      return next;
    });
    setMessage('');
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current || blocked || (record && !current)) return;
    setAttempted(true);
    const found = targetDraftErrors(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    busy.current = true; setPending(true);
    try {
      const result = await onSave(targetBody(values), current || record);
      if (!result.success) {
        setMessage(result.error);
        if (result.fields) setErrors((old) => ({ ...old, ...result.fields }));
        if (/_stale$/.test(result.code || '') || result.ambiguous) setBlocked(true);
      }
    } finally { busy.current = false; setPending(false); }
  }
  const total = sumDraft(values);
  const err = (key) => errors[key] && <span className="admin-target-form__error" id={`target-error-${key}`}>{errors[key]}</span>;
  const savedMr = record && !mr ? null : mr;
  return <Dialog className="admin-target-dialog" eyebrow="Sales Target Master" title={record ? 'Edit sales target' : 'Add sales target'} description="Set the quarterly budget for one MR and financial year. Amounts are in Indian rupees; totals are computed by the server on save." onClose={pending ? () => {} : onClose}>
    <form className="admin-target-form" onSubmit={submit} noValidate>
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 16 }}>
        <div className="admin-target-form__grid">
          <div className="admin-target-field"><span>Medical representative</span>
            <RemoteSelect describeSelection id="sales-target-mr" label="Medical representative" value={values.mrId} selected={savedMr ? { label: `${savedMr.name} (${savedMr.employeeCode})` } : null} fetchPage={fetchMrs()} placeholder="Select MR" invalid={errors.mrId}
              onChange={(item) => { setMr(item?.raw || null); change('mrId', item?.value || ''); }} />{err('mrId')}</div>
          <label className="admin-target-field">Status<select value={values.status} onChange={(e) => change('status', e.target.value)} data-testid="select-sales-target-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>{err('status')}</label>
          <label className="admin-target-field">Headquarter<input readOnly value={mr?.headquarterName || (mr ? 'Not assigned' : 'Select an MR first')} aria-describedby="target-headquarter-full" data-testid="input-sales-target-headquarter" /><span id="target-headquarter-full" className="admin-target-reference">{mr?.headquarterName || (mr ? 'Not assigned' : 'Select an MR first')}</span></label>
          <label className="admin-target-field">Assigned zone<input readOnly value={mr?.zoneName || (mr ? 'Not assigned' : 'Select an MR first')} aria-describedby="target-zone-full" data-testid="input-sales-target-zone" /><span id="target-zone-full" className="admin-target-reference">{mr?.zoneName || (mr ? 'Not assigned' : 'Select an MR first')}</span></label>
          {['startYear', 'endYear'].map((key) => <div className="admin-target-field" key={key}><span>{key === 'startYear' ? 'Financial start year' : 'Financial end year'}</span>
            <SearchableSelect id={`sales-target-${key}`} label={key === 'startYear' ? 'Financial start year' : 'Financial end year'} value={values[key]} options={years} placeholder="Select year" invalid={errors[key]} onChange={(v) => change(key, v)} />{err(key)}</div>)}
        </div>
        {yearError && <div className="admin-feedback admin-feedback--error" role="alert">{yearError} Existing years stay selectable.</div>}
        <div className="admin-target-form__quarter">{QUARTERS.map((key) => <label className="admin-target-field" key={key}>{key.toUpperCase()} target
          <input inputMode="decimal" value={values[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `target-error-${key}` : undefined} data-testid={`input-sales-target-${key}`} />{err(key)}</label>)}</div>
        <div className="admin-target-form__total"><span>Annual target {record && !current ? '' : '(preview; server confirms)'}</span><strong data-testid="text-sales-target-annual">{total === null ? '—' : formatCents(total)}</strong></div>
        {record && <p className="admin-target-import__guide">Saved annual total: {formatAmount(record.annualTotal)}</p>}
        {staleRecord && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-sales-target-stale">
          This target changed on the server (version {staleRecord.version}; your form started from version {record.version}). Saving is blocked so nothing is overwritten. Current server values: {staleRecord.mrName} ({staleRecord.employeeCode}), {staleRecord.startYear}–{staleRecord.endYear}, Q1 {formatAmount(staleRecord.q1)}, Q2 {formatAmount(staleRecord.q2)}, Q3 {formatAmount(staleRecord.q3)}, Q4 {formatAmount(staleRecord.q4)}, annual {formatAmount(staleRecord.annualTotal)}, {staleRecord.status}. Your draft above is unchanged.
          <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" onClick={() => { setValues(pick(staleRecord)); setMr({ id: staleRecord.mrId, name: staleRecord.mrName, employeeCode: staleRecord.employeeCode, zoneName: staleRecord.zoneName, headquarterName: staleRecord.headquarterName }); setCurrent(staleRecord); setStaleRecord(null); setBlocked(false); setErrors({}); setMessage(''); }} data-testid="button-discard-reload-sales-target">Discard my draft and load current values</button><button type="button" className="admin-button admin-button--secondary" onClick={onClose} data-testid="button-close-stale-sales-target">Close and refresh list</button></div></div>}
        {notice && <div className="admin-feedback" role="status">{notice}<button type="button" className="admin-button admin-button--secondary" onClick={() => setDetailRevision((value) => value + 1)}>Retry current details</button></div>}
        {message && <div className="admin-feedback admin-feedback--error" role="alert" data-testid="status-sales-target-form-error">{message}{blocked ? ' Close this form and reload current records before editing again.' : ''}</div>}
        <div className="admin-dialog__actions"><button type="button" className="admin-button admin-button--secondary" disabled={pending} onClick={onClose} data-testid="button-cancel-sales-target">Cancel</button><button type="submit" className="admin-button" disabled={pending || blocked || Boolean(record && !current)} data-testid="button-save-sales-target">{pending ? 'Saving…' : record ? 'Save changes' : 'Add target'}</button></div>
      </fieldset>
    </form>
  </Dialog>;
}
