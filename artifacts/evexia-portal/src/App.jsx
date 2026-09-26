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

function App() {
  return (
    <Switch>
      <Route path="/" component={PortalSelection} />
      <Route path="/admin" component={Dashboard} />
      <Route path="/admin/masters" component={Masters} />
      <Route path="/admin/masters/zones" component={ZoneMaster} />
      <Route path="/admin/masters/mrs" component={MRMaster} />
      <Route path="/admin/masters/mrs/new">{() => <MRFormPage />}</Route>
      <Route path="/admin/masters/mrs/:id">{(params) => <MRFormPage id={params.id} />}</Route>
      <Route path="/admin/login">{() => <AuthPage role={roleConfig.admin} />}</Route>
      <Route path="/mr">{() => <AuthPage role={roleConfig.mr} />}</Route>
      <Route path="/doctor">{() => <AuthPage role={roleConfig.doctor} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default App;