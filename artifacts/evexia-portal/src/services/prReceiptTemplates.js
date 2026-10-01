export const PR_TEMPLATE_KEY = 'evexia.admin.pr-receipt-template.v1';
export const PR_TEMPLATES = [
  {
    id: 'classic',
    name: 'EVEXIA Classic',
    description: 'A formal Purchase Received record with source quantities, acceptance outcomes and an unsigned acknowledgement box.',
  },
];

function checkTemplate(id) {
  if (!PR_TEMPLATES.some((template) => template.id === id)) {
    throw new Error('Choose a supported Purchase Received template.');
  }
  return id;
}

export function loadPRTemplatePreference() {
  let raw;
  try {
    raw = window.localStorage.getItem(PR_TEMPLATE_KEY);
  } catch {
    throw new Error('Purchase Received template preferences could not be read. Check browser storage settings.');
  }
  if (raw === null) return 'classic';

  let preference;
  try {
    preference = JSON.parse(raw);
  } catch {
    throw new Error('Saved Purchase Received template preferences are unreadable. Reset the PR template preference in Settings > Templates; purchase orders and receipts will not be changed.');
  }
  if (!preference || Array.isArray(preference) || preference.version !== 1 ||
    Object.keys(preference).length !== 2 || !Object.hasOwn(preference, 'defaultPRReceiptTemplate') ||
    !PR_TEMPLATES.some((template) => template.id === preference.defaultPRReceiptTemplate)) {
    throw new Error('Saved Purchase Received template preferences are invalid. Reset the PR template preference in Settings > Templates; purchase orders and receipts will not be changed.');
  }
  return preference.defaultPRReceiptTemplate;
}

export function setDefaultPRTemplate(id) {
  checkTemplate(id);
  loadPRTemplatePreference();
  try {
    window.localStorage.setItem(PR_TEMPLATE_KEY, JSON.stringify({
      version: 1,
      defaultPRReceiptTemplate: id,
    }));
  } catch {
    throw new Error('The Purchase Received template could not be saved. Check browser storage settings and try again.');
  }
  return id;
}

export function resetPRTemplatePreference() {
  try {
    window.localStorage.removeItem(PR_TEMPLATE_KEY);
  } catch {
    throw new Error('The Purchase Received template preference could not be reset. Check browser storage settings and try again.');
  }
  return 'classic';
}