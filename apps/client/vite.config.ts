import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/healthz': 'http://localhost:8787',
    },
  },
  build: {
    target: 'es2024',
    outDir: 'dist',
    chunkSizeWarningLimit: 6000,
  },
});
