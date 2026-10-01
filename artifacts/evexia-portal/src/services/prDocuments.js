import { downloadInvoiceDocument } from './poInvoicePdf.js';
import { loadPRTemplatePreference, PR_TEMPLATES } from './prReceiptTemplates.js';
import { normalizePRReceipt, makeSamplePRReceipt } from './prReceiptModel.js';
import { renderPRReceiptPages } from './prReceiptRender.js';

/**
 * Preview and PDF share this normalized saved receipt and its exact SVG pages.
 * No live PO balance or master-data lookup is allowed during document generation.
 */
export function makePRDocument(receipt, templateId = loadPRTemplatePreference()) {
  if (!PR_TEMPLATES.some((template) => template.id === templateId)) {
    throw new Error('Choose a supported PR receipt template in Settings > Templates.');
  }
  const model = normalizePRReceipt(receipt);
  return { number: model.number, templateId, model, pages: renderPRReceiptPages(model, templateId) };
}

export function makeSamplePRDocument(templateId = 'classic') {
  return makePRDocument(makeSamplePRReceipt(), templateId);
}

export function prReceiptFilename(number) {
  const safeNumber = String(number || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return `purchase-received-${safeNumber || 'receipt'}.pdf`;
}

/** Rasterize the preview pages locally using the existing A4 PDF serializer. */
export async function downloadPRDocument(document, _filename, logoUrl) {
  if (!document || !Array.isArray(document.pages) || !document.pages.length ||
    document.pages.some((page) => typeof page !== 'string')) {
    throw new Error('Purchase Received document pages are missing; no PDF was downloaded.');
  }
  if (!PR_TEMPLATES.some((template) => template.id === document.templateId)) {
    throw new Error('The PR receipt document has an unsupported template.');
  }
  try {
    return await downloadInvoiceDocument(document, prReceiptFilename(document.number), logoUrl);
  } catch (error) {
    throw new Error((error?.message || 'The receipt PDF could not be downloaded.').replace(/invoice/gi, 'receipt'));
  }
}