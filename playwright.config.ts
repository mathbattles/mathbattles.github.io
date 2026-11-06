import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1200, height: 800 } },
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
    { command: 'npm run dev:server', url: 'http://localhost:8787/api/health', reuseExistingServer: true, timeout: 90_000 },
  ],
});
