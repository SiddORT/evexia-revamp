import { recordLocalChanges } from './localActivity.js';
export const MESSAGE_TEMPLATES_KEY = 'evexia.admin.message-templates.v1';

export const LIMITS = Object.freeze({
  name: 100,
  description: 500,
  subject: 200,
  html: 100000,
  text: 20000,
  body: 2000,
  providerTemplateId: 160,
  fileBytes: 100000,
  records: 100,
});

const MUTATION_LOCK = 'evexia.admin.message-templates.mutations.v1';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const MESSAGE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
const MAX_STORED_RAW_LENGTH = LIMITS.records * 2 * (
  LIMITS.name + LIMITS.description + LIMITS.subject + LIMITS.html +
  LIMITS.text + LIMITS.body + LIMITS.providerTemplateId + 512
) + 2048;

const systemTemplates = [
  {
    id: 'system-email-forgot-password',
    source: 'system',
    channel: 'email',
    name: 'Forgot password (example)',
    description: 'Fictional EVEXIA reset preview only; not connected to account recovery or sends.',
    content: {
      subject: 'Reset your EVEXIA password — fictional preview',
      html: `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef4f5;padding:24px 12px;font-family:Arial,sans-serif;color:#203b48"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border:1px solid #dce7e9;border-radius:16px"><tr><td style="padding:28px;text-align:center">
<img src="/images/evexia-logo.png" alt="EVEXIA Life Sciences" width="154" height="80">
<p style="font-size:11px;color:#526b76;letter-spacing:1px">FICTIONAL PREVIEW · NOTHING IS SENT</p>
<h1 style="font-size:26px;color:#126b70;margin:16px 0">Reset your password</h1>
<p style="text-align:left">Hello {{recipient_name}},</p>
<p style="text-align:left;line-height:1.6">This is a fictional password reset request for an EVEXIA demo account. The sample link below does not reset any password.</p>
<p style="margin:24px 0"><a href="{{reset_url}}" style="display:inline-block;background-color:#126b70;color:#ffffff;padding:14px 24px;border-radius:8px;font-weight:bold;text-decoration:none">Reset password</a></p>
<p style="text-align:left">Sample expiry: {{expiry_minutes}} minutes. All reset details are fictional preview content.</p>
<p style="text-align:left;font-size:12px;color:#526b76">If the button does not work, the fictional fallback URL is:</p>
<p style="text-align:left;overflow-wrap:anywhere;font-size:12px"><a href="{{reset_url}}" style="color:#126b70;text-decoration:underline">{{reset_url}}</a></p>
<p style="text-align:left;font-size:13px;line-height:1.6">If you did not request this, ignore this email. Your password would remain unchanged. This example is not connected to real recovery events.</p>
<hr style="border:1px solid #dce7e9"><p style="font-size:12px;color:#526b76">EVEXIA LIFE SCIENCES · {{company_name}}<br>Browser-local template preview only</p>
</td></tr></table></td></tr></table>`,
      text: 'FICTIONAL PREVIEW — NOTHING IS SENT. Hello {{recipient_name}}, reset your EVEXIA demo password: {{reset_url}}. Sample expiry: {{expiry_minutes}} minutes. All reset details are fictional and this URL cannot reset a password. If you did not request this, ignore this email; your password would remain unchanged. Not connected to recovery events. — {{company_name}}',
    },
  },
  {
    id: 'system-email-order-confirmation',
    source: 'system',
    channel: 'email',
    name: 'Order confirmation (example)',
    description: 'EVEXIA starter example; not connected to order events.',
    content: {
      subject: 'Order {{order_number}} received',
      html: '<h1>Thank you, {{recipient_name}}</h1><p>We received order <strong>{{order_number}}</strong>.</p><p>— {{company_name}}</p>',
      text: 'Thank you, {{recipient_name}}. We received order {{order_number}}. — {{company_name}}',
    },
  },
  {
    id: 'system-email-payment-receipt',
    source: 'system',
    channel: 'email',
    name: 'Payment receipt (example)',
    description: 'EVEXIA starter example; not connected to payment events.',
    content: {
      subject: 'Payment receipt for {{order_number}}',
      html: '<h1>Payment received</h1><p>Hello {{recipient_name}},</p><p>We recorded a payment of {{amount}} for order {{order_number}}.</p><p>— {{company_name}}</p>',
      text: 'Hello {{recipient_name}}, we recorded a payment of {{amount}} for order {{order_number}}. — {{company_name}}',
    },
  },
  {
    id: 'system-sms-order-confirmation',
    source: 'system',
    channel: 'sms',
    name: 'Order confirmation (example)',
    description: 'EVEXIA starter example; not connected to order events.',
    content: {
      body: 'Hi {{recipient_name}}, order {{order_number}} was received. — {{company_name}}',
      providerTemplateId: '',
    },
  },
  {
    id: 'system-sms-payment-receipt',
    source: 'system',
    channel: 'sms',
    name: 'Payment receipt (example)',
    description: 'EVEXIA starter example; not connected to payment events.',
    content: {
      body: 'Hi {{recipient_name}}, payment {{amount}} for {{order_number}} was received. — {{company_name}}',
      providerTemplateId: '',
    },
  },
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export const SYSTEM_TEMPLATES = deepFreeze(systemTemplates);

function validateField(field, operation) {
  try {
    return operation();
  } catch (error) {
    error.fields = { ...(error.fields || {}), [field]: error.message };
    throw error;
  }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requiredText(value, label, limit, { allowLineBreaks = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > limit) throw new Error(`${label} must be ${limit} characters or fewer.`);
  const controls = allowLineBreaks ? MESSAGE_CONTROL_CHARACTERS : CONTROL_CHARACTERS;
  if (controls.test(value)) throw new Error(`${label} contains unsupported control characters.`);
  return normalized;
}

function boundedText(value, label, limit, { allowLineBreaks = false } = {}) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  if (value.length > limit) throw new Error(`${label} must be ${limit} characters or fewer.`);
  const controls = allowLineBreaks ? MESSAGE_CONTROL_CHARACTERS : CONTROL_CHARACTERS;
  if (controls.test(value)) throw new Error(`${label} contains unsupported control characters.`);
  return value.trim();
}

export function validateMessageTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Enter a message template.');
  }
  const { channel } = input;
  if (channel !== 'email' && channel !== 'sms') throw new Error('Choose Email or SMS for this template.');

  const name = validateField('name', () => requiredText(input.name, 'Template name', LIMITS.name));
  const description = validateField('description', () => boundedText(input.description, 'Description', LIMITS.description));
  if (!input.content || typeof input.content !== 'object' || Array.isArray(input.content)) {
    throw new Error('Enter the template content.');
  }

  let content;
  if (channel === 'email') {
    content = {
      subject: validateField('subject', () => requiredText(input.content.subject, 'Email subject', LIMITS.subject)),
      html: validateField('html', () => requiredText(input.content.html, 'Email HTML', LIMITS.html, { allowLineBreaks: true })),
      text: validateField('text', () => requiredText(input.content.text, 'Email plain-text alternative', LIMITS.text, { allowLineBreaks: true })),
    };
  } else {
    content = {
      body: validateField('body', () => requiredText(input.content.body, 'SMS message body', LIMITS.body, { allowLineBreaks: true })),
      providerTemplateId: validateField('providerTemplateId', () =>
        requiredText(input.content.providerTemplateId, 'Provider/DLT template ID', LIMITS.providerTemplateId)),
    };
  }

  return { source: 'user', channel, name, description, content };
}

