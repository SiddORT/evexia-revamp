import { useState } from 'react';
import { fiscalBounds, salesMoney } from '../services/serverMRSales.js';
import { Empty, Head, useDate } from './common.jsx';
import { useSalesAchievement, useSalesYears } from './useSalesAchievement.js';

const TARGET_NOTICE = {
  missing: 'No saved target exists for this financial year. Approved sales are shown independently.',
  inactive: 'The saved target for this financial year is inactive. No active target is available.',
  deleted: 'The target for this financial year was deleted. No active target is available.',
};
const KINDS = { IT: 'Immunotherapy', Kit: 'Kits & Consumables', SPT: 'SPT', Lupin: 'Lupin' };
const PERIODS = ['all', 'Q1', 'Q2', 'Q3', 'Q4'];

export function SalesRules() {
  return <p className="mrw-notice">Only approved saved orders count, including orders progressed to Shipped or Delivered.
    Legacy Approved and In process mean the same approved stage. Attribution uses the saved order date and MR owner,
    not approval date. Drafts (including incomplete drafts), pending submissions, rejected, cancelled/voided and returned
    orders do not count. Each order counts once, using its saved total—not today’s catalogue prices, payment flags or settlements.
    Q1: April–June; Q2: July–September; Q3: October–December; Q4: January–March.</p>;
}

export function SalesSummary({ report, percentageTestId = 'text-target-percentage' }) {
  const { data, loading, error, refresh } = report;
  if (loading) return <div className="mrw-card" role="status">Loading saved target and approved sales…</div>;
  if (error) return <div className="mrw-card"><p role="alert">{error}</p><button className="admin-button" onClick={refresh}>Retry sales report</button></div>;
  const percent = data.percentage;
  // Only this decorative width is converted to Number. Text and accessible
  // percentage retain the exact decimal string, including values over 100%.
  const fill = percent == null ? 0 : Number(BigInt(percent.replace('.', '')) > 10000n ? '100' : percent);
  return <>
    <section className="mrw-hero" aria-label="Saved sales achievement">
      <p className="mrw-flush"><strong className="mrw-big" data-testid={percentageTestId}>{percent == null ? 'Unavailable' : `${percent}%`}</strong> achievement</p>
      {percent != null && <div className="mrw-meter" role="progressbar" aria-label="Approved sales achievement"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill}
        aria-valuetext={`${percent} percent of selected target${BigInt(percent.replace('.', '')) > 10000n ? ', over target' : ''}`}>
        <div className="mrw-meter__fill" style={{ width: `${fill}%` }} />
      </div>}
      {TARGET_NOTICE[data.targetState] && <p className="mrw-notice">{TARGET_NOTICE[data.targetState]}</p>}
      {data.target === '0.00' && <p className="mrw-notice">The active saved target is zero. Achievement and order contribution percentages are unavailable.</p>}
      {!data.complete && <p className="mrw-alert" role="status">{data.unavailableOrders} contributing order(s) have unavailable saved prices.
        The known sales sum below is incomplete. Definitive achievement and remaining amount are unavailable.</p>}
      <p className="mrw-notice">{data.total} approved order(s) across the entire selected period—not only the displayed page.</p>
    </section>
    <div className="mrw-grid">
      {[['Saved target', data.target], [data.complete ? 'Approved sales' : 'Known approved sales (incomplete)', data.knownSales], ['Remaining', data.remaining]].map(([label, value]) =>
        <div className="mrw-card mrw-stat" key={label}><span>{label}</span><strong>{salesMoney(value)}</strong></div>)}
    </div>
  </>;
}

