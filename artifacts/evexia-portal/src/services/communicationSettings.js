// Demo metadata only. Credential inputs must never be passed to this service.
export const COMMUNICATION_KEY = 'evexia.admin.communication.v1';
export const CHANNELS = ['email', 'sms', 'waba'];
const FIELDS = {
  smtp: ['name', 'host', 'port', 'security', 'username', 'fromName', 'fromEmail'],
  emailApi: ['name', 'provider', 'endpoint', 'fromName', 'fromEmail'],
  sms: ['name', 'provider', 'senderId', 'endpoint', 'dltEntityId', 'dltTemplateId'],
  waba: ['name', 'provider', 'endpoint', 'businessAccountId', 'phoneNumberId', 'senderPhone', 'apiVersion'],
};
const OPTIONAL = ['dltEntityId', 'dltTemplateId', 'apiVersion'];
const LABELS = {
  name: 'Configuration name', provider: 'Provider name', host: 'SMTP host', port: 'SMTP port',
  security: 'SMTP security', username: 'SMTP username', fromName: 'Sender/from name',
  fromEmail: 'Sender/from email', endpoint: 'API endpoint', senderId: 'Sender ID',
  dltEntityId: 'DLT entity ID', dltTemplateId: 'DLT template ID', businessAccountId: 'WhatsApp Business Account ID',
  phoneNumberId: 'Phone-number ID', senderPhone: 'Sender/display phone number', apiVersion: 'API version',
};
const invalidSaved = () => new Error('Saved Communication metadata is invalid. Retry loading or confirm a Communication-only reset. Nothing has been replaced.');
function checkChannel(channel) {
  if (!CHANNELS.includes(channel)) throw new Error('Choose Email, SMS or WABA.');
}
export function configurationFields(channel, type) {
  checkChannel(channel);
  if (channel === 'email') {
    if (!['smtp', 'api', 'platform'].includes(type)) throw new Error('Choose an Email configuration type.');
    return [...(type === 'smtp' ? FIELDS.smtp : FIELDS.emailApi)];
  }
  if (type !== 'api') throw new Error('Choose an API configuration type.');
  return [...FIELDS[channel]];
}
function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('API endpoint must be an absolute HTTPS URL.'); }
  // Preview deliberately disallows ALL query/fragment data: provider key names are
  // not standardized, so a denylist would allow credentials under unknown aliases.
  if (url.username || url.password || /[@]/.test(value.split('://')[1]?.split('/')[0] || '') ||
    value.includes('?') || value.includes('#')) {
    throw new Error('API endpoint cannot contain embedded credentials, query parameters or fragments. Remove them and use the separate unsaved dummy key input.');
  }
  if (url.protocol !== 'https:' || !url.hostname || /\s|\\/.test(value)) {
    throw new Error('API endpoint must be an absolute HTTPS URL without whitespace or backslashes.');
  }
}
export function validateConfiguration(channel, input) {
  const fields = configurationFields(channel, input?.type);
  const result = { type: input.type };
  for (const field of fields) {
    const value = input[field];
    if (value !== undefined && typeof value !== 'string') throw new Error(`${LABELS[field]} must be text.`);
    result[field] = (value || '').trim();
    if (!OPTIONAL.includes(field) && !result[field]) throw new Error(`${LABELS[field]} is required.`);
    if (result[field].length > (field === 'endpoint' ? 500 : 160) || /[\u0000-\u001f\u007f]/.test(result[field])) {
      throw new Error(`${LABELS[field]} is too long or contains unsupported characters.`);
    }
  }
  if (fields.includes('endpoint')) endpoint(result.endpoint);
  if (fields.includes('fromEmail') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.fromEmail)) {
    throw new Error('Enter a valid sender/from email address.');
  }
  if (input.type === 'smtp') {
    if (!/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)$/i.test(result.host)) {
      throw new Error('SMTP host must be a hostname or IPv4 address, without a URL, path or credentials.');
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(result.host) && result.host.split('.').some((part) => Number(part) > 255)) {
      throw new Error('Enter a valid SMTP host address.');
    }
    if (!/^\d{1,5}$/.test(result.port) || Number(result.port) < 1 || Number(result.port) > 65535) {
      throw new Error('SMTP port must be a whole number from 1 to 65535.');
    }
    if (!['starttls', 'tls', 'none'].includes(result.security)) throw new Error('Choose STARTTLS, TLS or no encryption for the SMTP preview.');
  }
  if (channel === 'waba') {
    const digitCount = result.senderPhone.replace(/\D/g, '').length;
    if (!/^\+?[\d ()-]{5,30}$/.test(result.senderPhone) || digitCount < 5 || digitCount > 15) throw new Error('Enter a sender/display phone number with 5–15 digits, an optional +, spaces, parentheses or hyphens.');
    if (result.apiVersion && !/^v?\d+(?:\.\d+)?$/.test(result.apiVersion)) throw new Error('Optional API version must look like v23.0.');
  }
  return result;
}
function emptyRecord() {
  return { version: 1, revision: 'empty', channels: Object.fromEntries(CHANNELS.map((channel) => [channel, { configurations: [], defaultId: null }])) };
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value); }
function validateRecord(record) {
  if (!exactKeys(record, ['version', 'revision', 'channels']) || record.version !== 1 ||
    !validId(record.revision) || !exactKeys(record.channels, CHANNELS)) throw invalidSaved();
  const allIds = new Set();
  for (const channel of CHANNELS) {
    const state = record.channels[channel];
    if (!exactKeys(state, ['configurations', 'defaultId']) || !Array.isArray(state.configurations) || state.configurations.length > 100) throw invalidSaved();
    const names = new Set();
    for (const config of state.configurations) {
      let normalized;
      try {
        normalized = validateConfiguration(channel, config);
        if (!exactKeys(config, ['id', 'type', ...configurationFields(channel, config.type)])) throw invalidSaved();
      } catch { throw invalidSaved(); }
      if (!validId(config.id) || allIds.has(config.id) || names.has(config.name.toLowerCase()) ||
        Object.entries(normalized).some(([key, value]) => value !== config[key])) throw invalidSaved();
      allIds.add(config.id); names.add(config.name.toLowerCase());
    }
    if (state.configurations.length ? !state.configurations.some((item) => item.id === state.defaultId) : state.defaultId !== null) throw invalidSaved();
  }
  return record;
}
function readRaw() {
  try { return window.localStorage.getItem(COMMUNICATION_KEY); }
  catch { throw new Error('Communication metadata could not be read. Enable browser storage and retry loading.'); }
}
export function loadCommunicationSnapshot() {
  const raw = readRaw();
  if (raw === null) return { raw, record: emptyRecord() };
  try {
    if (raw.length > 400000) throw invalidSaved();
    let record;
    try { record = JSON.parse(raw); }
    catch { throw new Error('Saved Communication metadata is unreadable. Retry loading or confirm a Communication-only reset. Nothing has been replaced.'); }
    return { raw, record: validateRecord(record) };
  } catch (error) {
    error.snapshot = { raw };
    throw error;
  }
}
function assertFresh(snapshot) {
  if (!snapshot || !Object.hasOwn(snapshot, 'raw') || readRaw() !== snapshot.raw) {
    throw new Error('Communication metadata changed in another tab. Retry loading the latest metadata, review your form and try again. No changes were saved.');
  }
}
function persist(snapshot, record) {
  validateRecord(record);
  assertFresh(snapshot);
  const raw = JSON.stringify(record);
  try { window.localStorage.setItem(COMMUNICATION_KEY, raw); }
  catch { throw new Error('Communication metadata could not be saved. Check browser storage permissions or free space, then try again. Your saved metadata is unchanged.'); }
  return { raw, record };
}
function prepare(snapshot, channel) {
  checkChannel(channel);
  assertFresh(snapshot);
  const current = loadCommunicationSnapshot();
  return structuredClone(current.record);
}
function revision() { return globalThis.crypto.randomUUID(); }
export function saveConfiguration(snapshot, channel, input, id = null) {
  const config = validateConfiguration(channel, input);
  const record = prepare(snapshot, channel);
  const state = record.channels[channel];
  if (state.configurations.some((item) => item.id !== id && item.name.toLowerCase() === config.name.toLowerCase())) {
    throw new Error('Use a unique configuration name within this channel.');
  }
  if (id !== null && !state.configurations.some((item) => item.id === id)) throw new Error('This configuration no longer exists. Retry loading.');
  if (id === null && state.configurations.length >= 100) throw new Error('This channel supports up to 100 preview configurations. Delete one before adding another.');
  const saved = { id: id || revision(), ...config };
  if (id) state.configurations = state.configurations.map((item) => item.id === id ? saved : item);
  else state.configurations.push(saved);
  if (!state.defaultId) state.defaultId = saved.id;
  record.revision = revision();
  return persist(snapshot, record);
}
export function chooseCommunicationDefault(snapshot, channel, id) {
  const record = prepare(snapshot, channel);
  const state = record.channels[channel];
  if (!state.configurations.some((item) => item.id === id)) throw new Error('Choose an existing configuration as default.');
  state.defaultId = id; record.revision = revision();
  return persist(snapshot, record);
}
export function deleteConfiguration(snapshot, channel, id, replacementId = null) {
  const record = prepare(snapshot, channel);
  const state = record.channels[channel];
  if (!state.configurations.some((item) => item.id === id)) throw new Error('This configuration no longer exists. Retry loading.');
  const remaining = state.configurations.filter((item) => item.id !== id);
  if (state.defaultId === id) {
    if (remaining.length && !remaining.some((item) => item.id === replacementId)) throw new Error('Choose a replacement default before deleting the current default.');
    state.defaultId = remaining.length ? replacementId : null;
  }
  state.configurations = remaining; record.revision = revision();
  return persist(snapshot, record);
}
export function resetCommunication(snapshot) {
  assertFresh(snapshot);
  const record = emptyRecord();
  record.revision = revision();
  return persist(snapshot, record);
}