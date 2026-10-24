import { useRef, useState } from 'react';
import { reportingIdentityGuard } from '../auth/adminSession.js';
import { prescriptionMetadata, uploadPrescription, validateAttachments } from '../services/serverImmunotherapy.js';

// Keep local selections visible independently of server attachment evidence.
// Removing a row invalidates its response; it never deletes the private file.
export default function usePrescriptionSelections({ patientId, attachments, policy, allowed, busy, alive, setPending, attachVerified, setFileMsg }) {
  const [uploads, setUploads] = useState([]);
  const rows = useRef(new Map());
  const publish = () => setUploads([...rows.current.values()]);
  const clearUploads = () => { rows.current.clear(); publish(); };
  const removeUpload = (key) => { rows.current.delete(key); publish(); };
  const update = (row, patch) => {
    if (rows.current.get(row.key) !== row) return;
    Object.assign(row, patch); publish();
  };

  async function run(batch, recover = false) {
    if (busy.current) return;
    const guard = reportingIdentityGuard();
    const selectedPatient = patientId;
    busy.current = true; setPending('upload');
    try {
      for (const row of batch) {
        if (!alive.current) return;
        if (rows.current.get(row.key) !== row) continue;
        update(row, { state: 'uploading', message: recover ? 'Checking private file — not attached yet.' : 'Uploading privately — not attached yet.' });
        try {
          if (!recover) {
            // Read only a bounded slice, never clone/spread the native File.
            // Size metadata alone does not prove the browser can still read it.
            try {
              const bytes = await row.file.slice(0, Math.min(row.file.size, 1024)).arrayBuffer();
              if (!bytes.byteLength) throw new Error('empty read');
            } catch {
              throw new Error(`The browser cannot read the selected file (${row.size} bytes; limit ${policy.maxBytes} bytes). Reselect the original file and retry.`);
            }
            guard();
            if (!alive.current || rows.current.get(row.key) !== row) continue;
          }
          const result = recover ? await prescriptionMetadata(row.id) : await uploadPrescription(row.file, selectedPatient);
          guard();
          if (!alive.current) return;
          if (rows.current.get(row.key) !== row) continue;
          update(row, { id: result.id });
          if (result.state === 'verified' && result.scanner_status === 'clean') {
            attachVerified(result, selectedPatient);
            removeUpload(row.key);
          } else {
            const rejected = result.state === 'rejected' || result.scanner_status === 'infected';
            update(row, { id: result.id, state: rejected ? 'rejected' : 'unverified',
              message: `Not attached: file ${result.state}; scanner ${result.scanner_status}. ${rejected ? 'Choose a different clean file.' : 'Check availability again after scanning completes.'}` });
          }
        } catch (error) {
          if (!alive.current) return;
          update(row, { id: error.fileId || row.id, state: [413, 415, 422].includes(error.status) ? 'rejected' : 'failed', message: `Not attached. ${error.message}` });
          try { guard(); } catch {
            for (const queued of batch) if (queued.state === 'queued') update(queued, { state: 'failed', message: 'Not uploaded: session changed. Retry after signing in.' });
            break;
          }
        }
      }
    } finally {
      busy.current = false;
      if (alive.current) setPending('');
    }
  }

  function addFiles(list) {
    const ready = allowed && !busy.current && policy && patientId;
    let count = attachments.length + [...rows.current.values()].filter((row) => !['rejected', 'failed'].includes(row.state)).length;
    const selected = Array.from(list || []); // Capture before the input is cleared.
    const batch = selected.map((file) => {
      const problem = !ready ? 'Choose a patient and load the upload policy before retrying.'
        : validateAttachments([file], [], policy.maxBytes) || (count >= policy.maxFiles ? `Select at most ${policy.maxFiles} prescription files.` : '');
      if (!problem) count += 1;
      return { key: crypto.randomUUID(), name: file.name, size: file.size, file, patientId, state: problem ? 'rejected' : 'queued',
        message: problem ? `Not attached. ${problem}` : 'Waiting to upload — not attached yet.' };
    });
    // Stage the whole selection before the first asynchronous upload starts.
    for (const row of batch) rows.current.set(row.key, row);
    publish(); setFileMsg('');
    if (ready) void run(batch.filter((row) => row.state === 'queued'));
  }

  function retryUpload(key) {
    const row = rows.current.get(key);
    if (!row || busy.current || !allowed || !policy || row.patientId !== patientId) return;
    const problem = validateAttachments([row.file], [], policy.maxBytes);
    const count = attachments.length + [...rows.current.values()].filter((other) => other !== row && !['rejected', 'failed'].includes(other.state)).length;
    if (problem || count >= policy.maxFiles) {
      update(row, { state: 'rejected', message: `Not attached. ${problem || `Select at most ${policy.maxFiles} prescription files.`}` });
      return;
    }
    void run([row], Boolean(row.id));
  }
  return { uploads, addFiles, removeUpload, retryUpload, clearUploads };
}
