import { reportingIdentityGuard, reportingRequest, subscribeSession, getSession, serverDownloadGuard } from '../auth/adminSession.js';
import { releaseBlob } from './downloadRelease.js';

// Only bounded metadata goes to the API. Retry evidence stays in memory, never storage.
const operations = new Map();
const preparations = new Set();
subscribeSession(() => {
  if (['anonymous', 'checking', 'idle'].includes(getSession().status)) operations.clear();
});

export async function downloadBlob(blob, filename, metadata, { guard = reportingIdentityGuard(), signal } = {}) {
  guard();
  signal?.throwIfAborted();
  const key = `${metadata.source}/${metadata.kind}/${metadata.format}`;
  let operation = operations.get(key);
  if (operation?.busy) throw new Error('This download is already being prepared.');
  if (operation) {
    try { operation.guard(); } catch { operations.delete(key); operation = null; }
  }
  operation ||= { id: crypto.randomUUID(), guard };
  operation.busy = true;
  operations.set(key, operation);
  let accepted = false;
  try {
    operation.guard();
    const evidence = await reportingRequest('downloads/initiate', {
      initiation_id: operation.id, ...metadata,
    }, { signal });
    if (!/^[0-9a-f-]{36}$/i.test(evidence?.id || '') || evidence.provenance !== 'browser_reported') {
      throw new Error('Download acceptance could not be confirmed. No file was released. Retry.');
    }
    accepted = true;
    operation.guard();
    signal?.throwIfAborted();
    releaseBlob(blob, filename, operation.guard);
  } catch (cause) {
    if (accepted) throw new Error('Initiation was recorded, but the browser handoff was cancelled or failed. Retry after signing in to initiate another download.');
    throw new Error(`No file was released. Download logging could not be confirmed. Retry this action. ${cause.message || ''}`);
  } finally {
    operation.busy = false;
    // An acknowledged preparation is a completed initiation, even if handoff failed.
    if (accepted && operations.get(key) === operation) operations.delete(key);
  }
}

export function downloadCSV(text, filename, source, kind = 'export') {
  return downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename, { source, kind, format: 'CSV' });
}

export function downloadServerBlob(blob, filename) {
  const guard = serverDownloadGuard(blob);
  releaseBlob(blob, filename, guard);
}

export async function prepareDownload(key, work) {
  if (preparations.has(key)) throw new Error('This download is already being prepared.');
  preparations.add(key);
  try { return await work(); }
  finally { preparations.delete(key); }
}
