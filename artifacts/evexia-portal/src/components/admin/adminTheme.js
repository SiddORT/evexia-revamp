export const ADMIN_THEME_KEY = 'evexia.admin.theme';
export const ADMIN_THEMES = {
  classic: 'EVEXIA Classic',
  modern: 'EVEXIA Modern',
};
export const ADMIN_APPEARANCE_KEY = 'evexia.admin.appearance';
export const ADMIN_APPEARANCES = { light: 'Light', dark: 'Dark' };

export function readAdminTheme() {
  try {
    const saved = window.localStorage.getItem(ADMIN_THEME_KEY);
    return Object.hasOwn(ADMIN_THEMES, saved) ? saved : 'classic';
  } catch {
    return 'classic';
  }
}

export function saveAdminTheme(theme) {
  if (!Object.hasOwn(ADMIN_THEMES, theme)) return;
  try {
    window.localStorage.setItem(ADMIN_THEME_KEY, theme);
  } catch {
    // The active choice still works for this visit when storage is unavailable.
  }
}

export function readAdminAppearance() {
  try {
    const saved = window.localStorage.getItem(ADMIN_APPEARANCE_KEY);
    return Object.hasOwn(ADMIN_APPEARANCES, saved) ? saved : 'light';
  } catch {
    return 'light';
  }
}

export function saveAdminAppearance(appearance) {
  if (!Object.hasOwn(ADMIN_APPEARANCES, appearance)) return;
  try {
    window.localStorage.setItem(ADMIN_APPEARANCE_KEY, appearance);
  } catch {
    // The active choice still works for this visit when storage is unavailable.
  }
}