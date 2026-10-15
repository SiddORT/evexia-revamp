import './masterFilters.css';

export default function MasterFilterReset({ disabled, onClick, testId }) {
  return <div className="master-filter-actions">
    <button type="button" className="admin-button admin-button--secondary master-filter-reset" disabled={disabled} onClick={onClick} data-testid={testId}>Reset filters</button>
  </div>;
}
