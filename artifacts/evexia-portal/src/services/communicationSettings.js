import { communicationRequest } from '../auth/adminSession.js';

export const CHANNELS = ['email', 'sms', 'waba'];
const FIELDS = {
  smtp: ['name', 'host', 'port', 'security', 'username', 'fromName', 'fromEmail'],
  email: ['name', 'provider', 'endpoint', 'fromName', 'fromEmail'],
  sms: ['name', 'provider', 'senderId', 'endpoint', 'dltEntityId', 'dltTemplateId'],
  waba: ['name', 'provider', 'endpoint', 'businessAccountId', 'phoneNumberId', 'senderPhone', 'apiVersion'],
};
export function configurationFields(channel, type) {
  if (!CHANNELS.includes(channel) || !(channel === 'email' ? ['smtp', 'api', 'platform'] : ['api']).includes(type)) {
    throw new Error('Choose a valid channel and configuration type.');
  }
  return [...FIELDS[type === 'smtp' ? 'smtp' : channel]];
}

export function validateConfiguration(channel, input) {
  const fields = configurationFields(channel, input?.type);
  if (Object.keys(input).some((key) => ![...fields, 'type', 'secret'].includes(key))) throw new Error('Unsupported configuration field.');
  const result = { type: input.type };
  for (const field of fields) {
    const raw = input[field] ?? '';
    if (typeof raw !== 'string') throw new Error('Configuration values must be text.');
    const value = raw.trim();
    if ((!value && !['dltEntityId', 'dltTemplateId', 'apiVersion'].includes(field)) ||
        value.length > (field === 'endpoint' ? 500 : 160) || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error('Complete required fields using valid, bounded text.');
    }
    result[field] = value;
  }
  if (result.endpoint) {
    let url;
    try { url = new URL(result.endpoint); } catch { throw new Error('Use an absolute HTTPS endpoint.'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || /[\s\\?#@]/.test(result.endpoint)) {
      throw new Error('Use HTTPS without embedded credentials, query parameters or fragments.');
    }
  }
  if (input.secret !== undefined && input.secret !== '') {
    if (typeof input.secret !== 'string' || !input.secret.trim() || input.secret.length > 4096 || /[\u0000-\u001f\u007f]/.test(input.secret)) {
      throw new Error('Enter a valid credential of at most 4096 characters.');
    }
    result.secret = input.secret;
  }
  return result;
}

export function snapshotFromResponse(data) {
  try {
    if (!data?.channels || Object.keys(data.channels).length !== 3) throw new Error();
    const channels = {};
    for (const channel of CHANNELS) {
      const state = data.channels[channel];
      if (!Number.isInteger(state.version) || state.version < 1 || !Array.isArray(state.configurations) || state.configurations.length > 100) throw new Error();
      const configurations = state.configurations.map((record) => {
        if (!/^[0-9a-f-]{36}$/i.test(record.id) || !Number.isInteger(record.version) || record.version < 1 ||
          record.credentialPresent !== true || Object.keys(record).some((k) => !['id', 'type', 'version', 'values', 'credentialPresent'].includes(k))) throw new Error();
        const values = validateConfiguration(channel, { ...record.values, type: record.type });
        if ('secret' in values) throw new Error();
        return { ...values, id: record.id, version: record.version, credentialPresent: true };
      });
      if (configurations.length ? !configurations.some((r) => r.id === state.defaultId) : state.defaultId !== null) throw new Error();
      channels[channel] = { version: state.version, configurations, defaultId: state.defaultId };
    }
    return { record: { channels } };
  } catch {
    const error = new Error('Communication returned an invalid response. Load latest settings before retrying.');
    error.ambiguous = true;
    throw error;
  }
}

export async function loadCommunicationSnapshot(options) {
  return snapshotFromResponse(await communicationRequest('', undefined, options));
}
function versions(snapshot, channel, id) {
  const state = snapshot?.record.channels[channel];
  const record = state?.configurations.find((r) => r.id === id);
  if (!record) throw new Error('Configuration no longer exists. Load latest settings.');
  return { channelVersion: state.version, version: record.version };
}
export async function saveConfiguration(snapshot, channel, input, id = null, expectedVersion) {
  const { type, secret, ...values } = validateConfiguration(channel, input);
  if (!id && !secret) throw new Error('Enter the credential for this configuration.');
  const body = { channel, type, values, channelVersion: snapshot.record.channels[channel].version, ...(secret ? { secret } : {}) };
  if (id) body.version = expectedVersion ?? versions(snapshot, channel, id).version;
  return snapshotFromResponse(await communicationRequest(id ? `/${id}/edit` : '', body));
}
export async function chooseCommunicationDefault(snapshot, channel, id) {
  return snapshotFromResponse(await communicationRequest(`/${id}/default`, versions(snapshot, channel, id)));
}
export async function deleteConfiguration(snapshot, channel, id, replacementId = null) {
  return snapshotFromResponse(await communicationRequest(`/${id}/delete`, { ...versions(snapshot, channel, id), replacementId }));
}
