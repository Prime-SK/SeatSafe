import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.db-spec.ts'],
    fileParallelism: false,
    hookTimeout: 15000,
    testTimeout: 15000,
  },
});
