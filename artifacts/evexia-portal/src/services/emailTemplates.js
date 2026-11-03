import { emailTemplateRequest } from '../auth/adminSession.js';

export const EMAIL_VARIABLES = Object.freeze(['recipient_name', 'company_name', 'reset_url', 'expiry_minutes']);
export const INVITATION_VARIABLES = Object.freeze([...EMAIL_VARIABLES, 'portal_name', 'login_id']);
export const isInvitationEvent = (key) => ['account_invitation', 'mr_invitation'].includes(key);
export const IMMUNOTHERAPY_EVENT = 'mr_immunotherapy_placed';
export const PLACEMENT_VARIABLES = Object.freeze(['mr_name', 'patient_name', 'placement_date']);
export const emailVariables = (key) => key === IMMUNOTHERAPY_EVENT ? PLACEMENT_VARIABLES : isInvitationEvent(key) ? INVITATION_VARIABLES : EMAIL_VARIABLES;
export const EMAIL_EVENT_LABELS = Object.freeze({
  password_recovery: 'Password recovery',
  account_invitation: 'Staff invitation · Admin workspace',
  mr_invitation: 'MR invitation · MR portal',
  mr_immunotherapy_placed: 'MR Immunotherapy order placement · Super Admin',
});
function invalid() {
  const error = new Error('Email templates returned an invalid response. Load latest before retrying; your draft is kept.');
  error.ambiguous = true;
  return error;
}
function template(row) {
  if (!row || !/^[0-9a-f-]{36}$/i.test(row.id) || !Number.isInteger(row.version) || row.version < 1 ||
      typeof row.protected !== 'boolean' || ![null, 'password_recovery', 'account_invitation', 'mr_invitation', IMMUNOTHERAPY_EVENT].includes(row.event_key) ||
      !['name', 'description', 'subject', 'html', 'text'].every((k) => typeof row[k] === 'string')) throw invalid();
  return { id: row.id, channel: 'email', source: row.protected ? 'system' : 'user',
    protected: row.protected, version: row.version, eventKey: row.event_key,
    name: row.name, description: row.description, content: { subject: row.subject, html: row.html, text: row.text } };
}
export function emailSnapshot(data) {
  if (!Array.isArray(data?.items) || data.items.length > 103 || !Array.isArray(data.events) ||
      data.events.length !== 4 || new Set(data.events.map((e) => e.key)).size !== 4 ||
      data.events.some((event) => !Object.hasOwn(EMAIL_EVENT_LABELS, event.key) || event.required !== true
        || JSON.stringify(event.variables) !== JSON.stringify(emailVariables(event.key)))) throw invalid();
  return { record: { templates: data.items.map(template), events: data.events } };
}
export async function loadEmailTemplates(options) {
  return emailSnapshot(await emailTemplateRequest('', undefined, options));
}
export async function getEmailTemplate(id, options) {
  return template(await emailTemplateRequest(`/${id}`, undefined, options));
}
export async function saveEmailTemplate(draft, input) {
  const body = { name: input.name, description: input.description, ...input.content, event_key: input.eventKey ?? null,
    ...(draft.id ? { version: draft.version } : { creation_id: draft.creationId }) };
  return emailSnapshot(await emailTemplateRequest(draft.id ? `/${draft.id}/edit` : '', body));
}
export async function deleteEmailTemplate(draft) {
  return emailSnapshot(await emailTemplateRequest(`/${draft.id}/delete`, { version: draft.version }));
}
export async function getModernEmailLayout(id) {
  const data = await emailTemplateRequest(`/${id}/modern-layout`);
  if (typeof data?.html !== 'string' || !data.html || data.html.length > 100000) throw invalid();
  return data.html;
}
export async function sendEmailTemplateTest(row, recipient) {
  const data = await emailTemplateRequest(`/${row.id}/test`, { version: row.version, recipient });
  if (!data?.id || !['pending', 'sending', 'smtp_accepted', 'failed', 'unknown'].includes(data.status) || typeof data.message !== 'string') throw invalid();
  return data;
}
