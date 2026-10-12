import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPort = process.env.PORT;
const port = Number(rawPort || 5173);
const basePath = process.env.BASE_PATH || '/';
const apiProxyTarget = process.env.EVEXIA_TEST_API_PROXY_TARGET;

export default defineConfig(({ command, isPreview }) => ({
  base: basePath,
  define: {
    // Public host metadata only. Build/production preview never enable cookies.
    'import.meta.env.EVEXIA_PREVIEW_HOSTNAME': JSON.stringify(
      command === 'serve' && !isPreview ? process.env.REPLIT_DEV_DOMAIN || '' : ''),
  },
  plugins: [react(), tailwindcss(), runtimeErrorOverlay()],
  resolve: {
    alias: { '@': path.resolve(dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  root: dirname,
  build: { outDir: path.resolve(dirname, 'dist/public'), emptyOutDir: true },
  server: {
    port, strictPort: true, host: '0.0.0.0', allowedHosts: true,
    ...(apiProxyTarget ? {
      proxy: { '/api': { target: apiProxyTarget, changeOrigin: false } },
    } : {}),
  },
  preview: { port, host: '0.0.0.0', allowedHosts: true },
}));