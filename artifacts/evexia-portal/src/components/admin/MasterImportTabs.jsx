import { useLocation } from 'wouter';
import { EXCEL_TEMPLATES } from '../../services/mockExcelImport.js';
import { useAdminSession } from '../../auth/AdminBoundary.jsx';
import { MASTER_CATALOGUE, hasMasterPermission, isStaffIdentity } from '../../auth/capabilities.js';

// Headquarter uses authenticated server templates, not a mock import template.
const masters = [...Object.entries(EXCEL_TEMPLATES), ['headquarter', { title: 'Headquarter' }], ['patient', { title: 'Patient' }], ['vendor', { title: 'Vendor' }], ['sales-target', { title: 'Sales Target' }]];

export default function MasterImportTabs({ kind }) {
  const [, navigate] = useLocation();
  const { user } = useAdminSession();
  const allowed = (key) => !isStaffIdentity(user) || MASTER_CATALOGUE.some((master) =>
    master.import === key && hasMasterPermission(user, master.key, 'import'));
  return <nav className="excel-import__tabs" aria-label="Select a master for import">
    {allowed('product-category') && <button type="button" className={kind === 'product-category' ? 'excel-import__tab excel-import__tab--active' : 'excel-import__tab'} aria-current={kind === 'product-category' ? 'page' : undefined} onClick={() => navigate('/admin/masters/import/product-category')}>Product Category Master</button>}
    {allowed('allergen') && <button type="button" className={kind === 'allergen' ? 'excel-import__tab excel-import__tab--active' : 'excel-import__tab'} aria-current={kind === 'allergen' ? 'page' : undefined} onClick={() => navigate('/admin/masters/import/allergen')}>Allergen Master</button>}
    {masters.filter(([key]) => allowed(key)).map(([key, item]) =>
      <button type="button" key={key} className={kind === key ? 'excel-import__tab excel-import__tab--active' : 'excel-import__tab'}
        aria-current={kind === key ? 'page' : undefined} onClick={() => navigate(`/admin/masters/import/${key}`)}>{item.title} Master</button>)}
  </nav>;
}
