import { useEffect, useMemo, useState } from 'react';
import '../../poTemplateSettings.css';
import { PO_TEMPLATES, loadPOTemplatePreference, setDefaultPOTemplate, resetPOTemplatePreference, makeSampleInvoiceDocument } from '../../services/poInvoiceTemplates.js';
import POInvoiceDocument from './POInvoiceDocument.jsx';
import ConfirmationDialog from './ConfirmationDialog.jsx';

function readDefault() {
  try { return { id: loadPOTemplatePreference(), error: '' }; }
  catch (e) { return { id: null, error: e?.message || 'Saved template preference could not be loaded.' }; }
}

function Preview({ id }) {
  const doc = useMemo(() => {
    try { const d = makeSampleInvoiceDocument(id); return { ...d, pages: d.pages.slice(0, 1) }; } catch { return null; }
  }, [id]);
  if (!doc) return <p role="alert">Preview unavailable.</p>;
  return <POInvoiceDocument document={doc} compact />;
}

export default function POTemplateSettings() {
  const [state, setState] = useState(readDefault);
  const [status, setStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [docType] = useState('po');
  const [pending, setPending] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const defaultId = state.id;
  useEffect(() => { if (status) { const t = setTimeout(() => setStatus(''), 4000); return () => clearTimeout(t); } }, [status]);

  function choose(t) {
    setPending(t.id); setSaveError('');
    try { setDefaultPOTemplate(t.id); setState({ id: t.id, error: '' }); setStatus(`${t.name} is now the default PO invoice template.`); }
    catch (e) { setSaveError(`Could not save ${t.name} as default: ${e?.message || 'storage unavailable'}. Your previous default is unchanged.`); }
    setPending(null);
  }
  function resetDefault() {
    try {
      const id = resetPOTemplatePreference();
      setState({ id, error: '' });
      setSaveError('');
      setResetting(false);
      setStatus('Template preference reset to EVEXIA Classic. Purchase orders are unchanged.');
    } catch (e) { setResetError(e.message || 'Could not reset the template preference.'); }
  }

  return <section className="admin-panel admin-settings__section" aria-labelledby="templates-heading">
    <h2 id="templates-heading">Templates</h2>
    <p>Choose the layout used for supplier PO invoices and PDFs. Saved in this browser.</p>
    <div className="admin-settings__field">
      <label htmlFor="document-type">Document type</label>
      <select id="document-type" className="admin-select" value={docType} onChange={() => {}}>
        <option value="po">PO invoice templates</option>
      </select>
    </div>
    {state.error && <div className="admin-feedback admin-feedback--error po-tpl__error" role="alert">{state.error}
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setState(readDefault())}>Retry loading</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { setResetError(''); setResetting(true); }}>Reset template preference</button></div>}
    {saveError && <div className="admin-feedback admin-feedback--error po-tpl__error" role="alert">{saveError}</div>}
    <div className="sr-only" aria-live="polite" style={{ position: 'absolute', left: -9999 }}>{status}</div>
    {status && <div className="admin-feedback" style={{ marginTop: 16 }}>{status}</div>}
    <ul className="po-tpl__gallery" aria-label="PO invoice template previews">
      {PO_TEMPLATES.map((t) => {
        const isDefault = t.id === defaultId;
        return <li key={t.id} className={`po-tpl__card${isDefault ? ' po-tpl__card--default' : ''}`}>
          <div className="po-tpl__preview"><Preview id={t.id} /></div>
          <div className="po-tpl__head"><strong>{t.name}</strong>{isDefault && <span className="admin-badge">Default</span>}</div>
          <p>{t.description}</p>
          <button type="button" className="admin-button po-tpl__use" disabled={!!state.error || isDefault || pending === t.id} aria-label={isDefault ? `${t.name} is the default template` : `Use ${t.name} as default`} onClick={() => choose(t)}>
            {isDefault ? 'Current default' : 'Use as default'}
          </button>
        </li>;
      })}
    </ul>
    {resetting && <ConfirmationDialog title="Reset the PO invoice template preference?" description="Only this browser’s saved template choice will be reset to EVEXIA Classic. Purchase orders and other settings will not be changed." actionLabel="Reset template preference" onConfirm={resetDefault} onClose={() => setResetting(false)} error={resetError} />}
  </section>;
}
