// Exercises the local Vite proxy and isolated scripted chat with one Chromium worker.
import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = process.env.CONTINUUM_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'continuum-e2e-'));
process.env.CONTINUUM_E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: 'line',
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5173', viewport: { width: 360, height: 800 } },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 45000,
    env: { CONTINUUM_FAKE_PROVIDERS: '1', DATA_DIR: dataDir, PORT: '18787', HOST: '127.0.0.1' },
  },
});
