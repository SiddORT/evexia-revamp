import { useMemo } from 'react';
import { useAdminPreferences } from '../components/admin/adminPreferences.js';
import { displayPreferences } from '../services/datePresentation.js';
import { renderPOInvoicePages } from '../services/poInvoiceRender.js';
import { renderPRReceiptPages } from '../services/prReceiptRender.js';

// Keep canonical models unchanged. Both accessible text and downloaded pages use
// this same immutable presentation snapshot, including during async PDF work.
export default function useDocumentPresentation(document, type) {
  const preferences = useAdminPreferences();
  return useMemo(() => {
    if (!document.model) return document;
    const presentation = displayPreferences(preferences);
    return {
      ...document, presentation,
      pages: (type === 'pr' ? renderPRReceiptPages : renderPOInvoicePages)(document.model, document.templateId, presentation),
    };
  }, [document, type, preferences]);
}
