import { useId, useState } from 'react';
import { ChevronDown, Filter, RefreshCw } from 'lucide-react';
import MasterFilterReset from './MasterFilterReset.jsx';
import './orderTransfers.css';

export default function OrderListingFilters({ search, children, onRefresh, onReset, onApply, resetDisabled, resetTestId, applyTestId, masterDisclosure = false, disclosureLabel = 'Filter records', refreshLabel = 'Refresh orders from current session' }) {
  const [expanded, setExpanded] = useState(false);
  const [validationError, setValidationError] = useState('');
  const id = useId();
  const Wrapper = onApply ? 'form' : 'div';
  const revealInvalid = (event) => {
    // Native date constraints still apply when their controls are collapsed.
    // Reveal and focus the field instead of leaving an unfocusable invalid input.
    event.preventDefault();
    const input = event.target;
    setExpanded(true);
    setValidationError(input.validationMessage || 'Check the filter fields before applying.');
    requestAnimationFrame(() => input.isConnected && input.focus());
  };
  return <Wrapper className={`order-listing-filters${masterDisclosure ? ' order-listing-filters--master' : ''}`} onSubmit={onApply ? (event) => { setValidationError(''); onApply(event); } : undefined} onInvalidCapture={onApply ? revealInvalid : undefined} aria-label="Order filters">
    <div className="order-listing-toolbar">
      <div className="order-listing-search">
        <button type="button" className="admin-button admin-button--secondary" onClick={onRefresh} aria-label={refreshLabel}><RefreshCw size={15} aria-hidden="true" />Refresh</button>
        {search}
      </div>
      {!masterDisclosure && <button type="button" className="admin-button admin-button--secondary" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)}>
        Additional filters<ChevronDown size={15} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
      </button>}
      {onApply && <button type="submit" className="admin-button" data-testid={applyTestId}>Apply Filter</button>}
      <MasterFilterReset onClick={() => { setValidationError(''); onReset(); }} disabled={resetDisabled} testId={resetTestId} />
    </div>
    {masterDisclosure ? <details className="order-listing-disclosure" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary><Filter size={15} aria-hidden="true" />{disclosureLabel}<ChevronDown size={15} aria-hidden="true" /></summary>
      <div id={id} className="order-listing-filter-grid">{children}</div>
    </details> : <div id={id} className="order-listing-extra" hidden={!expanded}>{children}</div>}
    {validationError && <p role="alert" className="order-transfer-error">{validationError}</p>}
  </Wrapper>;
}
