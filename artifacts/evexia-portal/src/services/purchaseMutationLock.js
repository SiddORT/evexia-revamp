export const PURCHASE_MUTATION_LOCK = 'evexia.purchase-orders-and-received.mutations.v1';
export const PR_KEY = 'evexia.admin.purchase-received.v1';

export async function withPurchaseMutationLock(operation) {
  const locks = globalThis.navigator?.locks;
  if (!locks || typeof locks.request !== 'function') {
    throw new Error('Purchase Order and Purchase Received changes require browser Web Locks. Use a supported browser and refresh before retrying.');
  }
  return locks.request(PURCHASE_MUTATION_LOCK, { mode: 'exclusive' }, operation);
}