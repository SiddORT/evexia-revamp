import { reportingRequest } from '../auth/adminSession.js';

export const loadEmailLogs = (filters, options) => reportingRequest('emails', filters, options);
export async function inviteAccount(kind, record) {
  const data = await reportingRequest(`invitations/${kind}/${record.id}`, { expected_version: record.version });
  if (!data?.id || !['pending', 'sending', 'smtp_accepted', 'failed', 'unknown'].includes(data.status)
      || typeof data.message !== 'string') {
    throw new Error('Invitation outcome is unknown. Check Email Logs before sending again.');
  }
  return data;
}
