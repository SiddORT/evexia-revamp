import { recordLocalAction } from './localActivity.js';

// Settings-only catalogs. These choices do not select or generate live order documents.
export const BOX_TEMPLATES = Object.freeze([
  Object.freeze({ id: 'evexia-box-reference-v1', name: 'EVEXIA Box · Supplied reference', description: 'Bordered EVEXIA box label with handling instructions and fictional patient and order details.' }),
]);
export const BOTTLE_TEMPLATES = Object.freeze([
  Object.freeze({ id: 'stallergo-bottle-reference-v1', name: 'STALLERGO Bottles · Supplied reference', description: 'Four color-identified vial labels in the supplied two-column, two-row arrangement. Fictional batch and order details.' }),
]);

function createLabelPreference({ key, field, label, templates }) {
  const defaultId = templates[0].id;
  function checkTemplate(id) {
    if (!templates.some((template) => template.id === id)) throw new Error(`Choose a supported ${label} template.`);
    return id;
  }
  function load() {
    let raw;
    try { raw = window.localStorage.getItem(key); }
    catch { throw new Error(`${label} template preferences could not be read. Check browser storage settings.`); }
    if (raw === null) return defaultId;
    let preference;
    try { preference = JSON.parse(raw); }
    catch { throw new Error(`Saved ${label} template preferences are unreadable. Retry loading or reset this preference in Settings > Templates; orders will not be changed.`); }
    if (!preference || Array.isArray(preference) || preference.version !== 1 ||
      Object.keys(preference).length !== 2 || !Object.hasOwn(preference, field) ||
      !templates.some((template) => template.id === preference[field])) {
      throw new Error(`Saved ${label} template preferences are invalid. Retry loading or reset this preference in Settings > Templates; orders will not be changed.`);
    }
    return preference[field];
  }
  function save(id) {
    checkTemplate(id);
    load(); // Unreadable storage requires explicit recovery, never an implicit overwrite.
    try { window.localStorage.setItem(key, JSON.stringify({ version: 1, [field]: id })); }
    catch { throw new Error(`The ${label} template preference could not be saved. Check browser storage settings and try again.`); }
    recordLocalAction('settings', 'settings_changed');
    return id;
  }
  function reset() {
    try { window.localStorage.removeItem(key); }
    catch { throw new Error(`The ${label} template preference could not be reset. Check browser storage settings and try again.`); }
    recordLocalAction('settings', 'settings_changed');
    return defaultId;
  }
  function subscribe(onChange) {
    function refresh(event) {
      if (event.key !== key && event.key !== null) return;
      try { if (event.storageArea !== window.localStorage) return; }
      catch { /* Let the loader surface the access error. */ }
      // Read current storage rather than event.newValue; background refresh never writes.
      let state;
      try { state = { id: load(), error: '' }; }
      catch (error) { state = { id: null, error: error.message }; }
      onChange(state);
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }
  return Object.freeze({ load, save, reset, subscribe, checkTemplate, defaultId });
}

export const boxTemplatePreference = createLabelPreference({
  key: 'evexia.admin.box-label-template.v1', field: 'defaultBoxLabelTemplate', label: 'Box label', templates: BOX_TEMPLATES,
});
export const bottleTemplatePreference = createLabelPreference({
  key: 'evexia.admin.bottle-label-template.v1', field: 'defaultBottleLabelTemplate', label: 'Bottle label', templates: BOTTLE_TEMPLATES,
});

// Source sheet size is metadata, deliberately separate from the cropped readable artwork.
// All variable fields are fixed fictional examples, not clinical or date calculations.
export function makeSampleBoxLabelDocument(templateId) {
  boxTemplatePreference.checkTemplate(templateId);
  return {
    type: 'box', templateId, sourceSheet: { width: 598.08, height: 841.92, unit: 'pt' },
    model: {
      isSample: true, patientName: 'Sample Patient', doctorName: 'Dr. Sample Clinician',
      orderDate: '01-10-2026', orderNumber: 'SAMPLE-ORDER-001', allergens: ['Mite (D Farinae)'],
    },
  };
}

export function makeSampleBottleLabelDocument(templateId) {
  bottleTemplatePreference.checkTemplate(templateId);
  return {
    type: 'bottle', templateId, sourceSheet: { width: 864, height: 1296, unit: 'pt' },
    model: {
      isSample: true, orderNumber: 'SAMPLE-ORDER-001', batchNumber: 'SAMPLE-BATCH-001',
      manufactured: 'Oct-2026', expires: 'Sep-2028', allergen: 'MITE (D FARINAE)',
      vials: [
        { number: 1, color: '#f28a00', volume: '6 ml', strength: '0.2 BAU/ML' },
        { number: 2, color: '#00a35c', volume: '5.5 ml', strength: '2 BAU/ML' },
        { number: 3, color: '#3c2787', volume: '6 ml', strength: '20 BAU/ML' },
        { number: 4, color: '#e50087', volume: '5.5 ml', strength: '200 BAU/ML' },
      ],
    },
  };
}
