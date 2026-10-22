/** Pre-save candidates only; never persisted in browser storage. */
export function initialCredentials({ mr = false } = {}) {
  try {
    if (!mr) {
      const bytes = new Uint8Array(24);
      globalThis.crypto.getRandomValues(bytes);
      const password = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return { password, confirmPassword: password, generationError: '' };
    }
    const groups = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@#$%^&*_-+?'];
    const pick = (length) => {
      const bytes = new Uint8Array(1);
      const bound = 256 - (256 % length);
      do { globalThis.crypto.getRandomValues(bytes); } while (bytes[0] >= bound);
      return bytes[0] % length;
    };
    const alphabet = groups.join('');
    const chars = groups.map((group) => group[pick(group.length)]);
    while (chars.length < 15) chars.push(alphabet[pick(alphabet.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const password = chars.join('');
    return { password, confirmPassword: password, generationError: '' };
  } catch {
    return { password: '', confirmPassword: '',
      generationError: 'Secure generation is unavailable. Type and confirm a password, or leave both fields blank for server generation.' };
  }
}
