// Persist the sample identity in existing strict-schema fields, not new flags.
export const isSamplePR = (receipt) => /^sample-pr-[1-5]$/.test(receipt?.id || '') &&
  receipt?.number === `PR-SAMPLE-${String(receipt.id.slice(-1)).padStart(3, '0')}`;