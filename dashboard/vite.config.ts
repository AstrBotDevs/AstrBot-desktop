import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/api/generated/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        branches: 59,
        functions: 44,
        lines: 39,
        statements: 39,
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 1420,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:6185/',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
