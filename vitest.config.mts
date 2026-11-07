import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      'paygate-x402': path.resolve(import.meta.dirname, 'spica/src/index.ts'),
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/live/**', 'node_modules/**'], environment: 'node' },
});
