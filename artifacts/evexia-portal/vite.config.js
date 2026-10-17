import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { developmentCompatibilityPlugin } from '../../scripts/development-identity.mjs';
import { frontendRuntimePlugin } from '../../scripts/frontend-runtime.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPort = process.env.PORT;
const port = Number(rawPort || 5173);
const basePath = process.env.BASE_PATH || '/';
const apiProxyTarget = process.env.EVEXIA_TEST_API_PROXY_TARGET;
const exactHosts = [
  'localhost', '127.0.0.1', '::1',
  ...(process.env.EVEXIA_DEV_HOSTS || '').split(',').filter(Boolean),
];
if (process.env.REPLIT_DEV_DOMAIN) exactHosts.push(process.env.REPLIT_DEV_DOMAIN);
for (const host of exactHosts) {
  if (host !== '::1' && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(host)) {
    throw new Error('Development hosts must be explicit exact hostnames');
  }
}
function exactDevelopmentHosts() {
  const install = (server, hosts) => server.middlewares.use((request, response, next) => {
    const raw = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'host');
    const authority = request.headers.host || '';
    const match = /^(?:\[([0-9a-f:]+)\]|([a-z0-9.-]+))(?::([0-9]{1,5}))?$/i.exec(authority);
    const host = match?.[1] || match?.[2]?.toLowerCase();
    if (raw.length !== 1 || !match || !hosts.includes(host) || (match[3] && !(+match[3] > 0 && +match[3] <= 65535))) {
      response.writeHead(421, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end('Hostname not approved for this development server.');
      return;
    }
    next();
  });
  return {
    name: 'evexia-exact-development-hosts',
    configureServer(server) { install(server, exactHosts); },
    configurePreviewServer(server) { install(server, ['localhost', '127.0.0.1', '::1']); },
  };
}

export default defineConfig(({ command, isPreview }) => {
  const developmentTools = command === 'serve' && !isPreview &&
   (process.env.EVEXIA_TEST_DEVELOPMENT_GATE === '1' ||
    (Boolean(process.env.REPLIT_DEV_DOMAIN) && !(process.env.APP_ENV === 'test' && apiProxyTarget)));
 return ({
  base: basePath,
  define: {
    // Public host metadata only. Build/production preview never enable cookies.
    'import.meta.env.EVEXIA_PREVIEW_HOSTNAME': JSON.stringify(
      command === 'serve' && !isPreview ? process.env.REPLIT_DEV_DOMAIN || '' : ''),
  },
   plugins: [exactDevelopmentHosts(), frontendRuntimePlugin(basePath), developmentCompatibilityPlugin(developmentTools, basePath), react(), tailwindcss(), runtimeErrorOverlay()],
  resolve: {
    alias: { '@': path.resolve(dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  root: dirname,
  build: { outDir: path.resolve(dirname, 'dist/public'), emptyOutDir: true },
  server: {
    port, strictPort: true, host: '0.0.0.0', allowedHosts: exactHosts,
    ...(apiProxyTarget ? {
      proxy: { '/api': {
        target: apiProxyTarget, changeOrigin: false,
        configure(proxy) {
          // Isolated API fixtures use the same single-client contract as nginx.
          // Never relay a caller's address chain, even in this test-only proxy.
          proxy.on('proxyReq', (outgoing, request) => {
            outgoing.setHeader('X-Forwarded-For', request.socket.remoteAddress);
            outgoing.removeHeader('X-Real-IP');
          });
        },
      } },
    } : {}),
  },
  preview: { port, host: '0.0.0.0', allowedHosts: ['localhost', '127.0.0.1', '::1'] },
}); });