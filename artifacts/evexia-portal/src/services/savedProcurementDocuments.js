import { purchaseOrderRequest, purchaseReceivedRequest, reportingIdentityGuard } from '../auth/adminSession.js';
import { getAdminDisplayPreferences } from '../components/admin/adminPreferences.js';
import { loadPOTemplatePreference } from './poInvoiceTemplates.js';
import { loadPRTemplatePreference } from './prReceiptTemplates.js';
import { exportDisplayPreferences } from './datePresentation.js';
import { renderPOInvoicePages } from './poInvoiceRender.js';
import { renderPRReceiptPages } from './prReceiptRender.js';
import { normalizePRReceipt } from './prReceiptModel.js';
import { downloadPRDocument } from './prDocuments.js';
import { downloadInvoiceDocument } from './poInvoicePdf.js';

const requestFor = (kind) => kind === 'po' ? purchaseOrderRequest : purchaseReceivedRequest;
export function captureDocumentContext(kind) {
  let templateId;
  try { templateId = (kind === 'po' ? loadPOTemplatePreference : loadPRTemplatePreference)(); }
  catch (cause) { cause.documentPreferenceFailure = true; throw cause; }
  return Object.freeze({
    templateId,
    schemaVersion: 1, rendererVersion: 1,
    presentation: exportDisplayPreferences(getAdminDisplayPreferences()),
  });
}
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function revisionStatus(document) {
  return `Revision ${document.revision} · ${document.current ? 'Current' : `Superseded — not the latest version · Latest revision ${document.latestRevision}`}`;
}
export function revisionFilename(document) {
  const number = String(document.number).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  return `${number}-revision-${document.revision}${document.current ? '-current' : '-superseded'}.pdf`;
}
export function renderArchivedDocument(saved, kind) {
  if (saved.schemaVersion !== 1 || saved.rendererVersion !== 1 || !['classic', 'modern', 'compact'].includes(saved.templateId)) {
    throw new Error('This saved document needs a compatible renderer. The record is saved; do not save it again to retry rendering.');
  }
  const model = kind === 'pr' ? normalizePRReceipt(saved.model) : saved.model;
  const statusText = revisionStatus(saved);
  const pages = (kind === 'pr' ? renderPRReceiptPages : renderPOInvoicePages)(model, saved.templateId, saved.presentation)
    .map((page) => page.replace('</svg>', `<rect x="20" y="1093" width="754" height="23" fill="#fff4df"/><text x="397" y="1108" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#6d3300">${xml(statusText)}</text></svg>`));
  return { ...saved, kind, model, number: model.number, archived: true, statusText, pages };
}
export async function getSavedDocument(kind, id, revision, signal) {
  const guard = reportingIdentityGuard();
  guard();
  const saved = await requestFor(kind)(`/${id}/documents`, { params: revision ? { revision } : {}, signal });
  guard();
  return { ...renderArchivedDocument(saved, kind), recordId: id };
}
export async function getDocumentHistory(kind, id, offset, signal) {
  const guard = reportingIdentityGuard();
  guard();
  const result = await requestFor(kind)(`/${id}/history`, { params: { offset, limit: 10 }, signal });
  guard();
  return result;
}
export async function downloadSavedDocument(document, options = {}) {
  // A newer save may have committed since preview opened. Refresh lifecycle
  // labels at download time; archived business values remain immutable.
  const refreshed = await getSavedDocument(document.kind, document.recordId, document.revision);
  const guard = reportingIdentityGuard();
  const beforeRelease = async () => {
    guard();
    const status = await requestFor(document.kind)(`/${document.recordId}/documents`, { params: { revision: document.revision } });
    guard();
    if (status.latestRevision !== refreshed.latestRevision || status.current !== refreshed.current) {
      throw new Error('A newer document was saved while this PDF was being prepared. No file was released. Retry the download to include the updated superseded label.');
    }
  };
  const logo = `${import.meta.env.BASE_URL}images/evexia-logo.png`;
  return document.kind === 'pr'
    ? downloadPRDocument(refreshed, revisionFilename(refreshed), logo, { ...options, beforeRelease })
    : downloadInvoiceDocument(refreshed, revisionFilename(refreshed), logo, { guard, beforeRelease });
}
