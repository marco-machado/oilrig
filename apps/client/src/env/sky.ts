// Physical sky: Preetham scattering and procedural clouds adapted from three.js
// SkyMesh (MIT), extended with a rotating star field, a phase-lit moon, haze/fog,
// storm darkening and lightning.
import { BackSide, BoxGeometry, Mesh, NodeMaterial, Vector3 } from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  abs,
  acos,
  add,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  modelViewProjection,
  mul,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  sub,
  uniform,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { U } from '../state.ts';

export class OceanSky extends Mesh {
  readonly turbidity = uniform(2.2);
  readonly rayleigh = uniform(1.2);
  readonly mieCoefficient = uniform(0.005);
  readonly mieDirectionalG = uniform(0.8);
  readonly sunPosition = uniform(new Vector3(0, 1, 0));
  readonly moonPosition = uniform(new Vector3(0, -1, 0));
  readonly moonIllumination = uniform(1);
  readonly starEx = uniform(new Vector3(1, 0, 0));
  readonly starEy = uniform(new Vector3(0, 1, 0));
  readonly starPole = uniform(new Vector3(0, 0, 1));
  readonly cloudScale = uniform(0.0002);
  readonly cloudSpeed = uniform(0.00002);
  readonly cloudCoverage = uniform(0.3);
  readonly cloudDensity = uniform(0.4);
  readonly cloudElevation = uniform(0.5);
  readonly haze = uniform(0);
  readonly storm = uniform(0);
  /** Overall dimming under thick overcast and storms (shared with the CPU exposure model). */
  readonly dim = uniform(1);
  readonly cloudTime = uniform(0);
  /**
   * View directions whose y is below this are left black. The game's own render sets it to
   * where the sea surely covers the sky (Ocean.coversBelow): the sea is drawn in a later pass,
   * so the GPU cannot skip the hidden sky by itself, and at 1440p it was shaded under the whole
   * sea every frame. -2 shades everything, as the environment map and the light probes need.
   */
  readonly hiddenBelow = uniform(-2);

