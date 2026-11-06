import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Browser tests in e2e/ run under Playwright with `npm run e2e`.
  test: { include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'] },
});
