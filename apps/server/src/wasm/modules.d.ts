// Resolved by vite-wasm.ts to the libraries' .wasm files, imported as compiled modules.
declare module 'virtual:oh/rapier.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

declare module 'virtual:oh/recast.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
