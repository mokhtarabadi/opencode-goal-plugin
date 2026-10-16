// Vitest config for Phase 1 plugin tests.
// Why this file exists: pins test include pattern so npm test is deterministic.
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts']
  }
});
