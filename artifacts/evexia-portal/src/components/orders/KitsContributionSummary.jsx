import { moneyText, signedMoneyText } from '../../services/kitsPricing.js';

export default function KitsContributionSummary({ contribution, preview = false }) {
  const c = contribution;
  return <section className="kpr-additional" aria-label={preview ? 'MR contribution preview' : 'Saved MR contribution'}>
    <h3>{preview ? 'MR contribution preview' : 'Saved MR contribution'}</h3>
    <p className="kits-hint">{preview ? 'Unsaved estimate; the server calculates and stores the authoritative result on financial save.'
      : 'Saved financial facts, not earned credit. Approval, saved owner/date and non-returned/non-rejected status must be checked separately.'}
      {' '}Business Parking does not change the invoice total.</p>
    {c?.state === 'Available' ? <>
      <dl className="kpr-totals">
        <div><dt>Original Business Parking</dt><dd>{moneyText(c.businessParking)}</dd></div>
        <div><dt>Discount basis</dt><dd>{c.discountType === 'percent' ? `${c.discountValue}%` : `${moneyText(c.discountValue)} fixed`}</dd></div>
        <div><dt>Sales deduction</dt><dd>{moneyText(c.salesDeduction)}</dd></div>
        <div><dt>MR sales (Parking − sales deduction)</dt><dd>{signedMoneyText(c.mrSales)}</dd></div>
        <div><dt>Achievement deduction</dt><dd>{moneyText(c.achievementDeduction)}</dd></div>
        <div><dt>MR achievement (Parking − achievement deduction)</dt><dd>{signedMoneyText(c.mrAchievement)}</dd></div>
      </dl>
      <p className="kits-hint">Both deductions use the original Parking. Fixed INR discounts are not converted to percentages. Signed results are retained.</p>
    </> : <p role="status">Contributions unavailable: {c?.unavailableReason || 'No contribution policy was saved with this historical financial record. No amounts have been inferred.'}</p>}
    {!preview && c && <p className="kits-hint">Policy {c.policyVersion} · Financial save version {c.orderVersion} · Order {c.orderNumber}
      {' · '}{c.orderDate} · Saved MR {c.mrId || 'none'} · Saved {c.savedAt}</p>}
  </section>;
}
