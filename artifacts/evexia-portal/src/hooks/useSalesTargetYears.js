import { useEffect, useState } from 'react';
import { salesTargetChoices } from '../services/serverSalesTargets.js';
import { currentFinancialStart } from '../services/salesTargetFields.js';

// Server years (all saved + rolling) merged with any extra labels (drafts, saved record).
export default function useSalesTargetYears(extra = []) {
  const [years, setYears] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    salesTargetChoices({ limit: 1 }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setYears(result.years || []); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message || 'Years could not be loaded.'); });
    return () => controller.abort();
  }, []);
  const base = currentFinancialStart();
  const all = new Set([...years, ...extra.map(Number).filter((n) => Number.isInteger(n) && n > 0), ...(years.length ? [] : [base, base + 1])]);
  return { years: [...all].sort((a, b) => b - a).map((year) => ({ value: String(year), label: String(year) })), error };
}
