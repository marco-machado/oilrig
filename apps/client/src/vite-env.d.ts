/// <reference types="vite/client" />

declare module 'three/addons/lighting/LightProbeGridUtils.js' {
  import type { Scene } from 'three/webgpu';
  export function replaceSunLights(scene: Scene): object[] | null;
  export function restoreSunLights(scene: Scene, replacements: object[]): void;
}
