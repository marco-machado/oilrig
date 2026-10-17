import { Color, Vector2, Vector3, Vector4 } from 'three/webgpu';
import { uniform } from 'three/tsl';

/** Global shader uniforms shared by materials, sky, ocean and weather. */
export const U = {
  time: uniform(0),
  /** 0 = dry, 1 = soaked. */
  wetness: uniform(0),
  /** 0 = lights off (day), 1 = full night lighting. */
  nightLights: uniform(0),
  /** Unit vector the wind blows toward, in world XZ. */
  windDir: uniform(new Vector2(1, 0)),
  windSpeed: uniform(5),
  sunDir: uniform(new Vector3(0, 1, 0)),
  // Colour uniforms are typed loosely so they compose with vec3 math in TSL.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sunColor: uniform(new Color(1, 1, 1)) as any,
  /** Sun irradiance reaching the surface (scene units). */
  sunIntensity: uniform(1),
  rain: uniform(0),
  lightning: uniform(0),
  /**
   * Radiance of a matte white surface under the sky and sun (or moon), for unlit effects
   * (rotor spray, blurred rotors) so they are as bright as the world around them.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ambient: uniform(new Color(1, 1, 1)) as any,
  /** Pre-tonemap exposure multiplier applied in the post pipeline. */
  exposure: uniform(1),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fogColor: uniform(new Color(0.5, 0.6, 0.7)) as any,
  fogDensity: uniform(0.0002),
  /** Drone rotor wash on the sea: centre (world xz) and strength 0..1. */
  washCenter: uniform(new Vector2(42, 0)),
  washSea: uniform(0),
  /** The drone's cabin (centre xyz, radius w; w = 0 when not around): rain stays out of it. */
  droneCabin: uniform(new Vector4(0, -100, 0, 0)),
};
