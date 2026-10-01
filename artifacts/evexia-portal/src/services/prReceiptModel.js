const quantityMilli = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) return null;
  return Math.round(number * 1000);
};

const HISTORY_EXPLANATION =
  'This older receipt has no saved post-receipt balance. Historical balance is unavailable and cannot be reconstructed from current receipts or activity.';

/**
 * Normalize a saved receipt using only its saved fields. In particular, the
 * historical balance is never inferred from current Purchase Order balances.
 */
export function normalizePRReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('A saved Purchase Received record is required to create its document.');
  }
  if (!Array.isArray(receipt.lines)) {
    throw new Error('Purchase Received document lines must be an array.');
  }

  const lines = receipt.lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new Error(`Purchase Received document line ${index + 1} is invalid.`);
    }
    const ordered = quantityMilli(line.orderedQty);
    const received = quantityMilli(line.receivedQty);
    const accepted = quantityMilli(line.acceptedQty);
    const rejected = quantityMilli(line.rejectedQty);
    if (ordered === null || received === null || accepted === null || rejected === null ||
      ordered <= 0 || received <= 0 || accepted > received || rejected !== received - accepted) {
      throw new Error(`Purchase Received document line ${index + 1} has invalid saved quantity data.`);
    }
    let balanceAfterQty = null;
    if (Object.hasOwn(line, 'balanceAfterQty') && line.balanceAfterQty !== null) {
      const balance = quantityMilli(line.balanceAfterQty);
      if (balance === null || balance > ordered) {
        throw new Error(`Purchase Received document line ${index + 1} has an invalid saved post-receipt balance.`);
      }
      balanceAfterQty = balance / 1000;
    }
    return { ...line, balanceAfterQty };
  });
  const hasHistoricalBalance = lines.length > 0 && lines.every((line) => line.balanceAfterQty !== null);

  return {
    ...receipt,
    lines,
    isSample: receipt.isSample === true || receipt.isDemo === true || receipt.demo === true,
    hasHistoricalBalance,
    balanceHistoryExplanation: hasHistoricalBalance ? '' : HISTORY_EXPLANATION,
  };
}

export function makeSamplePRReceipt() {
  return normalizePRReceipt({
    id: 'sample-pr-template',
    number: 'PR-SAMPLE-001',
    poId: 'sample-po',
    poNumber: 'PO-SAMPLE-001',
    poDate: '2026-10-01',
    receivedDate: '2026-10-04',
    receivedBy: 'Sample Receiver',
    vendorId: 'sample-vendor',
    vendorName: 'Sample Supplier · Preview Only',
    vendorAddress: 'Sample address for layout preview',
    vendorGstNo: '',
    vendorPhone: '',
    locationId: 'sample-location',
    locationName: 'Sample Main Warehouse',
    status: 'active',
    createdAt: '2026-10-04T09:00:00.000Z',
    updatedAt: '2026-10-04T09:00:00.000Z',
    deletedAt: null,
    isSample: true,
    lines: [{
      lineId: 'sample-line-1',
      productId: 'sample-product-1',
      productName: 'Sample Diagnostic Reagent',
      orderedQty: 24,
      receivedQty: 12,
      acceptedQty: 10,
      balanceAfterQty: 14,
      rejectedQty: 2,
      batchNo: 'SAMPLE-BATCH-001',
      expiryDate: '2028-10-04',
    }],
  });
}