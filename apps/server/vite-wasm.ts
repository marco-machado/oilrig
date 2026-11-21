import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

// Workers cannot compile WebAssembly from bytes at run time, which is how both physics
// libraries load by default. Their .wasm files are imported instead (a `.wasm?module`
// import is a precompiled WebAssembly.Module) and handed to them in src/wasm/workerd.ts.
// The packages' export maps hide the files, so they are resolved by path.

const require = createRequire(import.meta.url);
const beside = (spec: string, file: string) => path.join(path.dirname(require.resolve(spec)), file);

const FILES: Record<string, () => string> = {
  'virtual:oh/rapier.wasm': () => beside('@dimforge/rapier3d-compat', 'rapier_wasm3d_bg.wasm'),
  'virtual:oh/recast.wasm': () => beside('@recast-navigation/wasm/wasm', 'recast-navigation.wasm.wasm'),
};

/** Resolves the Worker's WASM imports. Only the Worker (server) environment sees them. */
export function workerWasm(): Plugin {
  return {
    name: 'ocean-home:worker-wasm',
    enforce: 'pre',
    applyToEnvironment: (env) => env.config.consumer === 'server',
    resolveId(id) {
      const file = FILES[id];
      return file ? `${file()}?module` : undefined;
    },
  };
}