  constructor() {
    const material = new NodeMaterial();
    super(new BoxGeometry(1, 1, 1), material);
    this.frustumCulled = false;
    this.renderOrder = -1000;

    const vSunDirection = varyingProperty('vec3');
    const vSunE = varyingProperty('float');
    const vBetaR = varyingProperty('vec3');
    const vBetaM = varyingProperty('vec3');
    /* eslint-disable @typescript-eslint/no-explicit-any */

    const vertexNode = Fn(() => {
      const e = float(2.718281828459045);
      const totalRayleigh = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
      const MieConst = vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
      const cutoffAngle = float(1.6110731556870734);
      const steepness = float(1.5);
      const EE = float(1000.0);
      const sunDirection = normalize(this.sunPosition);
      vSunDirection.assign(sunDirection);
      const zenithAngleCos = clamp(sunDirection.y, -1, 1);
      vSunE.assign(EE.mul(max(0.0, float(1.0).sub(pow(e, cutoffAngle.sub(acos(zenithAngleCos)).div(steepness).negate())))));
      const sunfade = float(1.0).sub(clamp(float(1.0).sub(exp(this.sunPosition.y.div(450000.0))), 0, 1));
      const rayleighCoefficient = this.rayleigh.sub(float(1.0).mul(float(1.0).sub(sunfade)));
      vBetaR.assign(totalRayleigh.mul(rayleighCoefficient));
      const c = float(0.2).mul(this.turbidity).mul(10e-18);
      const totalMie = float(0.434).mul(c).mul(MieConst);
      vBetaM.assign(totalMie.mul(this.mieCoefficient));
      const position: any = modelViewProjection;
      position.z.assign(position.w);
      return position;
    })();

    const hash3 = Fn(([p]: any[]) => {
      const q: any = fract(p.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
      q.addAssign(dot(q, q.yxz.add(33.33)));
      return fract(q.xxy.add(q.yxx).mul(q.zyx));
    });

    const colorNode = Fn(() => {
      const pi = float(3.141592653589793);
      const rayleighZenithLength = float(8.4e3);
      const mieZenithLength = float(1.25e3);
      const sunAngularDiameterCos = float(0.9999566769464484);
      const THREE_OVER_SIXTEENPI = float(0.05968310365946075);
      const ONE_OVER_FOURPI = float(0.07957747154594767);

      const direction = normalize(positionWorld.sub(cameraPosition)).toVar();
      const sky = vec3(0).toVar();
      If(direction.y.greaterThanEqual(this.hiddenBelow), () => {
        const zenithAngle = acos(max(0.0, direction.y));
        const inverse = float(1.0).div(
          cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(180.0).div(pi)), -1.253))),
        );
        const sR = rayleighZenithLength.mul(inverse);
        const sM = mieZenithLength.mul(inverse);
        const Fex = exp(mul(vBetaR, sR).add(mul(vBetaM, sM)).negate()).toVar();
        const cosTheta = dot(direction, vSunDirection);
        const c = cosTheta.mul(0.5).add(0.5);
        const rPhase = THREE_OVER_SIXTEENPI.mul(float(1.0).add(pow(c, 2.0)));
        const betaRTheta = vBetaR.mul(rPhase);
        const g2 = pow(this.mieDirectionalG, 2.0);
        const inv = float(1.0).div(pow(float(1.0).sub(float(2.0).mul(this.mieDirectionalG).mul(cosTheta)).add(g2), 1.5));
        const mPhase = ONE_OVER_FOURPI.mul(float(1.0).sub(g2)).mul(inv);
        const betaMTheta = vBetaM.mul(mPhase);
        const Lin = pow(vSunE.mul(add(betaRTheta, betaMTheta).div(add(vBetaR, vBetaM))).mul(sub(1.0, Fex)), vec3(1.5)).toVar();
        Lin.mulAssign(
          mix(
            vec3(1.0),
            pow(vSunE.mul(add(betaRTheta, betaMTheta).div(add(vBetaR, vBetaM))).mul(Fex), vec3(1.0 / 2.0)),
            clamp(pow(sub(1.0, vSunDirection.y), 5.0), 0.0, 1.0),
          ),
        );
        const L0 = vec3(0.1).mul(Fex);
        const sundisc = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos.add(0.00002), cosTheta);
        const sundiscColor = min(vSunE.mul(Fex), 80.0).mul(760.0).mul(sundisc);
        const texColor = add(Lin, L0).mul(0.04).add(sundiscColor).add(vec3(0.0, 0.0003, 0.00075)).toVar();

        // Night: deep blue airglow, stars fixed to the rotating celestial sphere, moon.
        const night = smoothstep(0.05, -0.18, vSunDirection.y).toVar();
        const horizonFade = smoothstep(-0.02, 0.12, direction.y);
        const horizonGlow = float(1).sub(max(direction.y, 0.0)).pow(3.0).mul(2.0).add(1.0);
        texColor.addAssign(vec3(0.0022, 0.0034, 0.0075).mul(night).mul(horizonGlow));
        const eq = vec3(dot(direction, this.starEx), dot(direction, this.starEy), dot(direction, this.starPole));
        // Stars and the moon cost a few hashes and a noise per pixel: only where they can show.
        const starAcc = float(0).toVar();
        const scales = [140, 260];
        If(night.greaterThan(0.0), () => {
          for (const scale of scales) {
            const cell = floor(eq.mul(scale));
            const h: any = hash3(cell);
            const center = cell.add(0.5).add(h.sub(0.5).mul(0.7)).div(scale);
            const d = length(normalize(eq).sub(normalize(center))).mul(scale);
            const present = smoothstep(0.93, 0.97, h.x);
            const mag = pow(h.z, 6.0).mul(2.2).add(0.12);
            const tw = sqrt(fract(h.y.mul(91.7).add(U.time.mul(h.y.add(0.5)).mul(150.0)))).mul(0.4).add(0.6);
            starAcc.addAssign(present.mul(mag).mul(tw).mul(smoothstep(0.22, 0.0, d)));
          }
        });
        texColor.addAssign(vec3(0.8, 0.86, 1.0).mul(starAcc).mul(0.06).mul(night).mul(horizonFade).mul(float(1).sub(this.haze)));

        const moonDir = normalize(this.moonPosition);
        const moonVisible = smoothstep(-0.05, 0.03, moonDir.y).toVar();
        If(moonVisible.greaterThan(0.0), () => {
          const moonR = float(0.0095);
          const md = direction.sub(moonDir.mul(dot(direction, moonDir)));
          const mr = length(md).div(moonR);
          const facing = smoothstep(0.0, 0.001, dot(direction, moonDir));
          const moonDisc = smoothstep(1.0, 0.94, mr).mul(facing).toVar();
          const surface = float(0).toVar();
          If(moonDisc.greaterThan(0.0), () => {
            const sphereN = normalize(md.div(moonR).sub(moonDir.mul(sqrt(max(float(1).sub(mr.mul(mr)), 0.0)))));
            const lit = smoothstep(-0.08, 0.12, dot(sphereN, vSunDirection));
            const maria = mx_noise_float(md.div(moonR).mul(2.3)).mul(0.5).add(0.5).mul(0.3).add(0.72);
            surface.assign(moonDisc.mul(lit).mul(maria).mul(0.18));
          });
          const moonGlow = pow(max(dot(direction, moonDir), 0.0), 900.0).mul(0.004).add(pow(max(dot(direction, moonDir), 0.0), 40.0).mul(0.0006));
          texColor.addAssign(vec3(1.0, 0.97, 0.9).mul(surface.add(moonGlow.mul(this.moonIllumination))).mul(moonVisible));
        });

        If(direction.y.greaterThan(0.0).and(this.cloudCoverage.greaterThan(0.0)), () => {
          const gradient: any = Fn(([i]: any[]) => {
            const p: any = fract(i.xyx.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
            p.addAssign(dot(p, p.yzx.add(33.33)));
            return fract(p.xx.add(p.yz).mul(p.zy)).mul(2.0).sub(1.0);
          });
          const noise = Fn(([p]: any[]) => {
            const i: any = floor(p);
            const f: any = fract(p);
            const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));
            const a = dot(gradient(i), f);
            const b = dot(gradient(i.add(vec2(1.0, 0.0))), f.sub(vec2(1.0, 0.0)));
            const cc = dot(gradient(i.add(vec2(0.0, 1.0))), f.sub(vec2(0.0, 1.0)));
            const d = dot(gradient(i.add(vec2(1.0, 1.0))), f.sub(vec2(1.0, 1.0)));
            return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y).mul(1.6);
          });
          const fbm = Fn(([position, drift]: any[]) => {
            const p: any = vec2(position).toVar();
            const result = float(0.0).toVar();
            const amplitude = float(1.0).toVar();
            Loop(5, () => {
              result.addAssign(amplitude.mul(noise(p)));
              amplitude.mulAssign(0.5);
              p.mulAssign(2.0).addAssign(drift);
            });
            return result;
          });
          const elevation = mix(1.0, 0.1, this.cloudElevation);
          const cloudUV = direction.xz.div(direction.y.mul(elevation)).toVar();
          cloudUV.mulAssign(this.cloudScale);
          cloudUV.addAssign(vec2(U.windDir.x, U.windDir.y).mul(this.cloudTime.mul(this.cloudSpeed)));
          const evolve = this.cloudTime.mul(this.cloudSpeed).mul(300.0);
          const cloudNoise = fbm(cloudUV.mul(1000.0), evolve).mul(0.7).add(0.5).clamp(0.0, 1.0).toVar();
          const region = noise(cloudUV.mul(300.0)).mul(0.37).add(0.5);
          const cov = clamp(this.cloudCoverage.add(region.sub(0.5).mul(mix(0.6, 0.0, smoothstep(0.75, 0.95, this.cloudCoverage)))).add(smoothstep(0.8, 1.0, this.cloudCoverage).mul(0.5)), 0.0, 1.5);
          const threshold = sub(1.0, cov).toVar();
          const cloudMask = smoothstep(threshold, threshold.add(0.3), cloudNoise).toVar();
          const hf = smoothstep(0.0, add(0.03, mul(0.06, this.cloudElevation)), direction.y);
          cloudMask.mulAssign(hf);
          const dayFactor = smoothstep(-0.08, 0.3, vSunDirection.y);
          const sunColor = vSunE.mul(Fex).mul(0.22).mul(0.04).toVar();
          const skyAmbient = Lin.mul(0.04).add(vec3(0.0, 0.0003, 0.00075));
          const depth = max(0.0, cloudNoise.sub(threshold)).toVar();
          const beer = exp(depth.mul(-4.0)).toVar();
          const powder = sub(1.0, beer.mul(beer));
          const shade = mix(0.45, 1.0, beer.mul(powder).mul(2.6).clamp(0.0, 1.0));
          const silver = float(0.51).div(pow(sub(1.49, cosTheta.mul(1.4)), 1.5)).clamp(0.0, 3.0);
          const edge = cloudMask.mul(sub(1.0, cloudMask)).mul(4.0);
          const cloudColor = skyAmbient.add(sunColor.mul(shade)).toVar();
          cloudColor.addAssign(sunColor.mul(silver).mul(edge).mul(0.6));
          cloudColor.mulAssign(dayFactor.max(0.03));
          // Moonlit cloud tops and storm darkening.
          cloudColor.addAssign(vec3(0.0016, 0.0018, 0.0024).mul(this.moonIllumination).mul(shade).mul(night).mul(moonVisible));
          // Thick overcast is grey rather than sky-blue; storm cores darker still.
          const overcast = this.cloudCoverage.mul(this.cloudCoverage).mul(this.cloudDensity).clamp(0, 1);
          const cl = dot(cloudColor, vec3(0.2126, 0.7152, 0.0722));
          cloudColor.assign(mix(cloudColor, vec3(cl).mul(vec3(0.96, 1.0, 1.05)), overcast));
          cloudColor.mulAssign(float(1).sub(this.storm.mul(0.4).mul(depth.mul(2.0).clamp(0.3, 1.0))));
          const alpha = sub(1.0, exp(depth.mul(this.cloudDensity).mul(-12.0))).mul(hf).toVar();
          texColor.subAssign(L0.mul(0.04).add(sundiscColor).mul(alpha));
          texColor.assign(max(texColor, vec3(0)));
          const cloudAerial = mix(texColor, cloudColor, Fex);
          texColor.assign(mix(texColor, cloudAerial, alpha));
        });

        // Haze/fog toward the horizon, then lightning.
        const lum = dot(texColor, vec3(0.2126, 0.7152, 0.0722));
        const hazeCol = vec3(lum).mul(vec3(0.95, 1.0, 1.06)).max(vec3(0.0006, 0.0008, 0.001));
        const hazeAmt = this.haze.mul(float(1).sub(smoothstep(0.0, mix(0.15, 0.6, this.haze), abs(direction.y))));
        texColor.assign(mix(texColor, hazeCol, hazeAmt.clamp(0, 1)));
        texColor.mulAssign(this.dim);
        texColor.addAssign(vec3(0.75, 0.8, 1.0).mul(U.lightning).mul(0.6));
        sky.assign(texColor);
      });
      return vec4(sky, 1.0);
    })();

    material.side = BackSide;
    material.depthWrite = false;
    material.fog = false;
    material.vertexNode = vertexNode;
    material.colorNode = colorNode;
  }
}

