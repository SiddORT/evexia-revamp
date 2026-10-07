import { ArrowUpRight, Boxes, BriefcaseBusiness, Building2, FlaskConical, HeartPulse, Landmark, MapPinned, Stethoscope, Target, Truck, UsersRound, Warehouse } from 'lucide-react';
import { Link } from 'wouter';
import AdminLayout from '../../components/admin/AdminLayout.jsx';

export default function Masters() {
  return (
    <AdminLayout title="Masters">
      <div className="admin-page-head"><div><p className="admin-page-head__eyebrow">Workspace / Configuration</p><h1>Masters</h1></div></div>
      <div className="admin-panel">
        <Link href="/admin/masters/zones" className="admin-master-link" data-testid="link-master-zones">
          <span className="admin-master-link__icon"><MapPinned size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Zone Master</strong><small>Manage the zones used within EVEXIA.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/courier-partners" className="admin-master-link" data-testid="link-master-courier-partners">
          <span className="admin-master-link__icon"><Truck size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Courier Partner Master</strong><small>Manage shared courier partner records and authenticated audit history.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/mrs" className="admin-master-link" data-testid="link-master-mrs">
          <span className="admin-master-link__icon"><UsersRound size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>MR Master</strong><small>Manage MR profiles and zone assignments in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/sales-targets" className="admin-master-link" data-testid="link-master-sales-targets">
          <span className="admin-master-link__icon"><Target size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Sales Target Master</strong><small>Set quarterly financial-year targets for each MR in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/doctors" className="admin-master-link" data-testid="link-master-doctors">
          <span className="admin-master-link__icon"><Stethoscope size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Doctor Master</strong><small>Manage doctor profiles and MR assignments in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/product-categories" className="admin-master-link" data-testid="link-master-product-categories">
          <span className="admin-master-link__icon"><Boxes size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Product Category Master</strong><small>Manage category names, descriptions, prices and status in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/storage-locations" className="admin-master-link" data-testid="link-master-storage-locations">
          <span className="admin-master-link__icon"><Warehouse size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Storage Location Master</strong><small>Manage storage locations, addresses and availability in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/headquarters" className="admin-master-link" data-testid="link-master-headquarters">
          <span className="admin-master-link__icon"><Building2 size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Headquarter Master</strong><small>Manage HQ names, state codes and availability in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/designations" className="admin-master-link" data-testid="link-master-designations">
          <span className="admin-master-link__icon"><BriefcaseBusiness size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Designation Master</strong><small>Manage designation levels, allowances, professional tax and status in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/allergens" className="admin-master-link" data-testid="link-master-allergens">
          <span className="admin-master-link__icon"><FlaskConical size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Allergen Master</strong><small>Manage product details, reference assignments and CSV records in this browser.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/vendors" className="admin-master-link" data-testid="link-master-vendors">
          <span className="admin-master-link__icon"><BriefcaseBusiness size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Vendor Master</strong><small>Manage browser-local vendor contacts and CSV records.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/patients" className="admin-master-link" data-testid="link-master-patients">
          <span className="admin-master-link__icon"><HeartPulse size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Patient Master</strong><small>Manage browser-local preview patients and CSV records.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
        <Link href="/admin/masters/opening-balances" className="admin-master-link" data-testid="link-master-opening-balances">
          <span className="admin-master-link__icon"><Landmark size={20} aria-hidden="true" /></span>
          <span className="admin-master-link__text"><strong>Opening Balance Master</strong><small>Maintain doctor balances by financial year, with CSV review and export.</small></span>
          <ArrowUpRight className="admin-master-link__arrow" size={19} aria-hidden="true" />
        </Link>
      </div>
    </AdminLayout>
  );
}