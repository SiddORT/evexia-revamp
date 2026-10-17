import { emailTemplateRequest } from '../auth/adminSession.js';

export const EMAIL_VARIABLES = Object.freeze(['recipient_name', 'company_name', 'reset_url', 'expiry_minutes']);
function invalid() {
  const error = new Error('Email templates returned an invalid response. Load latest before retrying; your draft is kept.');
  error.ambiguous = true;
  return error;
}
function template(row) {
  if (!row || !/^[0-9a-f-]{36}$/i.test(row.id) || !Number.isInteger(row.version) || row.version < 1 ||
      typeof row.protected !== 'boolean' || ![null, 'password_recovery'].includes(row.event_key) ||
      !['name', 'description', 'subject', 'html', 'text'].every((k) => typeof row[k] === 'string')) throw invalid();
  return { id: row.id, channel: 'email', source: row.protected ? 'system' : 'user',
    protected: row.protected, version: row.version, eventKey: row.event_key,
    name: row.name, description: row.description, content: { subject: row.subject, html: row.html, text: row.text } };
}
export function emailSnapshot(data) {
  if (!Array.isArray(data?.items) || data.items.length > 100 || !Array.isArray(data.events) ||
      data.events.length !== 1 || data.events[0].key !== 'password_recovery' ||
      data.events[0].required !== true || JSON.stringify(data.events[0].variables) !== JSON.stringify(EMAIL_VARIABLES)) throw invalid();
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
