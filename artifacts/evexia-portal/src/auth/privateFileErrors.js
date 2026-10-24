const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Never display provider/validator text, paths or filenames from error responses.
const MESSAGES = Object.freeze({
  invalid_filename: 'Use a supported PDF or image filename without paths or control characters.',
  kits_attachment_metadata: 'Use a nonempty PDF or image filename of at most 255 characters.',
  prescription_metadata: 'Use a nonempty PDF or image filename of at most 255 characters.',
  kits_attachment: 'Supply one nonempty PDF or image within the upload limit.',
  prescription_file: 'Supply exactly one prescription file.',
  prescription_empty: 'The selected prescription is empty. Choose a nonempty file.',
  prescription_size: 'The prescription byte size is unreadable or exceeds the upload limit. Review the selected file.',
  unsupported_type: 'Choose a matching PDF, JPEG, PNG or WebP file.',
  invalid_file: 'File verification failed. Choose a supported, nonempty PDF or image within the upload limit.',
  file_too_large: 'The file exceeds the upload limit.',
  file_rate_limit: 'Too many file operations. Wait before retrying this draft.',
  file_capacity: 'The upload service is busy. Wait before retrying this draft.',
  operation_busy: 'A file operation is already running. Wait before retrying.',
  file_operation_unavailable: 'File operation cleanup could not be confirmed. Ask the operator to review its private state before retrying.',
  storage_unavailable: 'Private storage could not be initialized. Ask the operator to check its explicit configuration and access before retrying.',
  storage_write_failed: 'Private storage could not complete the write. Cleanup is pending; ask the operator to check storage before retrying.',
  upload_read_failed: 'The service could not read the upload bytes. Retry the selected original file explicitly.',
  scanner_unavailable: 'A real malware scanner is unavailable. The file remains private and quarantined, not attached. Ask the operator to restore scanning.',
  scanner_failed: 'Malware scanning failed. The file remains private and quarantined, not attached. Ask the operator to review scanning.',
  file_scan_rejected: 'Malware scanning rejected this file. It is not attached. Choose a different clean file.',
  file_not_verified: 'The private file is not verified. Ask the operator to review verification before retrying.',
  kits_upload_timeout: 'The upload timed out. Retry explicitly when the connection is available.',
  prescription_timeout: 'The upload timed out. Retry explicitly when the connection is available.',
});

export function privateUploadMessage(code, status) {
  return (Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : '')
    || (status === 401 ? 'Check your sign-in before retrying this draft.'
      : status === 403 ? 'Access was denied. Ask an administrator to review your access.'
      : status === 404 ? 'The private file is unavailable. Retry the selected original file if this upload was not attached.'
      : status === 413 ? 'The request exceeds the service limit. Review the selected file sizes.'
      : status === 415 || status === 422 ? 'Upload validation failed. Review the filename, supported type and byte limit.'
      : status === 429 ? 'The service is busy. Wait before retrying.'
      : 'The service could not complete or confirm this step. Check your connection; ask the operator to review the request if it persists.');
}

export const privateRequestReference = (value) => typeof value === 'string' && UUID.test(value)
  ? ` Request reference: ${value}.` : '';
export const privateFileId = (value) => typeof value === 'string' && UUID.test(value) ? value : undefined;
