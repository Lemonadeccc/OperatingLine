import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    maxWorkers: '40%',
    testTimeout: 10_000,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
