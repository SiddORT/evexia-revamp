import { useSyncExternalStore } from 'react';
import { moveStocksStore } from '../services/moveStocksDemo.js';

export function useMoveStocks() {
  const snapshot = useSyncExternalStore(moveStocksStore.subscribe, moveStocksStore.getSnapshot);
  return { snapshot, submitMovement: moveStocksStore.submitMovement };
}
