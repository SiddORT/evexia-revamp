import { Component, lazy, Suspense } from 'react';
import { useLocation } from 'wouter';
import PortalLoader from './PortalLoader.jsx';
import { useAdminPreferences } from './admin/adminPreferences.js';

class RouteChunkError extends Error {}

// Declare these lazy components at module scope, never during render: their
// identity must stay stable while an already-mounted editor renews its session.
export function lazyRoute(load) {
  return lazy(() => load().catch((cause) => {
    throw new RouteChunkError('Could not download this page.', { cause });
  }));
}

class ChunkFailureBoundary extends Component {
  state = { error: null, path: this.props.path };

  static getDerivedStateFromError(error) {
    if (!(error instanceof RouteChunkError)) throw error;
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    return props.path === state.path ? null : { path: props.path, error: null };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="portal-loading-page" data-admin-theme={this.props.theme} data-admin-appearance={this.props.appearance}>
        <section className="portal-verification-error">
          <div role="alert">Could not download this page. Check your connection, then reload to try again.</div>
          <p>Reloading will discard any unsaved changes in this tab.</p>
          <button onClick={() => window.location.reload()}>Reload page</button>
        </section>
      </main>
    );
  }
}

export default function RouteLoadingBoundary({ children }) {
  const [path] = useLocation();
  const { theme, appearance } = useAdminPreferences();
  return (
    <ChunkFailureBoundary path={path} theme={theme} appearance={appearance}>
      <Suspense fallback={
        <main className="portal-loading-page" data-admin-theme={theme} data-admin-appearance={appearance}>
          <PortalLoader label="Opening page…" />
        </main>
      }>
        {children}
      </Suspense>
    </ChunkFailureBoundary>
  );
}
