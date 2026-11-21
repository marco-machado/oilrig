import RAPIER from '@dimforge/rapier3d-compat';
import RecastFactory from '@recast-navigation/wasm/wasm';
import rapierWasm from 'virtual:oh/rapier.wasm';
import recastWasm from 'virtual:oh/recast.wasm';
import type { RecastImpl } from '../agents/navmesh.ts';

// Both physics libraries compile their WASM from bytes by default, which Workers refuse.
// Here they get the precompiled modules that vite-wasm.ts resolves.

export type Rapier = typeof RAPIER;

let rapierReady: Promise<Rapier> | null = null;

/** Rapier's compat build decodes its inline copy and calls WebAssembly.instantiate(bytes);
 * for the length of init() that call gets the identical precompiled module instead. */
export function loadRapier(): Promise<Rapier> {
  rapierReady ??= (async () => {
    const real = WebAssembly.instantiate;
    WebAssembly.instantiate = ((source: unknown, imports?: WebAssembly.Imports) =>
      real(source instanceof WebAssembly.Module ? source : rapierWasm, imports)) as typeof WebAssembly.instantiate;
    try {
      await RAPIER.init();
    } finally {
      WebAssembly.instantiate = real;
    }
    return RAPIER;
  })();
  return rapierReady;
}

/** Recast's Emscripten build takes an `instantiateWasm` hook in place of fetching its file. */
export const recastImpl = (() =>
  RecastFactory({
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
      void WebAssembly.instantiate(recastWasm, imports).then((instance) => done(instance, recastWasm));
      return {};
    },
  })) as unknown as RecastImpl;
