import { useCallback } from 'react';
import PurchaseOrderReferenceSelect from './PurchaseOrderReferenceSelect.jsx';
import { referencePR } from '../../services/serverPurchaseReceived.js';

export default function ReceiptReferenceSelect({ kind, ...props }) {
  const fetcher = useCallback(async (_kind, params, signal) => {
    const page = await referencePR(kind, params, signal);
    return kind === 'staff' ? { ...page, pageItemCount: page.items.length, items: [{ id: 'other', name: 'Others' }, ...page.items] } : page;
  }, [kind]);
  return <PurchaseOrderReferenceSelect {...props} kind={kind} fetcher={fetcher} />;
}