// ---------- CPU mirror of the Preetham terms, for lighting and fog colours ----------

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const FLOOR = [0, 0.0003, 0.00075];

function sunE(sunY: number) {
  const zen = Math.acos(Math.max(-1, Math.min(1, sunY)));
  return 1000 * Math.max(0, 1 - Math.exp(-(1.6110731556870734 - zen) / 1.5));
}

// These run several times a frame (fog colour, exposure), so they keep their working values
// in module scope instead of building arrays: R and M are the scattering coefficients,
// FEX the extinction towards the last direction asked for.
const R = [0, 0, 0];
const M = [0, 0, 0];
const FEX = [0, 0, 0];

function betas(p: SkyParams, sunY: number) {
  const sunfade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(sunY / 450000)));
  const rc = p.rayleigh - (1 - sunfade);
  const c = 0.2 * p.turbidity * 10e-18;
  for (let i = 0; i < 3; i++) {
    R[i] = TOTAL_RAYLEIGH[i] * rc;
    M[i] = 0.434 * c * MIE_CONST[i] * p.mieCoefficient;
  }
}

/** Needs betas() first. */
function extinction(dirY: number) {
  const zen = Math.acos(Math.max(0, dirY));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  for (let i = 0; i < 3; i++) FEX[i] = Math.exp(-(R[i] * 8400 * inv + M[i] * 1250 * inv));
}

