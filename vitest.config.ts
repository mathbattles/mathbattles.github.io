import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Browser tests in e2e/ run under Playwright with `npm run e2e`.
  // Bot and simulation tests do real work, so they get more than the default few seconds.
  test: { include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'], testTimeout: 60_000 },
});
