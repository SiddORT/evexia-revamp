import { useState } from 'react';
import { getSession } from '../auth/adminSession.js';
import { continuationPosition } from './directoryContinuationState.js';

// Ephemeral UUID continuation only. Never cache server records in local storage.
export default function useDirectoryContinuation(params) {
  const scope = JSON.stringify({ ...params, actor: getSession().user?.id });
  const [position, setPosition] = useState({ scope, cursor: null });
  const current = continuationPosition(position, scope);
  // Adjust during render, not a delayed effect: returning to an old query must
  // never revive its previous cursor or issue a request with that stale cursor.
  if (current !== position) setPosition(current);
  const cursor = current.cursor;
  return {
    params: { ...params, ...(cursor ? { cursor } : {}) },
    next: (result) => { if (result?.nextCursor) setPosition({ scope, cursor: result.nextCursor }); },
    restart: () => setPosition({ scope, cursor: null }),
  };
}
