import { useEffect, useMemo, useState } from 'react';
import '../../poTemplateSettings.css';
import { PO_TEMPLATES, loadPOTemplatePreference, setDefaultPOTemplate, resetPOTemplatePreference, subscribePOTemplatePreference, makeSampleInvoiceDocument } from '../../services/poInvoiceTemplates.js';
import POInvoiceDocument from './POInvoiceDocument.jsx';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import { PR_TEMPLATES, loadPRTemplatePreference, setDefaultPRTemplate, resetPRTemplatePreference, subscribePRTemplatePreference } from '../../services/prReceiptTemplates.js';
import { makeSamplePRDocument } from '../../services/prDocuments.js';
import PRReceiptDocument from './PRReceiptDocument.jsx';

function readDefault(type) {
  try { return { id: (type === 'pr' ? loadPRTemplatePreference : loadPOTemplatePreference)(), error: '' }; }
  catch (e) { return { id: null, error: e?.message || 'Saved template preference could not be loaded.' }; }
}

function Preview({ id, type }) {
  const doc = useMemo(() => {
    try { const d = type === 'pr' ? makeSamplePRDocument(id) : makeSampleInvoiceDocument(id); return { ...d, pages: d.pages.slice(0, 1) }; } catch { return null; }
  }, [id, type]);
  if (!doc) return <p role="alert">Preview unavailable.</p>;
  return type === 'pr' ? <PRReceiptDocument document={doc} compact /> : <POInvoiceDocument document={doc} compact />;
}

export default function POTemplateSettings() {
  const [docType, setDocType] = useState('po');
  return <section className="admin-panel admin-settings__section" aria-labelledby="templates-heading">
    <h2 id="templates-heading">Templates</h2>
    <p>Choose document layouts for previews and on-device PDFs. PO and PR choices are saved independently in this browser.</p>
    <div className="admin-settings__field">
      <label htmlFor="document-type">Document type</label>
      <select id="document-type" className="admin-select" value={docType} onChange={(event) => setDocType(event.target.value)}>
        <option value="po">PO invoice templates</option>
        <option value="pr">PR receipt templates</option>
      </select>
    </div>
    <TemplateGallery key={docType} docType={docType} />
  </section>;
}

function TemplateGallery({ docType }) {
  const [state, setState] = useState(() => readDefault(docType));
  const [status, setStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [pending, setPending] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const defaultId = state.error ? null : state.id;
  const isPR = docType === 'pr';
  const label = isPR ? 'PR receipt' : 'PO invoice';
  const templates = isPR ? PR_TEMPLATES : PO_TEMPLATES;
  useEffect(() => { if (status) { const t = setTimeout(() => setStatus(''), 4000); return () => clearTimeout(t); } }, [status]);
  useEffect(() => {
    const refresh = (next) => {
      // Recovery is explicit: a later valid value must not silently dismiss an error.
      setState((previous) => ({ ...next, error: next.error || previous.error }));
      setStatus('');
    };
    const unsubscribe = (docType === 'pr' ? subscribePRTemplatePreference : subscribePOTemplatePreference)(refresh);
    refresh(readDefault(docType)); // Close the gap between rendering and subscribing.
    return unsubscribe;
  }, [docType]);

  function choose(t) {
    setPending(t.id); setSaveError('');
    try { (isPR ? setDefaultPRTemplate : setDefaultPOTemplate)(t.id); setState({ id: t.id, error: '' }); setStatus(`${t.name} is now the default ${label} template.`); }
    catch (e) { setSaveError(`Could not save ${t.name} as default: ${e?.message || 'storage unavailable'}. Your previous default is unchanged.`); }
    setPending(null);
  }
  function resetDefault() {
    try {
      const id = (isPR ? resetPRTemplatePreference : resetPOTemplatePreference)();
      setState({ id, error: '' });
      setSaveError('');
      setResetting(false);
      setStatus(`${label} template preference reset to EVEXIA Classic. Other template choices and transaction records are unchanged.`);
    } catch (e) { setResetError(e.message || 'Could not reset the template preference.'); }
  }

  return <div>
    <p>{isPR ? 'Purchase Received receipts show saved quantities, not financial invoice amounts. Preview below uses fictional sample details.' : 'Supplier PO invoices show saved order amounts. Previews below use fictional sample details.'}</p>
    {state.error && <div className="admin-feedback admin-feedback--error po-tpl__error" role="alert">{state.error}
      <p>After fixing storage access or changing this preference in another tab, retry loading to confirm recovery. Reset affects only this document type.</p>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setState(readDefault(docType))}>Retry loading {label} preference</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { setResetError(''); setResetting(true); }}>Reset {label} preference</button></div>}
    {saveError && <div className="admin-feedback admin-feedback--error po-tpl__error" role="alert">{saveError}</div>}
    <div className="sr-only" aria-live="polite" style={{ position: 'absolute', left: -9999 }}>{status}</div>
    {status && <div className="admin-feedback" style={{ marginTop: 16 }}>{status}</div>}
    <ul className="po-tpl__gallery" aria-label={`${label} template previews`}>
      {templates.map((t) => {
        const isDefault = t.id === defaultId;
        return <li key={t.id} className={`po-tpl__card${isDefault ? ' po-tpl__card--default' : ''}`}>
          <div className="po-tpl__preview"><Preview id={t.id} type={docType} /></div>
          <span className="po-tpl__sample">Sample · Preview only</span>
          <div className="po-tpl__head"><strong>{t.name}</strong>{isDefault && <span className="admin-badge">Default</span>}</div>
          <p>{t.description}</p>
          <button type="button" className="admin-button po-tpl__use" disabled={!!state.error || isDefault || pending === t.id} aria-label={isDefault ? `${t.name} is the default ${label} template` : `Use ${t.name} as default ${label} template`} onClick={() => choose(t)}>
            {isDefault ? 'Current default' : 'Use as default'}
          </button>
        </li>;
      })}
    </ul>
    {!state.error && <button type="button" className="admin-button admin-button--secondary" style={{ marginTop: 18 }} onClick={() => { setResetError(''); setResetting(true); }}>Reset {label} preference</button>}
    {resetting && <ConfirmationDialog title={`Reset the ${label} template preference?`} description={`Only this browser’s ${label} template choice will be reset to EVEXIA Classic. Other template choices, purchase orders and receipts will not be changed.`} actionLabel={`Reset ${label} preference`} onConfirm={resetDefault} onClose={() => setResetting(false)} error={resetError} />}
  </div>;
}
