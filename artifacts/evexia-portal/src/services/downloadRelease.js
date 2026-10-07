// The only file-release primitive. Object URLs used for PDF rendering are not downloads.
export function releaseBlob(blob, filename, guard = () => {}) {
  let url;
  const link = document.createElement('a');
  try {
    guard();
    url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    guard();
    link.click();
  } catch (cause) {
    throw new Error(`Download initiation was recorded, but browser handoff failed. Retry to initiate another download. ${cause?.status === 401 ? 'Your session changed.' : ''}`);
  } finally {
    link.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
