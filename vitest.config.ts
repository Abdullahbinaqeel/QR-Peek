import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      // The background, content script and popup are exercised by the browser suite in e2e/,
      // which runs outside vitest, so their numbers here are always zero and say nothing.
      include: ['src/lib/**'],
      exclude: ['src/lib/icons.ts'],
      reporter: ['text', 'html'],
    },
  },
});
