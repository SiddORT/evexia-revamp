import { useLocation } from 'wouter';
import { EXCEL_TEMPLATES } from '../../services/mockExcelImport.js';

export default function MasterImportTabs({ kind }) {
  const [, navigate] = useLocation();
  return <nav className="excel-import__tabs" aria-label="Select a master for import">
    {Object.entries(EXCEL_TEMPLATES).map(([key, item]) =>
      <button type="button" key={key} className={kind === key ? 'excel-import__tab excel-import__tab--active' : 'excel-import__tab'}
        aria-current={kind === key ? 'page' : undefined} onClick={() => navigate(`/admin/masters/import/${key}`)}>{item.title} Master</button>)}
  </nav>;
}
