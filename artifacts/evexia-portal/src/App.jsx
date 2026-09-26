import { Route, Switch } from 'wouter';
import { roleConfig } from './config/roles.js';
import PortalSelection from './pages/PortalSelection.jsx';
import AuthPage from './pages/AuthPage.jsx';
import NotFound from './pages/NotFound.jsx';

function App() {
  return (
    <Switch>
      <Route path="/" component={PortalSelection} />
      <Route path="/admin">{() => <AuthPage role={roleConfig.admin} />}</Route>
      <Route path="/mr">{() => <AuthPage role={roleConfig.mr} />}</Route>
      <Route path="/doctor">{() => <AuthPage role={roleConfig.doctor} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default App;