import { isSamplePR } from './prSampleIdentity.js';
import { PR_TEMPLATES } from './prReceiptTemplates.js';

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
    isSample: isSamplePR(receipt) || receipt.isSample === true || receipt.isDemo === true || receipt.demo === true,
    hasHistoricalBalance,
    balanceHistoryExplanation: hasHistoricalBalance ? '' : HISTORY_EXPLANATION,
  };
}

export function makeSamplePRReceipt(templateId = 'classic') {
  const samples = {
    classic: {
      id: 'sample-pr-template',
      number: 'PR-SAMPLE-001',
      poId: 'sample-po',
      poNumber: 'PO-SAMPLE-001',
      receivedBy: 'Sample Receiver',
      vendorId: 'sample-vendor',
      vendorName: 'Sample Supplier · Preview Only',
      vendorAddress: 'Sample address for layout preview',
      locationId: 'sample-location',
      locationName: 'Sample Main Warehouse',
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
    },
    modern: {
      id: 'sample-pr-modern',
      number: 'PR-SAMPLE-MOD-001',
      poId: 'sample-po-modern',
      poNumber: 'PO-SAMPLE-MOD-001',
      receivedBy: 'Sample Receiver · Preview',
      vendorId: 'sample-vendor-modern',
      vendorName: 'Sample Meridian Lab Supplies · Preview Only',
      vendorAddress: 'Sample address, Meridian Research Park',
      locationId: 'sample-location-modern',
      locationName: 'Sample Central Lab Stores',
      lines: [{
        lineId: 'sample-line-modern',
        productId: 'sample-product-modern',
        productName: 'Sample Hematology Control Kit',
        orderedQty: 30,
        receivedQty: 12,
        acceptedQty: 11,
        balanceAfterQty: 19,
        rejectedQty: 1,
        batchNo: 'SAMPLE-MOD-BATCH-041',
        expiryDate: '2028-11-12',
      }],
    },
    compact: {
      id: 'sample-pr-compact',
      number: 'PR-SAMPLE-CMP-001',
      poId: 'sample-po-compact',
      poNumber: 'PO-SAMPLE-CMP-001',
      receivedBy: 'Sample Storekeeper · Preview',
      vendorId: 'sample-vendor-compact',
      vendorName: 'Sample Cedarfield Scientific · Preview Only',
      vendorAddress: 'Sample address, Cedarfield Trade Estate',
      locationId: 'sample-location-compact',
      locationName: 'Sample South Annex Stores',
      lines: [{
        lineId: 'sample-line-compact',
        productId: 'sample-product-compact',
        productName: 'Sample Sterile Collection Vials',
        orderedQty: 120,
        receivedQty: 50,
        acceptedQty: 48,
        balanceAfterQty: 72,
        rejectedQty: 2,
        batchNo: 'SAMPLE-CMP-BATCH-208',
        expiryDate: '2029-02-18',
      }],
    },
  };
  if (!PR_TEMPLATES.some((template) => template.id === templateId)) {
    throw new Error('Choose a supported Purchase Received template.');
  }
  return normalizePRReceipt({
    poDate: '2026-10-01',
    receivedDate: '2026-10-04',
    vendorGstNo: '',
    vendorPhone: '',
    status: 'active',
    createdAt: '2026-10-04T09:00:00.000Z',
    updatedAt: '2026-10-04T09:00:00.000Z',
    deletedAt: null,
    isSample: true,
    ...samples[templateId],
  });
}