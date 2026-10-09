import { useState } from 'react';
import { getSession } from '../auth/adminSession.js';

// Ephemeral UUID continuation only. Never cache server records in local storage.
export default function useDirectoryContinuation(params) {
  const scope = JSON.stringify({ ...params, actor: getSession().user?.id });
  const [position, setPosition] = useState({ scope, cursor: null });
  const cursor = position.scope === scope ? position.cursor : null;
  return {
    params: { ...params, ...(cursor ? { cursor } : {}) },
    next: (result) => { if (result?.nextCursor) setPosition({ scope, cursor: result.nextCursor }); },
    restart: () => setPosition({ scope, cursor: null }),
  };
}