export default function Targets() {
  const [year, setYear] = useState(null);
  const [period, setPeriod] = useState('all');
  const [offset, setOffset] = useState(0);
  const [yearOffset, setYearOffset] = useState(0);
  const report = useSalesAchievement({ year, period, offset });
  const years = useSalesYears(yearOffset);
  const date = useDate();
  const selectedYear = year ?? report.data?.startYear ?? years.data?.currentYear;
  const choices = [...new Set([...(years.data?.items || []), selectedYear].filter((y) => y != null))].sort((a, b) => b - a);
  const range = selectedYear ? fiscalBounds(selectedYear, period) : null;
  const data = report.data;
  const refresh = () => { report.refresh(); years.refresh(); };
  return <>
    <Head eyebrow="Targets" title="Sales targets and achievement" text="Your saved April–March financial-year target and approved-order sales. Read-only.">
      <button className="admin-button admin-button--secondary" onClick={refresh}>Refresh</button>
    </Head>
    <div className="mrw-card mrw-stack">
      <div className="mrw-sales-filters">
        <label className="mrw-field">Financial year<select className="admin-select" value={selectedYear ?? ''} disabled={!choices.length}
          onChange={(e) => { setYear(Number(e.target.value)); setOffset(0); }}>
          {!choices.length && <option value="">Loading financial years…</option>}
          {choices.map((y) => <option key={y} value={y}>{y}–{y + 1}</option>)}
        </select></label>
        <label className="mrw-field">Period<select className="admin-select" value={period} data-testid="select-target-period"
          onChange={(e) => { setPeriod(e.target.value); setOffset(0); }}>
          {PERIODS.map((p) => <option key={p} value={p}>{p === 'all' ? 'Full year' : p}</option>)}
        </select></label>
      </div>
      {range && <p className="mrw-notice">Selected period: {date(range[0])} – {date(range[1])}</p>}
      {selectedYear && <ul className="mrw-sales-ranges" aria-label="Financial quarter date ranges">
        {PERIODS.slice(1).map((q) => { const [from, to] = fiscalBounds(selectedYear, q); return <li key={q}>{q}: {date(from)} – {date(to)}</li>; })}
      </ul>}
      {years.loading && <p role="status">Loading available financial years…</p>}
      {years.error && <div><p role="alert">{years.error}</p><button className="admin-button admin-button--secondary" onClick={years.refresh}>Retry financial years</button></div>}
      {(yearOffset > 0 || (years.data && years.data.total > 50)) && <div className="mrw-actions">
        <button className="admin-button admin-button--secondary" disabled={yearOffset === 0 || years.loading} onClick={() => setYearOffset((n) => Math.max(0, n - 50))}>Newer years</button>
        <button className="admin-button admin-button--secondary" disabled={years.loading || !years.data || yearOffset + 50 >= years.data.total} onClick={() => setYearOffset((n) => n + 50)}>Older years</button>
      </div>}
    </div>
    <SalesSummary report={report} />
    {data && <section className="mrw-card" aria-labelledby="mr-sales-orders">
      <h2 id="mr-sales-orders">Contributing approved orders</h2>
      {data.total === 0 ? <Empty title="No approved sales in this period" text="Pending submissions and drafts are not achievement. Approved orders appear here after a refresh." />
        : <><div className="mrw-scroll" role="region" aria-label="Approved order contributions" tabIndex={0}>
          <table className="mrw-table mrw-sales-table">
            <caption className="mrw-notice">Order contributions to the selected {period === 'all' ? 'full-year' : period} target.
              {data.target == null || data.target === '0.00' ? ' Percentages are unavailable without a positive active target.' : ''}
              {!data.complete ? ' Unavailable prices mean the period aggregate is incomplete.' : ''}</caption>
            <thead><tr>{['Order number', 'Type', 'Saved order date', 'Status', 'Saved sales amount', 'Target contribution'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{data.items.map((row) => <tr key={row.key}>
              {[row.number, KINDS[row.kind], date(row.date), row.status, salesMoney(row.amount), row.contribution == null ? 'Unavailable' : `${row.contribution}%`].map((v, i) =>
                <td key={i}><span className="mrw-sales-label" aria-hidden="true">{['Order', 'Type', 'Order date', 'Status', 'Sales', 'Contribution'][i]}</span><span>{v}</span></td>)}
            </tr>)}</tbody>
          </table>
        </div>
        {!data.items.length && <p role="status">This page is now empty because saved orders changed. Go to the previous page or refresh.</p>}
        <nav className="mrw-do-orders-pages" aria-label="Contributing orders pagination">
          <span>{data.items.length ? `${offset + 1}–${offset + data.items.length}` : '0'} of {data.total} orders</span>
          <div className="mrw-actions">
            <button className="admin-button admin-button--secondary" disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - 25))}>Previous</button>
            <button className="admin-button admin-button--secondary" disabled={offset + 25 >= data.total} onClick={() => setOffset((n) => n + 25)}>Next</button>
          </div>
        </nav></>}
    </section>}
    <div className="mrw-card"><h2>How sales are counted</h2><SalesRules /></div>
  </>;
}
