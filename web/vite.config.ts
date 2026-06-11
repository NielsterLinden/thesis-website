import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the Vite server proxies API routes to the NestJS backend on :8080;
// in production Nest serves web/dist itself, so paths stay same-origin.
const backend = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/chat': backend,
      '/auth': backend,
      '/meta': backend,
      '/health': backend,
      '/thesis.pdf': backend,
      '/runs.csv': backend,
      '/reports': backend,
    },
  },
  build: {
    outDir: 'dist',
  },
});
