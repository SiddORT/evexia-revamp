import { recordLocalAction } from './localActivity.js';

// Settings samples only. Not imported by order actions, document exports or tax logic.
function catalog(id, name, description) {
  return Object.freeze([Object.freeze({ id, name, description })]);
}

export const INSTRUCTIONS_TEMPLATES = catalog('evexia-instructions-dd-reference-v1',
  'EVEXIA Instructions · Double dilution reference',
  'Supplied English/Hindi double-dilution schedule with four bottle tables. Reference wording only, not medically validated or applicable to every order.');
export const ABROAD_LETTER_TEMPLATES = catalog('evexia-abroad-letter-reference-v1',
  'EVEXIA Abroad letter · Supplied reference',
  'Branded confirmation-letter sample with fictional patient and doctor details and a visibly unsigned authorization area.');
export const SHIPPING_ADDRESS_TEMPLATES = catalog('evexia-shipping-address-reference-v1',
  'EVEXIA Shipping address · Supplied reference',
  'Compact bordered TO/FROM panel with separate checking details; fictional recipient, no real contact or signature. Full reference sheet framing is available.');
export const IMMUNOTHERAPY_INVOICE_TEMPLATES = catalog('evexia-immunotherapy-invoice-reference-v1',
  'EVEXIA Immunotherapy order invoice · Supplied reference',
  'Portrait sample invoice with illustrative totals, fictional payment details, nonfunctional QR placeholder and unsigned authorization. Separate from supplier PO invoices.');

function createSamplePreference({ type, label, templates }) {
  const key = `evexia.admin.${type}-template.v1`;
  const field = 'defaultTemplate';
  const defaultId = templates[0].id;
  function checkTemplate(id) {
    if (!templates.some((template) => template.id === id)) throw new Error(`Choose a supported ${label} template.`);
    return id;
  }
  function load() {
    let raw;
    try { raw = window.localStorage.getItem(key); }
    catch { throw new Error(`${label} template preference could not be read. Check browser storage settings.`); }
    if (raw === null) return defaultId;
    let saved;
    try { saved = JSON.parse(raw); }
    catch { throw new Error(`Saved ${label} template preference is unreadable. Retry loading or reset only this preference; orders will not change.`); }
    if (!saved || Array.isArray(saved) || saved.version !== 1 || Object.keys(saved).length !== 2 ||
      !Object.hasOwn(saved, field) || !templates.some((template) => template.id === saved[field])) {
      throw new Error(`Saved ${label} template preference is invalid. Retry loading or reset only this preference; orders will not change.`);
    }
    return saved[field];
  }
  function save(id) {
    checkTemplate(id);
    load(); // Explicit retry/reset owns recovery, never overwrite unreadable preferences.
    try { window.localStorage.setItem(key, JSON.stringify({ version: 1, [field]: id })); }
    catch { throw new Error(`${label} template preference could not be saved. Check browser storage settings and try again.`); }
    recordLocalAction('settings', 'settings_changed');
    return id;
  }
  function reset() {
    try { window.localStorage.removeItem(key); }
    catch { throw new Error(`${label} template preference could not be reset. Check browser storage settings and try again.`); }
    recordLocalAction('settings', 'settings_changed');
    return defaultId;
  }
  function subscribe(onChange) {
    function refresh(event) {
      if (event.key !== key && event.key !== null) return;
      try { if (event.storageArea !== window.localStorage) return; }
      catch { /* Surface storage access failure through load. */ }
      let next;
      try { next = { id: load(), error: '' }; }
      catch (error) { next = { id: null, error: error.message }; }
      onChange(next); // Read only: never persist an event payload or repair in the background.
    }
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }
  return Object.freeze({ load, save, reset, subscribe, checkTemplate, defaultId });
}

export const instructionsTemplatePreference = createSamplePreference({
  type: 'immunotherapy-instructions', label: 'Instructions', templates: INSTRUCTIONS_TEMPLATES,
});
export const abroadLetterTemplatePreference = createSamplePreference({
  type: 'immunotherapy-abroad-letter', label: 'Abroad letter', templates: ABROAD_LETTER_TEMPLATES,
});
export const shippingAddressTemplatePreference = createSamplePreference({
  type: 'immunotherapy-shipping-address', label: 'Shipping address', templates: SHIPPING_ADDRESS_TEMPLATES,
});
export const immunotherapyInvoiceTemplatePreference = createSamplePreference({
  type: 'immunotherapy-order-invoice', label: 'Immunotherapy order invoice', templates: IMMUNOTHERAPY_INVOICE_TEMPLATES,
});

const sampleTypes = {
  instructions: { preference: instructionsTemplatePreference, sourceSheet: { width: 1024, height: 910, unit: 'px' } },
  'abroad-letter': { preference: abroadLetterTemplatePreference, sourceSheet: { width: 1024, height: 517, unit: 'px' } },
  'shipping-address': { preference: shippingAddressTemplatePreference, sourceSheet: { width: 598.08, height: 841.92, unit: 'pt' } },
  'immunotherapy-invoice': { preference: immunotherapyInvoiceTemplatePreference, sourceSheet: { width: 595.28, height: 841.89, unit: 'pt' } },
};

// Fixed fictional sample values: no order lookup, clinical inference or invoice calculation.
export function makeSampleImmunotherapyDocument(type, templateId) {
  if (!Object.hasOwn(sampleTypes, type)) throw new Error('Choose a supported sample document type.');
  const config = sampleTypes[type];
  config.preference.checkTemplate(templateId);
  return {
    type, templateId, sourceSheet: { ...config.sourceSheet },
    model: {
      isSample: true, patientName: 'Sample Patient', doctorName: 'Dr. Sample Clinician',
      orderNumber: 'SAMPLE-ORDER-001', date: '23 October 2026', dose: 'Double Dilution',
      allergen: 'Mite (D Farinae)', recipientName: 'Dr. Sample Recipient',
      recipientAddress: ['Sample Clinic, 12 Example Road', 'Sample City, Sample State - 123456'],
      recipientContact: 'Not provided (sample)', checkedBy: 'Sample Checker', checkerContact: 'Not provided (sample)',
      invoiceNumber: 'SAMPLE-INV-001', invoiceDate: '23-10-2026', supplyDate: '23 Oct 2026',
      doctorAddress: ['Sample Clinic, 12 Example Road', 'Sample City, Sample State - 123456'],
      patientAddress: ['34 Example Lane', 'Sample City, Sample State - 123456'],
      items: [
        { description: 'House Dust (sample)', hsn: '30049099', batch: 'SAMPLE-BATCH-001', taxable: '1,500.00' },
        { description: 'Saw Dust (sample)', hsn: '30049099', batch: 'SAMPLE-BATCH-002', taxable: '1,500.00' },
      ],
      figures: {
        discount: '0.00', beforeTax: '3,000.00', taxLabel: 'Add: IGST (12%) — illustrative',
        tax: '360.00', roundOff: '0.00', total: '3,360.00', words: 'Three Thousand Three Hundred Sixty Rupees Only',
      },
    },
  };
}
