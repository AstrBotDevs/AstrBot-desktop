import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@legacy-i18n': fileURLToPath(new URL('../dashboard/src/i18n', import.meta.url)),
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
      '/legacy': {
        target: 'http://127.0.0.1:1421/',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