function emptyRecord() {
  return { version: 1, revision: 'empty', templates: [] };
}

function invalidSaved() {
  return new Error('Saved message templates are invalid. Retry loading or restore valid message-template storage externally. Nothing has been replaced.');
}

function validId(value) {
  return typeof value === 'string' && VALID_ID.test(value);
}

function validateRecord(record) {
  if (!exactKeys(record, ['version', 'revision', 'templates']) || record.version !== 1 ||
    !validId(record.revision) || !Array.isArray(record.templates) ||
    record.templates.length > LIMITS.records) {
    throw invalidSaved();
  }

  const ids = new Set();
  const namesByChannel = { email: new Set(), sms: new Set() };
  for (const template of record.templates) {
    if (!exactKeys(template, ['id', 'source', 'channel', 'name', 'description', 'content']) ||
      !validId(template.id) || template.source !== 'user' ||
      SYSTEM_TEMPLATES.some((system) => system.id === template.id) || ids.has(template.id)) {
      throw invalidSaved();
    }
    let normalized;
    try {
      normalized = validateMessageTemplate(template);
      const contentKeys = template.channel === 'email'
        ? ['subject', 'html', 'text']
        : ['body', 'providerTemplateId'];
      if (!exactKeys(template.content, contentKeys)) throw invalidSaved();
    } catch {
      throw invalidSaved();
    }
    if (normalized.name !== template.name || normalized.description !== template.description ||
      Object.keys(normalized.content).some((key) => normalized.content[key] !== template.content[key])) {
      throw invalidSaved();
    }
    const normalizedName = template.name.toLowerCase();
    if (namesByChannel[template.channel].has(normalizedName)) throw invalidSaved();
    namesByChannel[template.channel].add(normalizedName);
    ids.add(template.id);
  }
  return record;
}

