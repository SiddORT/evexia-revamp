import { useMemo, useState } from 'react';
import { BadgeIndianRupee, Boxes, CheckCircle2, ChevronDown, CircleSlash, ClipboardList, FlaskConical, Info, Loader, PackageCheck, RotateCcw, Search, Stethoscope, Truck, Undo2, UserRound, Users, Wallet, Receipt, SearchX } from 'lucide-react';
import SearchableSelect from '../SearchableSelect.jsx';
import { OrderTypeDonut, MonthlyTrend } from './DashboardCharts.jsx';
import OrderCountCard from './OrderCountCard.jsx';
import { FINANCIAL_YEARS, INITIAL_FILTERS, MRS, ORDER_STATUSES, ORDER_TYPES, SAMPLE_DIRECTORY, ZONES, filterOrders, formatCount, formatINR, summarize } from './dashboardFixtures.js';
import './dashboard.css';

const opts = (list) => list.map((v) => ({ value: v, label: v }));
const FY_OPTIONS = opts(FINANCIAL_YEARS);
const MR_OPTIONS = MRS.map((mr) => ({ value: mr.id, label: mr.name }));
const ZONE_OPTIONS = opts(ZONES);
const TYPE_OPTIONS = opts(ORDER_TYPES);
const STATUS_OPTIONS = opts(ORDER_STATUSES);
const STATUS_ICONS = { Confirmed: CheckCircle2, 'In Process': Loader, Shipped: Truck, Delivered: PackageCheck, Rejected: CircleSlash, Returned: Undo2 };

function describe(f) {
  return [f.fy || 'All financial years', f.mr ? MRS.find((m) => m.id === f.mr)?.name : 'All MRs', f.zone || 'All zones', f.type || 'All order types', f.status || 'All statuses'];
}

function Metric({ icon: Icon, label, value, note, tone = 'business', testId }) {
  return <div className={`dash-card dash-card--${tone}`} data-testid={testId}>
    <span className="dash-card__icon" aria-hidden="true"><Icon size={18} /></span>
    <div className="dash-card__body"><strong>{value}</strong><span>{label}</span>{note && <small>{note}</small>}</div>
  </div>;
}

