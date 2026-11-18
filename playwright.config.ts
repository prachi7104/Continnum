// Exercises the local Vite proxy and isolated scripted chat with one Chromium worker.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/setup.ts',
  workers: 1,
  reporter: 'line',
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:5173', viewport: { width: 360, height: 800 } },
});
