// Display-only: all amounts, dates and restrictions come from the eligibility
// preview. Do not derive eligibility or interpret the server's reason text here.
export default function ImmunotherapyFinancialReview({ review, ineligible }) {
  return <div className="financial-review">
    <dl className="financial-review__totals">
      <Fact label="New order amount" value={review.orderAmount} name="new-amount" />
      <Fact label="Resulting exposure" value={review.resultingExposure} name="exposure" />
    </dl>
    <div className="financial-review__groups">
      <section aria-label="Order and MR balance">
        <h3>Order & MR balance</h3>
        <dl>
          <Fact label="Effective order date" value={review.orderDate} name="order-date" />
          <Fact label="MR unpaid balance" value={review.outstanding} name="unpaid-balance" />
          <Fact label="MR Payment Limit" value={review.paymentLimit} name="payment-limit" />
        </dl>
        <p className="financial-review__note">Resulting exposure must be strictly below a positive MR Payment Limit; equality is not permitted. A zero payment limit disables only this restriction.</p>
      </section>
      <section aria-label="Doctor and days limit">
        <h3>Doctor & days limit</h3>
        <dl>
          <Fact label="Doctor pending payment amount" value={review.doctorPending} name="doctor-pending" />
          <Fact label="Configured MR Doctor Days Limit" value={review.doctorDaysLimit} name="days-limit" />
          <Fact label="Oldest relevant unpaid-order age" value={review.oldestAge} name="oldest-age" />
          <Fact label="Oldest unpaid saved order date" value={review.oldestDate} name="oldest-date" />
        </dl>
        <p className="financial-review__note">Days run from the saved order date. A days setting alone is not evidence of overdue payment. A zero days limit disables only this restriction.</p>
      </section>
    </div>
    {(review.reasons.length > 0 || ineligible) && <section className={`financial-review__notice${ineligible ? ' financial-review__notice--blocked' : ''}`} aria-label="Eligibility">
      <h3>{ineligible ? 'Unable to confirm this quote' : 'Eligibility information'}</h3>
      {ineligible && <p>Confirmation is disabled. Return to the order to review these restrictions.</p>}
      {review.reasons.length > 0 && <ul>{review.reasons.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    </section>}
    {review.stockAdvice.length > 0 && <section className="financial-review__notice financial-review__notice--stock" aria-label="Stock advice">
      <h3>Stock advice · advisory only</h3>
      <p>No stock reservation or deduction at placement.</p>
      <ul>{review.stockAdvice.map((message, index) => <li key={index}>{message}</li>)}</ul>
    </section>}
    <section className="financial-review__approval" aria-label="Approval and payment evidence">
      <h3>Approval & payment evidence</h3>
      <p>{review.refreshQuote
        ? 'Confirming saves this refreshed quote for explicit Admin review.'
        : 'Placement awaits explicit Admin approval.'} Stock is consumed only on approval.</p>
      <p>Unpaid balances use saved orders and committed payments.</p>
    </section>
  </div>;
}

function Fact({ label, value, name }) {
  return <div className="financial-review__fact">
    <dt>{label}</dt>
    <dd data-testid={`financial-${name}`}>{value}</dd>
  </div>;
}
