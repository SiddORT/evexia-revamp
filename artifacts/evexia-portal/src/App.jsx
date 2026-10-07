import { Route, Switch } from 'wouter';
import AdminBoundary from './auth/AdminBoundary.jsx';
import RouteLoadingBoundary, { lazyRoute } from './components/RouteLoadingBoundary.jsx';
import { roleConfig } from './config/roles.js';
import PortalSelection from './pages/PortalSelection.jsx';
import AuthPage from './pages/AuthPage.jsx';
import NotFound from './pages/NotFound.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import Masters from './pages/admin/Masters.jsx';
import ZoneMaster from './pages/admin/ZoneMaster.jsx';
const CourierPartnerMaster = lazyRoute(() => import('./pages/admin/CourierPartnerMaster.jsx'));
const MRMaster = lazyRoute(() => import('./pages/admin/MRMaster.jsx'));
const MRFormPage = lazyRoute(() => import('./pages/admin/MRFormPage.jsx'));
const DoctorMaster = lazyRoute(() => import('./pages/admin/DoctorMaster.jsx'));
const DoctorFormPage = lazyRoute(() => import('./pages/admin/DoctorFormPage.jsx'));
const DoctorPaymentHistory = lazyRoute(() => import('./pages/admin/DoctorPaymentHistory.jsx'));
const MasterExcelImportPage = lazyRoute(() => import('./pages/admin/MasterExcelImportPage.jsx'));
const ProductCategoryMaster = lazyRoute(() => import('./pages/admin/ProductCategoryMaster.jsx'));
const ProductCategoryFormPage = lazyRoute(() => import('./pages/admin/ProductCategoryFormPage.jsx'));
const StorageLocationMaster = lazyRoute(() => import('./pages/admin/StorageLocationMaster.jsx'));
const StorageLocationFormPage = lazyRoute(() => import('./pages/admin/StorageLocationFormPage.jsx'));
const HeadquarterMaster = lazyRoute(() => import('./pages/admin/HeadquarterMaster.jsx'));
const HeadquarterFormPage = lazyRoute(() => import('./pages/admin/HeadquarterFormPage.jsx'));
const DesignationMaster = lazyRoute(() => import('./pages/admin/DesignationMaster.jsx'));
const DesignationFormPage = lazyRoute(() => import('./pages/admin/DesignationFormPage.jsx'));
const PatientMaster = lazyRoute(() => import('./pages/admin/PatientMaster.jsx'));
const PatientFormPage = lazyRoute(() => import('./pages/admin/PatientFormPage.jsx'));
const PatientImportPage = lazyRoute(() => import('./pages/admin/PatientImportPage.jsx'));
const AllergenMaster = lazyRoute(() => import('./pages/admin/AllergenMaster.jsx'));
const AllergenFormPage = lazyRoute(() => import('./pages/admin/AllergenFormPage.jsx'));
const PatientDosageHistory = lazyRoute(() => import('./pages/admin/PatientDosageHistory.jsx'));
const VendorMaster = lazyRoute(() => import('./pages/admin/VendorMaster.jsx'));
const SalesTargetMaster = lazyRoute(() => import('./pages/admin/SalesTargetMaster.jsx'));
const OpeningBalanceMaster = lazyRoute(() => import('./pages/admin/OpeningBalanceMaster.jsx'));
const OpeningBalanceFormPage = lazyRoute(() => import('./pages/admin/OpeningBalanceFormPage.jsx'));
const StaffManagement = lazyRoute(() => import('./pages/admin/StaffManagement.jsx'));
const RolesPermissions = lazyRoute(() => import('./pages/admin/RolesPermissions.jsx'));
const AdminSettings = lazyRoute(() => import('./pages/admin/AdminSettings.jsx'));
const PurchaseOrders = lazyRoute(() => import('./pages/admin/PurchaseOrders.jsx'));
const PurchaseOrderFormPage = lazyRoute(() => import('./pages/admin/PurchaseOrderFormPage.jsx'));
const PurchaseReceived = lazyRoute(() => import('./pages/admin/PurchaseReceived.jsx'));
const StockStatus = lazyRoute(() => import('./pages/admin/StockStatus.jsx'));
const PurchaseReceivedFormPage = lazyRoute(() => import('./pages/admin/PurchaseReceivedFormPage.jsx'));
const MoveStocks = lazyRoute(() => import('./pages/admin/MoveStocks.jsx'));
const MoveStockFormPage = lazyRoute(() => import('./pages/admin/MoveStockFormPage.jsx'));
const ActivityLogs = lazyRoute(() => import('./pages/admin/ActivityLogs.jsx'));
const DownloadLogs = lazyRoute(() => import('./pages/admin/DownloadLogs.jsx'));

