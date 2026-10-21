/** Pre-save candidates only; never persisted in browser storage. */
export function initialCredentials() {
  try {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    const password = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return { password, confirmPassword: password, generationError: '' };
  } catch {
    return { password: '', confirmPassword: '',
      generationError: 'Secure generation is unavailable. Type and confirm a password, or leave both fields blank for server generation.' };
  }
}
