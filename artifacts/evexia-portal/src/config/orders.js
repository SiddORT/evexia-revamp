// Order destinations have independent persistence and authorization boundaries.
// A saved order does not imply payment, clinical work or fulfilment.
export const ORDER_DESTINATIONS = [
  { slug: 'immunotherapy', label: 'IMMUNOTHERAPY' },
  { slug: 'kits-consumables', label: 'KITS & CONSUMABLES', keywords: 'kits consumables lancets applicators', description: 'Covers kits, lancets and applicators.' },
  { slug: 'spt', label: 'SPT' },
  { slug: 'lupin', label: 'LUPIN' },
];
