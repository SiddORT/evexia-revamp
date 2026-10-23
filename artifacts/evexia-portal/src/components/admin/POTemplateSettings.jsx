import { useEffect, useMemo, useState } from 'react';
import { useAdminPreferences } from './adminPreferences.js';
import '../../poTemplateSettings.css';
import { PO_TEMPLATES, loadPOTemplatePreference, setDefaultPOTemplate, resetPOTemplatePreference, subscribePOTemplatePreference, makeSampleInvoiceDocument } from '../../services/poInvoiceTemplates.js';
import POInvoiceDocument from './POInvoiceDocument.jsx';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import { PR_TEMPLATES, loadPRTemplatePreference, setDefaultPRTemplate, resetPRTemplatePreference, subscribePRTemplatePreference } from '../../services/prReceiptTemplates.js';
import { makeSamplePRDocument } from '../../services/prDocuments.js';
import PRReceiptDocument from './PRReceiptDocument.jsx';
import { BOX_TEMPLATES, BOTTLE_TEMPLATES, boxTemplatePreference, bottleTemplatePreference, makeSampleBoxLabelDocument, makeSampleBottleLabelDocument } from '../../services/labelTemplates.js';
import LabelTemplateDocument from './LabelTemplateDocument.jsx';
import LabelTemplatePreviewDialog from './LabelTemplatePreviewDialog.jsx';
import {
  INSTRUCTIONS_TEMPLATES, ABROAD_LETTER_TEMPLATES, SHIPPING_ADDRESS_TEMPLATES, IMMUNOTHERAPY_INVOICE_TEMPLATES,
  instructionsTemplatePreference, abroadLetterTemplatePreference, shippingAddressTemplatePreference,
  immunotherapyInvoiceTemplatePreference, makeSampleImmunotherapyDocument,
} from '../../services/immunotherapyTemplates.js';
import ImmunotherapyTemplateDocument from './ImmunotherapyTemplateDocument.jsx';
import ImmunotherapyTemplatePreviewDialog from './ImmunotherapyTemplatePreviewDialog.jsx';

function sampleDocumentType(type, label, templates, preference, description) {
  return {
    ...preference, label, templates, description, isSampleDocument: true,
    sample: (id) => makeSampleImmunotherapyDocument(type, id), Renderer: ImmunotherapyTemplateDocument,
  };
}

const DOCUMENT_TYPES = {
  po: {
    label: 'PO invoice', templates: PO_TEMPLATES, defaultId: 'classic',
    load: loadPOTemplatePreference, save: setDefaultPOTemplate, reset: resetPOTemplatePreference, subscribe: subscribePOTemplatePreference,
    sample: makeSampleInvoiceDocument, Renderer: POInvoiceDocument,
    description: 'Supplier PO invoices show saved order amounts. Previews below use fictional sample details.',
  },
  pr: {
    label: 'PR receipt', templates: PR_TEMPLATES, defaultId: 'classic',
    load: loadPRTemplatePreference, save: setDefaultPRTemplate, reset: resetPRTemplatePreference, subscribe: subscribePRTemplatePreference,
    sample: makeSamplePRDocument, Renderer: PRReceiptDocument,
    description: 'Purchase Received receipts show saved quantities, not financial invoice amounts. Preview below uses fictional sample details.',
  },
  box: {
    ...boxTemplatePreference, label: 'Box label', templates: BOX_TEMPLATES,
    sample: makeSampleBoxLabelDocument, Renderer: LabelTemplateDocument, isLabel: true,
    description: 'Box label sample based on the supplied reference, with fictional patient and order details. Settings-only setup; no live order label printing or downloading.',
  },
  bottle: {
    ...bottleTemplatePreference, label: 'Bottle label', templates: BOTTLE_TEMPLATES,
    sample: makeSampleBottleLabelDocument, Renderer: LabelTemplateDocument, isLabel: true,
    description: 'Four-vial bottle label sample based on the supplied reference. Batch, manufacture, expiry and order values are fictional examples, not calculated clinical data. Settings-only setup; no live order label printing or downloading.',
  },
  instructions: sampleDocumentType('instructions', 'Instructions', INSTRUCTIONS_TEMPLATES, instructionsTemplatePreference,
    'Supplied double-dilution Instructions sample only. English/Hindi wording and bottle schedules are reproduced for layout review, not medically validated or extended to other regimens. No live order generation.'),
  'abroad-letter': sampleDocumentType('abroad-letter', 'Abroad letter', ABROAD_LETTER_TEMPLATES, abroadLetterTemplatePreference,
    'Supplied Abroad letter layout with fictional patient and doctor values. The sample is unsigned and does not authorize travel or generate a live order letter.'),
  'shipping-address': sampleDocumentType('shipping-address', 'Shipping address', SHIPPING_ADDRESS_TEMPLATES, shippingAddressTemplatePreference,
    'Supplied Shipping address panel with fictional recipient and checking details. Inspect the enlarged panel or full reference sheet framing; no live order shipping document or download.'),
  'immunotherapy-invoice': sampleDocumentType('immunotherapy-invoice', 'Immunotherapy order invoice', IMMUNOTHERAPY_INVOICE_TEMPLATES, immunotherapyInvoiceTemplatePreference,
    'Supplied Immunotherapy order invoice layout, distinct from supplier PO invoices. Fictional data and illustrative totals only; no production tax rules, live payment QR, bank details, issued invoice or download.'),
};

