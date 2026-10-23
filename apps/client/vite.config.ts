import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// CLIENT_PORT / SERVER_URL let a second copy run next to the default one.
const server = process.env.SERVER_URL ?? 'http://localhost:8787';

export default defineConfig({
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    proxy: {
      '/ws': { target: server.replace(/^http/, 'ws'), ws: true },
      '/healthz': server,
      '/api': server,
      '/mcp': server,
    },
  },
  build: {
    target: 'es2024',
    outDir: 'dist',
    chunkSizeWarningLimit: 6000,
    // The game, and the standalone object viewer (/viewer.html).
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
      },
      // Rapier inlines its WASM as ~4 MB of base64: a chunk of its own keeps that cached
      // across deploys instead of riding along with every change to the game's code.
      output: {
        codeSplitting: {
          groups: [{ name: 'rapier', test: /[\\/]@dimforge[\\/]rapier3d-compat[\\/]/ }],
        },
      },
    },
  },
});
