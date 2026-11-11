export const STOCK_STATUS_PATH = '/admin/inventory/stock-status';
export const STOCK_PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Navigation context only. Never put stock responses, lots or balances here.
export function stockListContext(state, owner) {
  const value = state?.stockStatusList;
  if (!owner || value?.owner !== owner) return null;
  return {
    owner,
    search: typeof value.search === 'string' ? value.search.slice(0, 200) : '',
    category: STOCK_PRODUCT_ID.test(value.category || '') ? value.category : '',
    stockStatus: ['all', 'in_stock', 'out_of_stock', 'stock_alert'].includes(value.stockStatus) ? value.stockStatus : 'all',
    productIds: Array.isArray(value.productIds) ? value.productIds.filter((id) => typeof id === 'string' && STOCK_PRODUCT_ID.test(id)).slice(0, 100) : [],
    page: Number.isSafeInteger(value.page) && value.page > 0 ? value.page : 1,
    pageSize: [2, 5, 10, 25].includes(value.pageSize) ? value.pageSize : 5,
  };
}
