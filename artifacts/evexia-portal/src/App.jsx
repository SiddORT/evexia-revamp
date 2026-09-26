import { Route, Switch } from 'wouter';
import { roleConfig } from './config/roles.js';
import PortalSelection from './pages/PortalSelection.jsx';
import AuthPage from './pages/AuthPage.jsx';
import NotFound from './pages/NotFound.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Masters from './pages/admin/Masters.jsx';
import ZoneMaster from './pages/admin/ZoneMaster.jsx';
import MRMaster from './pages/admin/MRMaster.jsx';
import MRFormPage from './pages/admin/MRFormPage.jsx';
import DoctorMaster from './pages/admin/DoctorMaster.jsx';
import DoctorFormPage from './pages/admin/DoctorFormPage.jsx';
import DoctorPaymentHistory from './pages/admin/DoctorPaymentHistory.jsx';
import MasterExcelImportPage from './pages/admin/MasterExcelImportPage.jsx';
import ProductCategoryMaster from './pages/admin/ProductCategoryMaster.jsx';
import ProductCategoryFormPage from './pages/admin/ProductCategoryFormPage.jsx';
import StorageLocationMaster from './pages/admin/StorageLocationMaster.jsx';
import StorageLocationFormPage from './pages/admin/StorageLocationFormPage.jsx';
import DesignationMaster from './pages/admin/DesignationMaster.jsx';
import DesignationFormPage from './pages/admin/DesignationFormPage.jsx';
import PatientMaster from './pages/admin/PatientMaster.jsx';
import PatientFormPage from './pages/admin/PatientFormPage.jsx';
import PatientImportPage from './pages/admin/PatientImportPage.jsx';
import AllergenMaster from './pages/admin/AllergenMaster.jsx';
import AllergenFormPage from './pages/admin/AllergenFormPage.jsx';
import PatientDosageHistory from './pages/admin/PatientDosageHistory.jsx';
import VendorMaster from './pages/admin/VendorMaster.jsx';

function App() {
  return (
    <Switch>
      <Route path="/" component={PortalSelection} />
      <Route path="/admin" component={Dashboard} />
      <Route path="/admin/masters" component={Masters} />
      <Route path="/admin/masters/import/:kind">{(params) => <MasterExcelImportPage key={params.kind} kind={params.kind} />}</Route>
      <Route path="/admin/masters/zones" component={ZoneMaster} />
      <Route path="/admin/masters/mrs" component={MRMaster} />
      <Route path="/admin/masters/mrs/new">{() => <MRFormPage />}</Route>
      <Route path="/admin/masters/mrs/:id">{(params) => <MRFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/doctors" component={DoctorMaster} />
      <Route path="/admin/masters/doctors/new">{() => <DoctorFormPage />}</Route>
      <Route path="/admin/masters/doctors/:id/payments">{(params) => <DoctorPaymentHistory id={params.id} />}</Route>
      <Route path="/admin/masters/doctors/:id">{(params) => <DoctorFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/product-categories" component={ProductCategoryMaster} />
      <Route path="/admin/masters/product-categories/new">{() => <ProductCategoryFormPage />}</Route>
      <Route path="/admin/masters/product-categories/:id">{(params) => <ProductCategoryFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/storage-locations" component={StorageLocationMaster} />
      <Route path="/admin/masters/storage-locations/new">{() => <StorageLocationFormPage />}</Route>
      <Route path="/admin/masters/storage-locations/:id">{(params) => <StorageLocationFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/designations" component={DesignationMaster} />
      <Route path="/admin/masters/designations/new">{() => <DesignationFormPage />}</Route>
      <Route path="/admin/masters/designations/:id">{(params) => <DesignationFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/allergens" component={AllergenMaster} />
      <Route path="/admin/masters/allergens/new">{() => <AllergenFormPage />}</Route>
      <Route path="/admin/masters/allergens/:id">{(params) => <AllergenFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/vendors" component={VendorMaster} />
      <Route path="/admin/masters/patients" component={PatientMaster} />
      <Route path="/admin/masters/patients/import" component={PatientImportPage} />
      <Route path="/admin/masters/patients/new">{() => <PatientFormPage />}</Route>
      <Route path="/admin/masters/patients/:id/dosage-history">{(params) => <PatientDosageHistory id={params.id} />}</Route>
      <Route path="/admin/masters/patients/:id">{(params) => <PatientFormPage id={params.id} />}</Route>
      <Route path="/admin/login">{() => <AuthPage role={roleConfig.admin} />}</Route>
      <Route path="/mr">{() => <AuthPage role={roleConfig.mr} />}</Route>
      <Route path="/doctor">{() => <AuthPage role={roleConfig.doctor} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default App;