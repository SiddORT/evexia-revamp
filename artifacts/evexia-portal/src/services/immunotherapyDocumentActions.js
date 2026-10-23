// Row documents have independent template identities; these are not bulk PRINT_KINDS.
export const IMMUNOTHERAPY_DOCUMENT_ACTIONS = Object.freeze([
  Object.freeze({ key: 'box-labels', document: 'Box labels', label: 'Print box labels', intent: 'print' }),
  Object.freeze({ key: 'instructions', document: 'Instructions', label: 'Print instructions', intent: 'print' }),
  Object.freeze({ key: 'bottle-labels', document: 'Bottle labels', label: 'Print bottle labels', intent: 'print' }),
  Object.freeze({ key: 'shipping-address', document: 'Shipping address', label: 'Download shipping address', intent: 'download' }),
  Object.freeze({ key: 'abroad-letter', document: 'Abroad letter', label: 'Download abroad letter', intent: 'download' }),
  Object.freeze({ key: 'invoice', document: 'Invoice', label: 'Download invoice', intent: 'download' }),
]);
