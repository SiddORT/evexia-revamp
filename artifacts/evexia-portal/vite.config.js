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

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), runtimeErrorOverlay()],
  resolve: {
    alias: { '@': path.resolve(dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  root: dirname,
  build: { outDir: path.resolve(dirname, 'dist/public'), emptyOutDir: true },
  server: { port, strictPort: true, host: '0.0.0.0', allowedHosts: true },
  preview: { port, host: '0.0.0.0', allowedHosts: true },
});