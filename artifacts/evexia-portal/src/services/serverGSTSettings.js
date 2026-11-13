import { purchaseOrderRequest } from '../auth/adminSession.js';

export function validGSTDate(value) {
  if (typeof value !== 'string' || value.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1
    && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function validGSTRate(value) {
  return typeof value === 'string' && !/\s/.test(value) && /^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,2})?$/.test(value)
    && (value.split('.')[0] !== '100' || !/[1-9]/.test(value.split('.')[1] || ''));
}

function checked(data) {
  const periods = data?.periods;
  const valid = data && Number.isSafeInteger(data.version) && data.version >= 0
    && data.configured === (data.version > 0) && typeof data.requires_confirmation === 'boolean'
    && validGSTDate(data.business_date) && validPeriods(periods)
    && validGSTDate(data.baseline?.cutoff_date) && validGSTRate(data.baseline?.before_rate)
    && validGSTRate(data.baseline?.on_after_rate)
    && ['stored_configuration', 'approved_initial'].includes(data.baseline?.source)
    && samePeriod(data.current, [...periods].reverse().find((p) => p.applicable_from <= data.business_date))
    && Array.isArray(data.scheduled) && data.scheduled.length === periods.filter((p) => p.applicable_from > data.business_date).length
    && data.scheduled.every((p, i) => samePeriod(p, periods.filter((r) => r.applicable_from > data.business_date)[i]));
  if (!valid) {
    const error = new Error('The GST Settings response could not be confirmed. Your edits are preserved; load saved settings before saving again.');
    error.ambiguous = true;
    throw error;
  }
  return data;
}

const samePeriod = (a, b) => a && b && a.applicable_from === b.applicable_from && a.rate === b.rate;

function validPeriods(periods) {
  return Array.isArray(periods) && periods.length > 0 && periods.length <= 1000
    && periods[0]?.applicable_from === '0001-01-01'
    && periods.every((p, i) => p && validGSTDate(p.applicable_from) && validGSTRate(p.rate)
      && (!i || periods[i - 1].applicable_from < p.applicable_from));
}

export const loadGSTSettings = async () => checked(await purchaseOrderRequest('', {}, 'gst-settings'));
export async function saveGSTSettings(body) {
  const saved = checked(await purchaseOrderRequest('', { body }, 'gst-settings'));
  const normalized = (rate) => {
    const [whole, fraction = ''] = rate.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  };
  const expected = body.action === 'add' ? [{ applicable_from: body.applicable_from, rate: normalized(body.rate) }]
    : [{ applicable_from: '0001-01-01', rate: '12.00' }, { applicable_from: '2025-09-22', rate: '5.00' }];
  if (!expected.every((period) => saved.periods.some((p) => samePeriod(p, period)))) {
    const error = new Error('The GST change could not be confirmed in the saved schedule. Keep this editor open and retry the unchanged save.');
    error.ambiguous = true;
    throw error;
  }
  return saved;
}
export async function loadGSTHistory(beforeVersion) {
  const page = await purchaseOrderRequest('/history', { params: { limit: 10, ...(beforeVersion ? { before_version: beforeVersion } : {}) } }, 'gst-settings');
  if (!Array.isArray(page?.items) || page.items.length > 10
      || !(page.next_before_version === null || Number.isSafeInteger(page.next_before_version))
      || page.items.some((r, i) => !Number.isSafeInteger(r.version) || r.version < 1
        || (i && page.items[i - 1].version <= r.version) || (beforeVersion && r.version >= beforeVersion)
        || !validPeriods(r.prior) || !validPeriods(r.new)
        || !validGSTDate(r.effective_date) || !Number.isFinite(Date.parse(r.recorded_at))
        || typeof r.actor_id !== 'string' || typeof r.actor_label !== 'string')) {
    throw new Error('GST history could not be confirmed. Retry history; no inferred changes are shown.');
  }
  return page;
}