/**
 * Sky radiance (scene units, same as the shader) for a direction. Clouds ignored. Written to
 * `out`, which is returned: pass one to keep the caller free of garbage.
 */
export function skyRadiance(p: SkyParams, sun: Vector3, dir: Vector3, out: number[] = [0, 0, 0]): number[] {
  betas(p, sun.y);
  extinction(dir.y);
  const E = sunE(sun.y);
  const cosT = dir.dot(sun);
  const rPhase = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const mPhase = (0.07957747154594767 * (1 - g * g)) / Math.pow(1 - 2 * g * cosT + g * g, 1.5);
  const k = Math.min(1, Math.max(0, Math.pow(1 - sun.y, 5)));
  for (let i = 0; i < 3; i++) {
    const ratio = (R[i] * rPhase + M[i] * mPhase) / (R[i] + M[i]);
    let lin = Math.pow(E * ratio * (1 - FEX[i]), 1.5);
    lin *= 1 + (Math.sqrt(E * ratio * FEX[i]) - 1) * k;
    out[i] = (lin + 0.1 * FEX[i]) * 0.04 + FLOOR[i];
  }
  return out;
}

/**
 * Colour (written to `rgb`) and relative strength (returned) of direct sunlight after
 * atmospheric extinction.
 */
export function sunTransmittance(p: SkyParams, sun: Vector3, rgb: number[]): number {
  betas(p, sun.y);
  extinction(Math.max(sun.y, 0.0));
  for (let i = 0; i < 3; i++) rgb[i] = FEX[i];
  return sunE(sun.y) / 1000;
}