export default function DashboardContent() {
  const [draft, setDraft] = useState(INITIAL_FILTERS);
  const [applied, setApplied] = useState(INITIAL_FILTERS);
  const [open, setOpen] = useState(false);
  const [mrQuery, setMrQuery] = useState('');
  const data = useMemo(() => summarize(filterOrders(applied), applied.fy), [applied]);
  const empty = data.total === 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const reset = () => { setDraft(INITIAL_FILTERS); setApplied(INITIAL_FILTERS); setMrQuery(''); };
  const mrRows = data.mrDue.filter((mr) => mr.name.toLowerCase().includes(mrQuery.trim().toLowerCase()));
  const totals = data.byType.reduce((t, r) => ({ orders: t.orders + r.orders, sales: t.sales + r.sales, achieved: t.achieved + r.achieved }), { orders: 0, sales: 0, achieved: 0 });

  return <div className="dash">
    <div className="admin-page-head dash-head">
      <div>
        <p className="admin-page-head__eyebrow">Super Admin overview</p>
        <h1>Dashboard</h1>
        <p className="admin-page-head__description">Orders, demo sales arithmetic and outstanding amounts for the selected sample scope.</p>
      </div>
      <span className="dash-notice" role="note" data-testid="status-mock-notice"><Info size={14} aria-hidden="true" />Mock dashboard · Sample data</span>
    </div>

    <section className="admin-panel dash-filters" aria-label="Dashboard filters">
      <div className="dash-filters__bar">
        <button type="button" className="dash-filters__toggle" aria-expanded={open} aria-controls="dash-filter-body" onClick={() => setOpen((v) => !v)} data-testid="button-toggle-filters">
          <ChevronDown size={16} aria-hidden="true" className={open ? 'dash-rot' : ''} /> Filters
        </button>
        <ul className="dash-chips" aria-label="Applied filters" data-testid="text-applied-filters">
          {describe(applied).map((t) => <li key={t}>{t}</li>)}
        </ul>
      </div>
      <div id="dash-filter-body" hidden={!open} className="dash-filters__body">
        <div className="dash-filters__grid">
          {[['fy', 'Financial year', FY_OPTIONS, 'All financial years'], ['mr', 'MR', MR_OPTIONS, 'All MRs'], ['zone', 'Zone', ZONE_OPTIONS, 'All zones'], ['type', 'Order type', TYPE_OPTIONS, 'All order types'], ['status', 'Status', STATUS_OPTIONS, 'All statuses']].map(([key, label, options, ph]) =>
            <div className="admin-filter" key={key}>
              <label htmlFor={`dash-${key}`}>{label}</label>
              <SearchableSelect id={`dash-${key}`} label={label} value={draft[key]} options={options} onChange={set(key)} placeholder={ph} />
            </div>)}
        </div>
        <div className="dash-filters__actions">
          <button type="button" className="admin-button admin-button--secondary" onClick={reset} data-testid="button-reset-filters"><RotateCcw size={14} aria-hidden="true" />Reset</button>
          <button type="button" className="admin-button" disabled={!dirty} onClick={() => setApplied(draft)} data-testid="button-apply-filters">Apply filters</button>
        </div>
      </div>
    </section>
    <p className="dash-scope" role="status" data-testid="status-dashboard-scope">{formatCount(data.total)} sample orders in the applied scope. All figures are fictional.</p>

    {empty ? <div className="admin-panel admin-empty" role="status" data-testid="status-dashboard-empty">
      <div className="admin-empty__icon"><SearchX size={20} aria-hidden="true" /></div>
      <strong>No sample orders match these filters</strong>
      <p>Try a wider combination, or reset to the initial sample view.</p>
      <button type="button" className="admin-button admin-button--secondary dash-empty-btn" onClick={reset} data-testid="button-empty-reset">Reset filters</button>
    </div> : <>
      <div className="dash-groups">
        <section aria-labelledby="dash-money" className="dash-group">
          <h2 id="dash-money" className="dash-group__title">Demo sales arithmetic</h2>
          <div className="dash-grid">
            <Metric icon={BadgeIndianRupee} label="Total Sales" value={formatINR(data.sales)} note="Order value excluding rejected and returned" testId="card-total-sales" />
            <Metric icon={Receipt} label="Gross Amount" value={formatINR(data.gross)} note="Value of all sample orders in scope" testId="card-gross-amount" />
            <Metric icon={Wallet} label="Actual Sales" value={formatINR(data.actual)} note="Fictional amount marked received" testId="card-actual-sales" />
            <Metric icon={ClipboardList} label="Due Amount" value={formatINR(data.due)} note="Total Sales minus Actual Sales" testId="card-due-amount" />
          </div>
        </section>
        <section aria-labelledby="dash-directory" className="dash-group">
          <h2 id="dash-directory" className="dash-group__title">Sample scope totals <small>(not affected by filters)</small></h2>
          <div className="dash-grid">
            <Metric tone="directory" icon={Boxes} label="Total Products" value={formatCount(SAMPLE_DIRECTORY.products)} testId="card-total-products" />
            <Metric tone="directory" icon={UserRound} label="Total Patients" value={formatCount(SAMPLE_DIRECTORY.patients)} testId="card-total-patients" />
            <Metric tone="directory" icon={Stethoscope} label="Total Doctors" value={formatCount(SAMPLE_DIRECTORY.doctors)} testId="card-total-doctors" />
            <Metric tone="directory" icon={Users} label="Total MR" value={formatCount(SAMPLE_DIRECTORY.mrs)} testId="card-total-mr" />
          </div>
        </section>
        <section aria-labelledby="dash-status" className="dash-group">
          <h2 id="dash-status" className="dash-group__title">Order status</h2>
          <div className="dash-grid dash-grid--status">
            <OrderCountCard icon={ClipboardList} label="Total Orders" total={data.total} breakdown={data.orderBreakdown} testId="card-total-orders" />
            {ORDER_STATUSES.map((st) => <OrderCountCard key={st} tone={st === 'Rejected' || st === 'Returned' ? 'alert' : 'status'} icon={STATUS_ICONS[st]} label={st} total={data.statusCounts[st]} breakdown={data.statusBreakdowns[st]} testId={`card-status-${st.toLowerCase().replace(' ', '-')}`} />)}
          </div>
        </section>
      </div>

      <div className="dash-panels">
        <section className="admin-panel dash-panel" aria-labelledby="dash-sales">
          <header className="dash-panel__head"><h2 id="dash-sales">Sales by order type</h2><small>Demo values, INR</small></header>
          <div className="admin-table-scroll" role="region" tabIndex={0} aria-label="Sales table">
            <table className="dash-table" data-testid="table-sales">
              <thead><tr><th scope="col">Order type</th><th scope="col">Orders</th><th scope="col">Sales</th><th scope="col">Achieved</th></tr></thead>
              <tbody>{data.byType.map((r) => <tr key={r.type}><th scope="row">{r.type}</th><td>{formatCount(r.orders)}</td><td>{formatINR(r.sales)}</td><td>{formatINR(r.achieved)}</td></tr>)}</tbody>
              <tfoot><tr><th scope="row">Total</th><td>{formatCount(totals.orders)}</td><td>{formatINR(totals.sales)}</td><td>{formatINR(totals.achieved)}</td></tr></tfoot>
            </table>
          </div>
          <p className="dash-panel__foot">Achieved equals the fictional received amount; it is not an accounting rule.</p>
        </section>

        <section className="admin-panel dash-panel" aria-labelledby="dash-mr">
          <header className="dash-panel__head"><h2 id="dash-mr">MR outstanding</h2><small>Highest due first</small></header>
          <div className="dash-panel__search admin-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" aria-label="Search MR name" placeholder="Search MR name" value={mrQuery} onChange={(e) => setMrQuery(e.target.value)} data-testid="input-search-mr" />
          </div>
          <div className="dash-scroll" role="region" tabIndex={0} aria-label="MR outstanding list">
            {mrRows.length ? <table className="dash-table">
              <thead><tr><th scope="col">#</th><th scope="col">MR name</th><th scope="col">Due amount</th></tr></thead>
              <tbody>{mrRows.map((mr, i) => <tr key={mr.id} data-testid={`row-mr-${mr.id}`}><td>{i + 1}</td><th scope="row">{mr.name}<small>{mr.zone}</small></th><td>{formatINR(mr.due)}</td></tr>)}</tbody>
            </table> : <p className="dash-panel__empty" role="status">{data.mrDue.length ? `No MR with a due amount matches "${mrQuery}".` : 'No outstanding amount in this sample selection.'}</p>}
          </div>
        </section>

        <section className="admin-panel dash-panel dash-panel--dose" aria-labelledby="dash-dose">
          <header className="dash-panel__head"><h2 id="dash-dose">Immunotherapy doses</h2><small>Immunotherapy orders only</small></header>
          <div className="dash-doses">
            <Metric tone="directory" icon={FlaskConical} label="Primary Dose" value={formatCount(data.primary)} testId="card-primary-dose" />
            <Metric tone="directory" icon={FlaskConical} label="Booster Dose" value={formatCount(data.booster)} testId="card-booster-dose" />
          </div>
          <p className="dash-panel__foot">{formatCount(data.primary + data.booster)} of {formatCount(data.byType[0].orders)} Immunotherapy sample orders. Fictional order labels, not administered doses.</p>
        </section>
      </div>

      <div className="dash-panels dash-panels--charts">
        <section className="admin-panel dash-panel" aria-labelledby="dash-donut">
          <header className="dash-panel__head"><h2 id="dash-donut">Orders by type</h2><small>Count and share</small></header>
          <OrderTypeDonut byType={data.byType} />
        </section>
        <section className="admin-panel dash-panel" aria-labelledby="dash-trend">
          <header className="dash-panel__head"><h2 id="dash-trend">Monthly demo sales</h2><small>{applied.fy || 'All sample years'} · INR</small></header>
          <MonthlyTrend monthly={data.monthly} />
        </section>
      </div>
    </>}
  </div>;
}
