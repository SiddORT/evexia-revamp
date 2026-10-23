import { useState } from 'react';
import { usePlatformConfirm } from '../PlatformConfirmation.jsx';
import { loadPOTemplatePreference, resetPOTemplatePreference } from '../../services/poInvoiceTemplates.js';
import { loadPRTemplatePreference, resetPRTemplatePreference } from '../../services/prReceiptTemplates.js';

/** Explicit storage-error recovery without unmounting an in-progress draft. */
export default function DocumentPreferenceRecovery({ kind, message, onRecovered }) {
  const confirm = usePlatformConfirm();
  const [error, setError] = useState('');
  const label = kind.toUpperCase();
  function retry() {
    try {
      (kind === 'po' ? loadPOTemplatePreference : loadPRTemplatePreference)();
      onRecovered();
    } catch (cause) { setError(cause.message); }
  }
  async function reset() {
    if (!await confirm(`Reset only this browser’s ${label} template preference to EVEXIA Classic? Other template settings, saved documents and this draft will not change.`, { actionLabel: `Reset ${label} preference` })) return;
    try {
      (kind === 'po' ? resetPOTemplatePreference : resetPRTemplatePreference)();
      onRecovered();
    } catch (cause) { setError(cause.message); }
  }
  return <div className="admin-feedback admin-feedback--error" role="alert">
    <p>{error || message} Your draft is kept. Storage events do not dismiss this error.</p>
    <div className="po-actions"><button type="button" className="po-link" onClick={retry}>Retry {label} template preference</button>
      <button type="button" className="po-link" onClick={reset}>Reset {label} template preference</button></div>
  </div>;
}
