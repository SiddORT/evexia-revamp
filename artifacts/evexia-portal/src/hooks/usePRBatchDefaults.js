import { useEffect, useRef, useState } from 'react';
import { useAdminSession } from '../auth/AdminBoundary.jsx';
import { allocatePRBatches, loadPRBatchSettings, ownerPR } from '../services/serverPurchaseReceived.js';

/**
 * One captured policy + durable allocation request per mounted PO initialization.
 * Neither drafts nor policy tokens enter browser storage. Abandoned allocations
 * remain server-owned gaps; a kept uncertain request always retries the same body.
 */
export default function usePRBatchDefaults({ poId, rows, receipt, sourceLoading, setValues, owner }) {
  const session = useAdminSession();
  const identity = session?.user?.id;
  const context = useRef(null);
  const live = useRef({});
  live.current = { poId, identity };
  const mounted = useRef(true);
  const [state, setState] = useState({ phase: 'idle', message: '' });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; context.current = null; }; }, []);
  const valid = (ctx) => mounted.current && context.current === ctx && live.current.poId === ctx.poId
    && live.current.identity === owner && ownerPR() === owner;

  async function run(ctx) {
    if (!valid(ctx) || ctx.running) return;
    ctx.running = true;
    setState({ phase: ctx.policy ? 'allocating' : 'loading', message: '' });
    try {
      if (!ctx.policy) {
        const policy = await loadPRBatchSettings();
        if (!valid(ctx)) return;
        ctx.policy = policy;
      }
      if (ctx.policy.mode !== 'manual') {
        ctx.request ||= { idempotencyKey: crypto.randomUUID(), poId: ctx.poId,
          lineIds: ctx.lineIds, policyToken: ctx.policy.policyToken };
        setState({ phase: 'allocating', message: '' });
        const result = await allocatePRBatches(ctx.request);
        if (!valid(ctx)) return;
        for (const line of result.lines) ctx.allocated.set(line.lineId, line.batchNo);
        setValues((current) => !valid(ctx) || current.poId !== ctx.poId ? current : {
          ...current,
          rows: current.rows.map((row) => ctx.allocated.has(row.lineId) && !ctx.touched.has(row.lineId) && row.batchNo === ''
            ? { ...row, batchNo: ctx.allocated.get(row.lineId) } : row),
        });
      }
      if (valid(ctx)) setState({ phase: 'ready', mode: ctx.policy.mode, message: '' });
    } catch (cause) {
      if (valid(ctx)) setState({ phase: 'error', message: `${cause.message} Your entries are kept. ${ctx.request ? 'Retry uses the same allocation identity, not a replacement number.' : 'Retry loading the shared setting; no local mode was substituted.'}` });
    } finally { ctx.running = false; }
  }

  useEffect(() => {
    if (identity !== owner) {
      context.current = null;
      setState({ phase: 'error', message: 'The signed-in account changed. This draft cannot allocate batches for another account.' });
      return;
    }
    if (context.current && context.current.poId !== poId) context.current = null;
    if (!poId || sourceLoading || context.current) return;
    const savedIds = new Set(receipt?.lines.map((line) => line.lineId) || []);
    const lineIds = rows.filter((row) => !savedIds.has(row.lineId)).map((row) => row.lineId);
    if (!lineIds.length) {
      setState({ phase: 'ready', message: '' });
      return;
    }
    const ctx = { poId, lineIds, policy: null, request: null, touched: new Set(), allocated: new Map(), running: false };
    context.current = ctx;
    run(ctx);
  }, [poId, rows, receipt, sourceLoading, identity, owner]);

  return {
    ...state,
    // Do not allow review before the first effect captures policy for new rows.
    blocked: identity !== owner || (rows.some((row) => !receipt?.lines.some((line) => line.lineId === row.lineId))
      && (!context.current || state.phase !== 'ready')),
    retry: () => { if (context.current) run(context.current); },
    touch: (lineId) => { context.current?.touched.add(lineId); },
    restore: (row) => {
      const ctx = context.current;
      const allocated = ctx?.allocated.get(row.lineId);
      return allocated && !ctx.touched.has(row.lineId) && row.batchNo === '' ? { ...row, batchNo: allocated } : row;
    },
    invalidate: () => { context.current = null; setState({ phase: 'idle', message: '' }); },
  };
}
