import {
  CircleGeometry,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  PMREMGenerator,
  type RenderTarget,
  Scene,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import { Fn, cameraPosition, exp, float, fog, length, positionWorld, vec3 } from 'three/tsl';
import { SunLight } from 'three/addons/lights/SunLight.js';
import type { Celestial, WeatherState } from '@ocean-home/shared';
import { U } from '../state.ts';
import { OceanSky, type SkyParams, skyRadiance, sunTransmittance } from './sky.ts';

const SAMPLE_DIRS = [
  new Vector3(0, 1, 0),
  new Vector3(1, 0.5, 0).normalize(),
  new Vector3(-1, 0.5, 0).normalize(),
  new Vector3(0, 0.5, 1).normalize(),
  new Vector3(0, 0.5, -1).normalize(),
];

/** How much lamplight near the camera counts towards the exposure, against sky and sun. */
const LAMP_ADAPTATION = 0.2;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface AtmosphereOptions {
  shadowMapSize: number;
  shadowDistance: number;
}

/** Drives sky, sun/moon light, image-based lighting, exposure, fog and wetness. */
export class Atmosphere {
  readonly sky = new OceanSky();
  readonly sun = new SunLight(0xffffff, 1);
  private readonly pmrem: PMREMGenerator;
  private envTarget: RenderTarget | null = null;
  private readonly envScene = new Scene();
  private readonly lastEnvSun = new Vector3(0, -2, 0);
  private lastEnvCloud = -1;
  private lastEnvTime = -1e9;
  private exposure = 0.2;
  private wet = 0;
  private flash = 0;
  private nextFlash = 5;
  private readonly params: SkyParams = { turbidity: 2.2, rayleigh: 1.2, mieCoefficient: 0.005, mieDirectionalG: 0.8 };
  private readonly sunVec = new Vector3();
  private readonly moonVec = new Vector3();
  private readonly tmp = new Vector3();
  /** Called with a delay (s) when lightning strikes, so audio can play thunder. */
  onLightning: ((distanceSeconds: number) => void) | null = null;

  private readonly scene: Scene;

  constructor(renderer: WebGPURenderer, scene: Scene, opts: AtmosphereOptions) {
    this.scene = scene;
    this.pmrem = new PMREMGenerator(renderer);
    this.sky.scale.setScalar(50);
    scene.add(this.sky);

    // Dim "sea" below the horizon in the environment capture so the lower hemisphere
    // does not light the scene like a second sky.
    const groundMat = new MeshBasicNodeMaterial();
    groundMat.colorNode = vec3(U.fogColor).mul(0.32);
    const ground = new Mesh(new CircleGeometry(400, 32), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    this.envScene.add(ground);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
    this.sun.shadow.camera.far = opts.shadowDistance;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);

    const fogFactor = Fn(() => {
      const d = length(positionWorld.sub(cameraPosition));
      return float(1).sub(exp(U.fogDensity.mul(d).negate()));
    });
    scene.fogNode = fog(U.fogColor, fogFactor());
  }

  setShadowQuality(size: number, distance: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.camera.far = distance;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** `lamps`: lamplight falling around the camera (see lampLightAt), which the exposure adapts to as well. */
  update(dt: number, cameraPos: Vector3, c: Celestial, w: WeatherState, lamps = 0) {
    const sky = this.sky;
    this.sunVec.set(...c.sunDirection);
    this.moonVec.set(...c.moonDirection);
    sky.position.copy(cameraPos);
    sky.sunPosition.value.copy(this.sunVec);
    sky.moonPosition.value.copy(this.moonVec);
    sky.moonIllumination.value = c.moonIllumination;
    sky.starEx.value.set(...c.basis.ex);
    sky.starEy.value.set(...c.basis.ey);
    sky.starPole.value.set(...c.basis.pole);
    sky.cloudCoverage.value = w.cloudCover;
    sky.cloudDensity.value = 0.35 + 0.65 * w.cloudDensity;
    const haze = Math.min(1, w.fog * 0.95 + w.rain * 0.35);
    const overcast = Math.min(1, w.cloudCover * w.cloudCover * (0.35 + 0.65 * w.cloudDensity));
    const dim = (1 - 0.72 * overcast) * (1 - 0.5 * w.storminess);
    sky.dim.value = dim;
    sky.haze.value = haze;
    sky.storm.value = w.storminess;
    this.params.turbidity = 2.2 + 5 * haze;
    sky.turbidity.value = this.params.turbidity;
    // Cloud drift at the speed of a real layer: wind aloft (about twice the surface wind) over a
    // deck ~1.5 km up. The shader's cloud UV is (horizontal / height) * cloudScale / elevation, so
    // a layer moving at V m/s advances V / 1500 * cloudScale / elevation UV per second; cloudTime
    // counts that in units of cloudSpeed. A small floor keeps the shapes evolving on calm days.
    const aloft = 2 * w.windSpeed;
    const elevation = 1 - 0.9 * sky.cloudElevation.value;
    const uvPerSecond = ((aloft / 1500) * sky.cloudScale.value) / elevation;
    sky.cloudTime.value += dt * (0.05 + uvPerSecond / sky.cloudSpeed.value);

    // Wind for ocean, clouds, grass, windsock, rain.
    const wd = (w.windDirection * Math.PI) / 180;
    U.windDir.value.set(Math.sin(wd), -Math.cos(wd));
    U.windSpeed.value = w.windSpeed;
    U.rain.value = w.rain;

    // Wetness rises fast in rain and dries slowly.
    const target = w.rain > 0.05 ? Math.min(1, 0.4 + w.rain) : 0;
    const rate = target > this.wet ? 0.08 : 0.004;
    this.wet += (target - this.wet) * Math.min(1, rate * dt * 10);
    U.wetness.value = this.wet;

    // Direct light: the sun by day, the moon by night.
    const cloudBlock = Math.pow(w.cloudCover, 1.5) * (0.45 + 0.5 * w.cloudDensity);
    const sunElev = c.sunElevation;
    const sunUp = smooth(-1.5, 2.5, sunElev);
    const st = sunTransmittance(this.params, this.sunVec);
    const maxc = Math.max(...st.rgb, 1e-6);
    const sunIrr = 150 * maxc * (1 - 0.92 * cloudBlock) * sunUp;
    const moonUp = smooth(-2, 4, c.moonElevation) * (1 - sunUp);
    const moonIrr = 0.55 * c.moonIllumination * moonUp * (1 - 0.85 * cloudBlock);
    const useSun = sunIrr >= moonIrr;
    const dir = useSun ? this.sunVec : this.moonVec;
    this.sun.position.copy(dir).multiplyScalar(100);
    if (useSun) {
      this.sun.color.setRGB(st.rgb[0] / maxc, st.rgb[1] / maxc, st.rgb[2] / maxc);
      this.sun.intensity = sunIrr;
    } else {
      this.sun.color.setRGB(0.62, 0.72, 1.0);
      this.sun.intensity = moonIrr;
    }
    // castShadow stays on: toggling it changes the light set (every lit shader rebuilds) and
    // three 0.186 disposes the sun's shadow node while old shaders still update it, which
    // throws mid-render. Too dim to cast: fade the shadow out and stop re-rendering its map.
    const casts = (useSun ? sunIrr : moonIrr * 20) > 0.5;
    this.sun.shadow.intensity = casts ? 1 : 0;
    this.sun.shadow.autoUpdate = casts;
    U.sunDir.value.copy(dir);
    U.sunColor.value.copy(this.sun.color);
    U.sunIntensity.value = this.sun.intensity;

    // Fog colour from the horizon sky, greyed by cloud.
    let fr = 0;
    let fg = 0;
    let fb = 0;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.tmp.set(Math.cos(a), 0.04, Math.sin(a)).normalize();
      const r = skyRadiance(this.params, this.sunVec, this.tmp);
      fr += r[0] / 4;
      fg += r[1] / 4;
      fb += r[2] / 4;
    }
    const lum = 0.2126 * fr + 0.7152 * fg + 0.0722 * fb;
    const grey = Math.min(1, w.cloudCover * 0.8 + haze * 0.5);
    const night = 1 - smooth(-10, 2, sunElev);
    const nightFloor = 0.0012 + 0.002 * c.moonIllumination * moonUp;
    const mixc = (v: number, tint: number) => Math.max(v * (1 - grey) + lum * tint * grey * 0.85, nightFloor * tint * night);
    U.fogColor.value.setRGB(mixc(fr, 0.95) * dim, mixc(fg, 1.0) * dim, mixc(fb, 1.06) * dim);
    U.fogDensity.value = 0.00003 + 0.0002 * w.rain + 0.011 * Math.pow(w.fog, 2.2);

    // Exposure follows an estimate of scene light (sky + direct), with eye adaptation.
    let skyLum = 0;
    for (const d of SAMPLE_DIRS) {
      const r = skyRadiance(this.params, this.sunVec, d);
      skyLum += (0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]) / SAMPLE_DIRS.length;
    }
    // Cloud radiance mirrors the sky shader: ambient + sun-lit shade, greyed when thick.
    const sunCloud = sunUp * st.strength * 1000 * maxc * 0.0088 * 0.7;
    const cloudLum = (skyLum + sunCloud) * (1 - 0.4 * w.storminess);
    const cover = Math.min(1, Math.pow(w.cloudCover, 0.8));
    skyLum = (skyLum * (1 - cover) + cloudLum * cover) * dim + nightFloor * 0.5;
    const sinElev = Math.max(0.3, Math.sin((Math.max(sunElev, 0) * Math.PI) / 180));
    const direct = ((this.sun.intensity * 0.8) / Math.PI) * 0.25 * (useSun ? sinElev : 1);
    // Partial adaptation: darker scenes are brightened, but storms and dusk stay moody. Lamplight
    // counts too: at night a lit room or a floodlit deck sets the exposure, not the dark sky.
    const sceneLight = skyLum * 0.5 + direct + lamps * LAMP_ADAPTATION + 0.0005;
    const target2 = Math.min(6, Math.max(0.05, 0.1 * Math.pow(10.6 / sceneLight, 0.78)));
    const k = Math.min(1, dt * 1.5);
    this.exposure = Math.exp(Math.log(this.exposure) + (Math.log(target2) - Math.log(this.exposure)) * k);
    U.exposure.value = this.exposure;
    // Matte white under this sky: the sky's own radiance plus the sun (or moon) on a surface
    // half turned towards it.
    const sunPart = (this.sun.intensity * 0.5) / Math.PI;
    U.ambient.value.setRGB(skyLum + sunPart * this.sun.color.r, skyLum + sunPart * this.sun.color.g, skyLum + sunPart * this.sun.color.b);

    U.nightLights.value = 1 - smooth(-3, 6, sunElev) * (1 - 0.5 * w.storminess * w.cloudCover);

    // Lightning.
    this.flash = Math.max(0, this.flash - dt * 6);
    if (w.storminess > 0.4) {
      this.nextFlash -= dt * w.storminess;
      if (this.nextFlash <= 0) {
        this.flash = 1;
        this.nextFlash = 4 + Math.random() * 14;
        this.onLightning?.(0.8 + Math.random() * 5);
      }
    }
    const flicker = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40)) : 0;
    U.lightning.value = flicker * 0.02;

    this.updateEnvironment(c, w);
  }

  private updateEnvironment(c: Celestial, w: WeatherState) {
    const now = performance.now();
    const sunMoved = this.lastEnvSun.angleTo(this.sunVec) > 0.006;
    const cloudChanged = Math.abs(this.lastEnvCloud - w.cloudCover) > 0.03;
    if (!sunMoved && !cloudChanged && now - this.lastEnvTime < 15000 && this.envTarget) return;
    if (now - this.lastEnvTime < 500 && this.envTarget) return;
    this.lastEnvSun.copy(this.sunVec);
    this.lastEnvCloud = w.cloudCover;
    this.lastEnvTime = now;
    void c;
    const pos = this.sky.position.clone();
    this.sky.position.set(0, 0, 0);
    this.envScene.add(this.sky);
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000, {
      size: 256,
      renderTarget: this.envTarget,
    });
    this.scene.add(this.sky);
    this.sky.position.copy(pos);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 1.25;
  }

  get environmentTexture() {
    return this.envTarget?.texture ?? null;
  }
}

export const NIGHT_COLOR = new Color(0x0b1220);
