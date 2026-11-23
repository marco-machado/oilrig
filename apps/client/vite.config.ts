import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// `pnpm dev` (scripts/dev.ts) runs the Node server next to Vite; the paths the server answers
// are passed on to it. The Host header is left as the browser sent it (changeOrigin: false),
// because the server refuses requests whose Origin is not the address they came to.

const server = `http://localhost:${process.env.SERVER_PORT ?? 8787}`;
const toServer = { target: server, changeOrigin: false };

export default defineConfig({
  server: {
    port: Number(process.env.CLIENT_PORT ?? 5173),
    proxy: {
      '^/ws$': { ...toServer, ws: true },
      '^/(auth|api)/': toServer,
      '^/(mcp|healthz)$': toServer,
    },
  },
  environments: {
    client: {
      build: {
        // The Node server serves this directory (STATIC_DIR).
        outDir: 'dist/client',
        emptyOutDir: true,
        target: 'es2024',
        chunkSizeWarningLimit: 6000,
        // The game, the standalone object viewer (/viewer.html) and the sign-up page.
        rolldownOptions: {
          input: {
            main: resolve(import.meta.dirname, 'index.html'),
            viewer: resolve(import.meta.dirname, 'viewer.html'),
            signup: resolve(import.meta.dirname, 'signup.html'),
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
    },
  },
});