function documentType(type) {
  if (!Object.hasOwn(DOCUMENT_TYPES, type)) throw new Error('Choose a supported document type.');
  return DOCUMENT_TYPES[type];
}

function readDefault(type) {
  try { return { id: documentType(type).load(), error: '' }; }
  catch (e) { return { id: null, error: e?.message || 'Saved template preference could not be loaded.' }; }
}

function Preview({ id, type }) {
  const preferences = useAdminPreferences();
  const config = documentType(type);
  const Renderer = config.Renderer;
  const doc = useMemo(() => {
    try {
      const d = config.sample(id, preferences);
      return config.isLabel || config.isSampleDocument ? d : { ...d, pages: d.pages.slice(0, 1) };
    } catch { return null; }
  }, [id, type, preferences]);
  if (!doc) return <p role="alert">Preview unavailable.</p>;
  return <Renderer document={doc} compact />;
}

export default function POTemplateSettings() {
  const [docType, setDocType] = useState('po');
  return <section className="admin-panel admin-settings__section" aria-labelledby="templates-heading">
    <h2 id="templates-heading">Templates</h2>
    <p>Choose PO invoice, PR receipt, Box labels, Bottle labels, Instructions, Abroad letter, Shipping address and Immunotherapy order invoice templates. All eight defaults are saved independently in this browser only. PO and PR retain their existing previews and on-device PDFs. Labels and the four Immunotherapy documents are Settings samples only, not connected to live order actions, printing, payments or downloads.</p>
    <div className="admin-settings__field">
      <label htmlFor="document-type">Document type</label>
      <select id="document-type" className="admin-select" value={docType} onChange={(event) => setDocType(event.target.value)}>
        <option value="po">PO invoice templates</option>
        <option value="pr">PR receipt templates</option>
        <option value="box">Box labels</option>
        <option value="bottle">Bottle labels</option>
        <option value="instructions">Instructions</option>
        <option value="abroad-letter">Abroad letter</option>
        <option value="shipping-address">Shipping address</option>
        <option value="immunotherapy-invoice">Immunotherapy order invoice</option>
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
  const [enlarged, setEnlarged] = useState(null);
  const defaultId = state.error ? null : state.id;
  const config = documentType(docType);
  const { label, templates } = config;
  const resetName = templates.find((template) => template.id === config.defaultId).name;
  useEffect(() => { if (status) { const t = setTimeout(() => setStatus(''), 4000); return () => clearTimeout(t); } }, [status]);
  useEffect(() => {
    const refresh = (next) => {
      // Recovery is explicit: a later valid value must not silently dismiss an error.
      setState((previous) => ({ ...next, error: next.error || previous.error }));
      setStatus('');
    };
    const unsubscribe = config.subscribe(refresh);
    refresh(readDefault(docType)); // Close the gap between rendering and subscribing.
    return unsubscribe;
  }, [docType]);

  function choose(t) {
    setPending(t.id); setSaveError('');
    try { config.save(t.id); setState({ id: t.id, error: '' }); setStatus(`${t.name} is now the default ${label} template.`); }
    catch (e) { setSaveError(`Could not save ${t.name} as default: ${e?.message || 'storage unavailable'}. Your previous default is unchanged.`); }
    setPending(null);
  }
  function resetDefault() {
    try {
      const id = config.reset();
      setState({ id, error: '' });
      setSaveError('');
      setResetting(false);
      setStatus(`${label} template preference reset to ${resetName}. Other template choices and transaction records are unchanged.`);
    } catch (e) { setResetError(e.message || 'Could not reset the template preference.'); }
  }

  return <div>
    <p>{config.description}</p>
    {state.error && <div className="admin-feedback admin-feedback--error po-tpl__error" role="alert">{state.error}
      <p>After fixing storage access or changing this preference in another tab, retry loading to confirm recovery. Reset affects only this document type.</p>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => setState(readDefault(docType))}>Retry loading {label} preference</button>
      <button type="button" className="admin-button admin-button--secondary" onClick={() => { setResetError(''); setResetting(true); }}>Reset {label} preference</button></div>}
    {saveError && <div className="admin-feedback admin-feedback--error po-tpl__error" role="alert">{saveError}</div>}
    <div className="sr-only" aria-live="polite" style={{ position: 'absolute', left: -9999 }}>{status}</div>
    {status && <div className="admin-feedback" style={{ marginTop: 16 }}>{status}</div>}
    <ul className={`po-tpl__gallery${config.isLabel || config.isSampleDocument ? ' po-tpl__gallery--labels' : ''}`} aria-label={`${label} template previews`}>
      {templates.map((t) => {
        const isDefault = t.id === defaultId;
        return <li key={t.id} className={`po-tpl__card${isDefault ? ' po-tpl__card--default' : ''}`}>
          <div className={`po-tpl__preview${config.isLabel || config.isSampleDocument ? ' po-tpl__preview--label' : ''}`}><Preview id={t.id} type={docType} /></div>
          <span className="po-tpl__sample">Sample · Preview only</span>
          <div className="po-tpl__head"><strong>{t.name}</strong>{isDefault && <span className="admin-badge">Default</span>}</div>
          <p>{t.description}</p>
          {(config.isLabel || config.isSampleDocument) && <button type="button" className="admin-button admin-button--secondary" data-testid={`button-enlarge-${t.id}`} onClick={() => setEnlarged(t)}>Inspect enlarged sample</button>}
          <button type="button" className="admin-button po-tpl__use" disabled={!!state.error || isDefault || pending === t.id} aria-label={isDefault ? `${t.name} is the default ${label} template` : `Use ${t.name} as default ${label} template`} onClick={() => choose(t)}>
            {isDefault ? 'Current default' : 'Use as default'}
          </button>
        </li>;
      })}
    </ul>
    {!state.error && <button type="button" className="admin-button admin-button--secondary" style={{ marginTop: 18 }} onClick={() => { setResetError(''); setResetting(true); }}>Reset {label} preference</button>}
    {resetting && <ConfirmationDialog title={`Reset the ${label} template preference?`} description={`Only this browser’s ${label} template choice will be reset to ${resetName}. Other template choices and saved orders and receipts will not be changed.`} actionLabel={`Reset ${label} preference`} onConfirm={resetDefault} onClose={() => setResetting(false)} error={resetError} />}
    {enlarged && (config.isSampleDocument
      ? <ImmunotherapyTemplatePreviewDialog template={enlarged} document={config.sample(enlarged.id)} onClose={() => setEnlarged(null)} />
      : <LabelTemplatePreviewDialog template={enlarged} document={config.sample(enlarged.id)} onClose={() => setEnlarged(null)} />)}
  </div>;
}