function readRaw() {
  try {
    return globalThis.window.localStorage.getItem(MESSAGE_TEMPLATES_KEY);
  } catch {
    throw new Error('Message templates could not be read. Enable browser storage and retry loading.');
  }
}

export function loadMessageTemplates() {
  const raw = readRaw();
  if (raw === null) return { raw, record: emptyRecord() };
  if (typeof raw !== 'string' || raw.length > MAX_STORED_RAW_LENGTH) {
    const error = invalidSaved();
    error.snapshot = { raw };
    throw error;
  }
  try {
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error('Saved message templates are unreadable. Retry loading or restore valid message-template storage externally. Nothing has been replaced.');
    }
    return { raw, record: validateRecord(record) };
  } catch (error) {
    error.snapshot = { raw };
    throw error;
  }
}

function assertFresh(snapshot) {
  if (!snapshot || !Object.hasOwn(snapshot, 'raw') || readRaw() !== snapshot.raw) {
    throw new Error('Message templates changed in another tab. Reload the latest templates, review your form and try again. No changes were saved.');
  }
}

function persist(snapshot, record) {
  validateRecord(record);
  assertFresh(snapshot);
  const raw = JSON.stringify(record);
  try {
    globalThis.window.localStorage.setItem(MESSAGE_TEMPLATES_KEY, raw);
  } catch {
    throw new Error('Message templates could not be saved. Check browser storage permissions or free space, then try again. Your saved templates are unchanged.');
  }
  recordLocalChanges('message_template', snapshot.record, record);
  return { raw, record };
}

function newId() {
  try {
    const id = globalThis.crypto?.randomUUID?.();
    if (validId(id)) return id;
  } catch {
    // Report a clear error below instead of using a predictable or unstable ID.
  }
  throw new Error('A stable template ID could not be generated in this browser. Refresh and try again.');
}

async function withMutationLock(operation) {
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') {
    throw new Error('Saving message templates requires browser Web Locks. Use a supported browser and retry; no changes were saved.');
  }
  return locks.request(MUTATION_LOCK, { mode: 'exclusive' }, operation);
}

function prepareCurrent(snapshot) {
  assertFresh(snapshot);
  const current = loadMessageTemplates();
  assertFresh(snapshot);
  return current;
}

export async function saveMessageTemplate(snapshot, input, id = null) {
  const normalized = validateMessageTemplate(input);
  if (id !== null && (typeof id !== 'string' || !validId(id))) {
    throw new Error('This template ID is invalid. Reload the template list and try again.');
  }
  if (id !== null && SYSTEM_TEMPLATES.some((template) => template.id === id)) {
    throw new Error('System templates cannot be overwritten. Copy the template to create a user version.');
  }

  return withMutationLock(() => {
    const current = prepareCurrent(snapshot);
    const record = current.record;
    const existingIndex = id === null ? -1 : record.templates.findIndex((template) => template.id === id);
    if (id !== null && existingIndex === -1) {
      throw new Error('This user template no longer exists. Reload the latest templates and try again.');
    }
    if (record.templates.some((template) =>
      template.id !== id && template.channel === normalized.channel &&
      template.name.toLowerCase() === normalized.name.toLowerCase())) {
      throw new Error('Use a unique template name within this channel.');
    }
    if (id === null && record.templates.length >= LIMITS.records) {
      throw new Error(`The library supports up to ${LIMITS.records} user templates. Delete one before adding another.`);
    }

    const saved = { id: id || newId(), ...normalized };
    if (id === null) record.templates.push(saved);
    else record.templates[existingIndex] = saved;
    record.revision = newId();
    return persist(snapshot, record);
  });
}

export async function deleteMessageTemplate(snapshot, id) {
  if (typeof id !== 'string' || !validId(id)) {
    throw new Error('This template ID is invalid. Reload the template list and try again.');
  }
  if (SYSTEM_TEMPLATES.some((template) => template.id === id)) {
    throw new Error('System templates cannot be deleted.');
  }

  return withMutationLock(() => {
    const current = prepareCurrent(snapshot);
    const record = current.record;
    const remaining = record.templates.filter((template) => template.id !== id);
    if (remaining.length === record.templates.length) {
      throw new Error('This user template no longer exists. Reload the latest templates and try again.');
    }
    record.templates = remaining;
    record.revision = newId();
    return persist(snapshot, record);
  });
}