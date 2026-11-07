import { defineConfig } from '@playwright/test';

// Set E2E_BASE to test a deployed site instead of starting local servers.
const live = process.env.E2E_BASE;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  // Bots and timing can vary on shared machines.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: live ?? 'http://localhost:5173', viewport: { width: 1200, height: 800 } },
  webServer: live ? undefined : [
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
    { command: 'npm run dev:server', url: 'http://localhost:8787/api/health', reuseExistingServer: true, timeout: 90_000 },
  ],
});
