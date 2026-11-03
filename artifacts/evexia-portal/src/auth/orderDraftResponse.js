const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const textFields = {
  immunotherapy: ['patientId', 'doctorId', 'mrId', 'dosage', 'histamine', 'saline', 'remarks', 'shipping', 'poNumber', 'pricingBasis'],
  kits: ['orderFor', 'doctorId', 'mrId', 'patientId', 'lancets', 'applicators', 'tray', 'shipping', 'remarks'],
  lupin: ['doctorId', 'mrId', 'patientCount', 'price', 'remarks'],
};

// Entry-state validation, not clinical completeness. Blank text is intentional.
// Staff without file-read access receive opaque, restricted attachment metadata.
export function validOrderDraft(value, kind, id) {
  if (!textFields[kind] || !uuid(id) || value?.id !== id || value.kind !== kind
      || !Number.isSafeInteger(value.version) || value.version < 1
      || typeof value.updatedAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.updatedAt)
      || !Number.isFinite(Date.parse(value.updatedAt))
      || !object(value.payload) || !object(value.payload.values)) return false;
  const payload = value.payload, values = payload.values;
  if (textFields[kind].some((key) => typeof values[key] !== 'string')
      || !Array.isArray(values.attachments) || values.attachments.length > 10
      || values.attachments.some((file) => !object(file) || !uuid(file.id) || typeof file.name !== 'string'
        || (file.restricted !== true && (!Number.isSafeInteger(file.size) || file.size <= 0
          || typeof file.type !== 'string' || file.state !== 'verified')))) return false;
  if (payload.allergenEntries !== undefined && (!object(payload.allergenEntries)
      || Object.values(payload.allergenEntries).some((entry) => !object(entry)))) return false;
  if (payload.linked !== undefined && (!Array.isArray(payload.linked)
      || payload.linked.some((patient) => !object(patient) || !uuid(patient.id)))) return false;
  if (kind === 'immunotherapy') {
    return Array.isArray(values.groups) && values.groups.every((group) => object(group)
      && typeof group.id === 'string' && Array.isArray(group.items)
      && group.items.every((item) => object(item)));
  }
  if (kind === 'kits') {
    return object(values.kit) && ['product', 'custom', 'volume', 'quantity'].every((key) => typeof values.kit[key] === 'string')
      && object(values.other) && typeof values.other.name === 'string' && typeof values.other.phone === 'string'
      && object(values.other.address) && Object.values(values.other.address).every((item) => typeof item === 'string');
  }
  return Array.isArray(values.patientIds) && values.patientIds.every(uuid);
}
