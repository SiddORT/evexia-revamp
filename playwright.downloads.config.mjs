import { defineConfig } from '@playwright/test';
import shared from './playwright.config.mjs';
import { readFileSync } from 'node:fs';

const nix = process.env.EVEXIA_NIX_DOWNLOAD_ENGINES === '1'
  ? JSON.parse(readFileSync(new URL('./.cache/evexia-download-engines.json', import.meta.url), 'utf8'))
  : {};

// WebKit checks Safari's engine, not the shipping Safari/macOS download UI.
// Missing engines fail the release gate; never silently fall back to Chromium.
export default defineConfig({
  ...shared,
  testMatch: '**/download-logs.preview.spec.mjs',
  projects: ['chromium', 'firefox', 'webkit'].map((browserName) => {
    const executablePath = process.env[`EVEXIA_${browserName.toUpperCase()}_PATH`];
    const prepared = nix[browserName];
    return {
      name: `downloads-${browserName}`,
      use: {
        browserName,
        acceptDownloads: true,
        launchOptions: executablePath || prepared ? {
          executablePath: executablePath || prepared.executablePath,
          ...(prepared ? { env: { ...process.env, ...prepared.env } } : {}),
          ...(browserName === 'chromium' ? { args: ['--no-sandbox'] } : {}),
        } : {},
      },
    };
  }),
});