function App() {
  return (
    <AdminBoundary><RouteLoadingBoundary><Switch>
      <Route path="/" component={PortalSelection} />
      <Route path="/admin" component={Dashboard} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route path="/admin/activity-logs" component={ActivityLogs} />
      <Route path="/admin/download-logs" component={DownloadLogs} />
      <Route path="/admin/staff" component={StaffManagement} />
      <Route path="/admin/roles-permissions" component={RolesPermissions} />
      <Route path="/admin/inventory/purchase-orders" component={PurchaseOrders} />
      <Route path="/admin/inventory/purchase-orders/new">{() => <PurchaseOrderFormPage />}</Route>
      <Route path="/admin/inventory/purchase-orders/:id">{(params) => <PurchaseOrderFormPage id={params.id} />}</Route>
      <Route path="/admin/inventory/purchase-received" component={PurchaseReceived} />
      <Route path="/admin/inventory/stock-status" component={StockStatus} />
      <Route path="/admin/inventory/purchase-received/new">{() => <PurchaseReceivedFormPage />}</Route>
      <Route path="/admin/inventory/purchase-received/:id">{(params) => <PurchaseReceivedFormPage id={params.id} />}</Route>
      <Route path="/admin/inventory/move-stocks" component={MoveStocks} />
      <Route path="/admin/inventory/move-stocks/new" component={MoveStockFormPage} />
      <Route path="/admin/masters" component={Masters} />
      <Route path="/admin/masters/import/:kind">{(params) => <MasterExcelImportPage key={params.kind} kind={params.kind} />}</Route>
      <Route path="/admin/masters/zones" component={ZoneMaster} />
      <Route path="/admin/masters/courier-partners" component={CourierPartnerMaster} />
      <Route path="/admin/masters/sales-targets" component={SalesTargetMaster} />
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
      <Route path="/admin/masters/headquarters" component={HeadquarterMaster} />
      <Route path="/admin/masters/headquarters/new">{() => <HeadquarterFormPage />}</Route>
      <Route path="/admin/masters/headquarters/:id">{(params) => <HeadquarterFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/designations" component={DesignationMaster} />
      <Route path="/admin/masters/designations/new">{() => <DesignationFormPage />}</Route>
      <Route path="/admin/masters/designations/:id">{(params) => <DesignationFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/allergens" component={AllergenMaster} />
      <Route path="/admin/masters/allergens/new">{() => <AllergenFormPage />}</Route>
      <Route path="/admin/masters/allergens/:id">{(params) => <AllergenFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/vendors" component={VendorMaster} />
      <Route path="/admin/masters/opening-balances" component={OpeningBalanceMaster} />
      <Route path="/admin/masters/opening-balances/new">{() => <OpeningBalanceFormPage />}</Route>
      <Route path="/admin/masters/opening-balances/:id">{(params) => <OpeningBalanceFormPage id={params.id} />}</Route>
      <Route path="/admin/masters/patients" component={PatientMaster} />
      <Route path="/admin/masters/patients/import" component={PatientImportPage} />
      <Route path="/admin/masters/patients/new">{() => <PatientFormPage />}</Route>
      <Route path="/admin/masters/patients/:id/dosage-history">{(params) => <PatientDosageHistory id={params.id} />}</Route>
      <Route path="/admin/masters/patients/:id">{(params) => <PatientFormPage id={params.id} />}</Route>
      <Route path="/admin/login">{() => <AuthPage role={roleConfig.admin} />}</Route>
      <Route path="/mr">{() => <AuthPage role={roleConfig.mr} />}</Route>
      <Route path="/doctor">{() => <AuthPage role={roleConfig.doctor} />}</Route>
      <Route component={NotFound} />
    </Switch></RouteLoadingBoundary></AdminBoundary>
  );
}

export default App;