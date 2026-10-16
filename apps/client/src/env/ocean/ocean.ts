import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshPhysicalNodeMaterial,
  Sphere,
  Vector2,
  Vector3,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn,
  cameraFar,
  cameraNear,
  cameraPosition,
  color,
  dot,
  exp,
  float,
  fwidth,
  length,
  linearDepth,
  log2,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionGeometry,
  positionWorld,
  pow,
  saturate,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl';
import { getLayout } from '@ocean-home/shared';
import { U } from '../../state.ts';
import { OceanSimulation } from './simulation.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Camera-centred radial grid in the XY plane (mapped to world XZ by the material). */
function radialGrid(rings: number, sectors: number, spacing: number, soften: number) {
  const radii = new Float64Array(rings + 1);
  for (let i = 1; i <= rings; i++) {
    const g = 1 + (i - 1) / soften;
    radii[i] = radii[i - 1] + spacing * g * g;
  }
  const vertexCount = rings * sectors + 1;
  const pos = new Float32Array(vertexCount * 3);
  const step = (Math.PI * 2) / sectors;
  for (let i = 1; i <= rings; i++) {
    const r = radii[i];
    const off = (i % 2) * 0.5 * step;
    let p = (1 + (i - 1) * sectors) * 3;
    for (let j = 0; j < sectors; j++, p += 3) {
      pos[p] = r * Math.cos(j * step + off);
      pos[p + 1] = r * Math.sin(j * step + off);
    }
  }
  const idx = new Uint32Array(sectors * 3 + (rings - 1) * sectors * 6);
  let k = 0;
  for (let j = 0; j < sectors; j++) {
    idx[k++] = 0;
    idx[k++] = 1 + j;
    idx[k++] = 1 + ((j + 1) % sectors);
  }
  for (let i = 1; i < rings; i++) {
    const a = 1 + (i - 1) * sectors;
    const b = 1 + i * sectors;
    const shift = i % 2 === 0;
    for (let j = 0; j < sectors; j++) {
      const j2 = (j + 1) % sectors;
      if (shift) {
        idx[k++] = a + j; idx[k++] = b + j; idx[k++] = a + j2;
        idx[k++] = a + j2; idx[k++] = b + j; idx[k++] = b + j2;
      } else {
        idx[k++] = a + j; idx[k++] = b + j2; idx[k++] = b + j;
        idx[k++] = a + j; idx[k++] = a + j2; idx[k++] = b + j2;
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.boundingSphere = new Sphere(new Vector3(), radii[rings]);
  return g;
}

export interface OceanQuality {
  N: number;
  rings: number;
  sectors: number;
}

const LENGTHS = [512, 96, 17];

/** Points where the sea meets vertical members, for foam rings. */
function piercings(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const el of getLayout().elements) {
    if (el.type !== 'tube') continue;
    const vertical = Math.abs(el.a[0] - el.b[0]) < 0.01 && Math.abs(el.a[2] - el.b[2]) < 0.01;
    const crosses = Math.min(el.a[1], el.b[1]) < -1 && Math.max(el.a[1], el.b[1]) > 1;
    if (vertical && crosses && el.radius > 0.2) out.push([el.a[0], el.a[2], el.radius]);
  }
  return out;
}

export class Ocean {
  readonly sim: OceanSimulation;
  readonly mesh: Mesh;
  private readonly origin = uniform(new Vector2());
  private readonly material: MeshPhysicalNodeMaterial;

  constructor(renderer: WebGPURenderer, q: OceanQuality) {
    this.sim = new OceanSimulation(renderer, q.N, LENGTHS);
    this.material = this.createMaterial();
    this.mesh = new Mesh(radialGrid(q.rings, q.sectors, 0.3, 36), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'ocean';
  }

  private createMaterial() {
    const cascades = this.sim.cascades;
    const N = this.sim.N;
    const mat = new MeshPhysicalNodeMaterial();
    mat.side = DoubleSide;
    mat.transparent = true;
    mat.depthWrite = true;
    mat.ior = 1.333;
    mat.metalness = 0;
    const origin = this.origin;
    const worldXZ = vec2(positionGeometry.x, positionGeometry.y).add(origin);

    // Rotor downwash flattens the sea under a low helicopter.
    const washD = length(worldXZ.sub(U.washCenter));
    const flatten = float(1).sub(U.washSea.mul(0.55).mul(exp(washD.div(16).pow(2).negate())));
    mat.positionNode = Fn(() => {
      const disp = vec3(0).toVar();
      const camD = length(worldXZ.sub(cameraPosition.xz));
      cascades.forEach((c, i) => {
        const d = texture(c.displacement, worldXZ.div(c.lengthScale)).level(float(0)).xyz;
        // The finest cascade only matters near the eye.
        const fade = i === 2 ? smoothstep(float(400), float(120), camD) : float(1);
        disp.addAssign(d.mul(fade));
      });
      disp.mulAssign(flatten);
      return vec3(positionGeometry.x.add(disp.x), disp.y, positionGeometry.y.add(disp.z));
    })();

    const wxz = varying(worldXZ);
    const footprint = max(fwidth(wxz.x), fwidth(wxz.y)).max(1e-3).toVar();
    const V = normalize(cameraPosition.sub(positionWorld)).toVar();
    const viewDist = length(cameraPosition.sub(positionWorld)).toVar();

    // Band-limited normal and foam from all cascades (pure expressions: no assignments
    // outside a Fn stack).
    let d: any = vec2(0);
    let dz: any = vec2(0);
    let lostVar: any = float(0);
    let foamF: any = float(0);
    for (const c of cascades) {
      const texel = c.lengthScale / N;
      const lod = log2(footprint.div(texel)).max(0);
      const uv = wxz.div(c.lengthScale);
      const s = texture(c.derivatives, uv).level(lod);
      const w = saturate(float(c.lengthScale / 30).div(footprint));
      d = d.add(vec2(s.x, s.y).mul(w));
      dz = dz.add(vec2(s.z, s.w).mul(w));
      lostVar = lostVar.add(s.x.mul(s.x).add(s.y.mul(s.y)).mul(float(1).sub(w.mul(w))));
      const turb = texture(c.displacement, uv).level(lod).w;
      foamF = max(foamF, float(1).sub(turb));
    }
    const slopeX = d.x.div(float(1).add(dz.x));
    const slopeZ = d.y.div(float(1).add(dz.y));
    // Rain roughens the surface with fine ripples.
    const ripple = mx_noise_float(vec3(wxz.mul(6), U.time.mul(4))).mul(U.rain).mul(0.08).mul(smoothstep(60, 5, viewDist));
    // Rotor wash: rings of ripples racing outward from under the helicopter.
    const wv = wxz.sub(U.washCenter);
    const wd = length(wv).max(0.5);
    const wEnv = U.washSea.mul(exp(wd.div(24).pow(2).negate()));
    const wPhase = wd.mul(1.7).sub(U.time.mul(9));
    const wRip = sin(wPhase).mul(wEnv).mul(0.35).mul(mx_noise_float(vec3(wxz.mul(0.8), U.time.mul(0.7))).mul(0.5).add(0.75));
    const wDir = wv.div(wd);
    const Nw = normalize(vec3(slopeX.negate().add(ripple).add(wDir.x.mul(wRip)), float(1), slopeZ.negate().sub(ripple).add(wDir.y.mul(wRip)))).toVar();
    mat.normalNode = transformNormalToView(Nw);

    // Foam: whitecaps from the accumulator plus wash around the legs.
    const foamBase = saturate(foamF.sub(0.58).mul(2.4));
    const pts = piercings();
    let ringFoam: any = float(0);
    const pw = positionWorld.xz;
    for (const [x, z, r] of pts) {
      const dist = length(pw.sub(vec2(x, z))).sub(r);
      ringFoam = max(ringFoam, exp(dist.mul(dist).mul(-1.6)).mul(0.9));
    }
    const waveEnergy = saturate(U.windSpeed.div(12));
    const bubbles = smoothstep(-0.2, 0.5, mx_noise_float(vec3(wxz.mul(3.1), U.time.mul(0.3))));
    const streaks = mx_noise_float(vec3(wxz.mul(vec2(0.6, 0.6)), U.time.mul(0.05))).mul(0.5).add(0.5);
    // Broken, ragged rings rather than clean circles: the ring phase is jittered by noise.
    const wNoise = mx_noise_float(vec3(wxz.mul(0.45), U.time.mul(0.9))).mul(0.5).add(0.5);
    const wRing = smoothstep(0.62, 0.95, sin(wd.mul(0.9).add(wNoise.mul(4)).sub(U.time.mul(6))).mul(0.5).add(0.5));
    const washFoam = wEnv
      .mul(wRing.mul(0.35).add(smoothstep(9, 2, wd).mul(0.3)))
      .mul(smoothstep(0.35, 0.8, mx_noise_float(vec3(wxz.mul(1.3), U.time.mul(1.5))).mul(0.5).add(0.5)));
    const foam = saturate(max(max(foamBase, washFoam), ringFoam.mul(waveEnergy.mul(0.8).add(0.25)).mul(streaks.add(0.3))).mul(bubbles.mul(0.6).add(0.4))).toVar();

    const NoV = saturate(dot(Nw, V)).max(1e-3);
    const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(NoV), 5))).toVar();

    // Refraction with depth-based absorption, so the submerged jacket shows through.
    const nearScale = float(1).div(viewDist.mul(0.05).add(1));
    const rUV = screenUV.add(vec2(Nw.x, Nw.z).mul(0.06).mul(nearScale)).toVar();
    const fragLin = linearDepth();
    const range = cameraFar.sub(cameraNear);
    const sceneLinR = linearDepth(viewportDepthTexture(rUV));
    const useR = sceneLinR.greaterThan(fragLin);
    const uvFinal = select(useR, rUV, screenUV);
    const sceneLin = linearDepth(viewportDepthTexture(uvFinal));
    const thickness = max(sceneLin.sub(fragLin).mul(range), 0).toVar();
    const sceneCol = viewportSharedTexture(uvFinal).rgb;
    const sigma = vec3(0.42, 0.085, 0.07);
    const T = exp(sigma.negate().mul(thickness.mul(1.3)));
    const ambient = vec3(U.fogColor).mul(0.55).add(vec3(U.sunColor).mul(U.sunIntensity.mul(saturate(U.sunDir.y)).mul(0.0028)));
    const deep: any = color(0x02303d);
    const inscatter = deep.mul(ambient).mul(float(1).sub(T));
    // Light scattered through thin wave crests facing away from the sun.
    const L = vec3(U.sunDir);
    const height = positionWorld.y;
    const sss = color(0x1f9c8f)
      .mul(pow(saturate(dot(V, L.negate()).add(0.25)), 3))
      .mul(saturate(height.mul(0.6).add(0.3)))
      .mul(vec3(U.sunColor).mul(U.sunIntensity.mul(0.0035)))
      .mul(smoothstep(600, 60, viewDist));
    const body = sceneCol.mul(T).add(inscatter).add(sss);
    mat.emissiveNode = body.mul(float(1).sub(F)).mul(float(1).sub(foam));

    mat.colorNode = mix(color(0x000000), color(0xe8eef0), foam);
    const rough = min(sqrt(float(0.0016).add(lostVar.mul(0.5)).add(saturate(footprint.mul(0.004)).mul(0.04))), 0.35);
    mat.roughnessNode = mix(rough.add(U.rain.mul(0.08)), float(0.9), foam);
    return mat;
  }

  update(t: number, dt: number, camera: Vector3, windSpeed: number, windDirection: number) {
    this.sim.setWind(windSpeed, windDirection);
    this.sim.update(t, dt);
    const snap = 0.3;
    const ox = Math.round(camera.x / snap) * snap;
    const oz = Math.round(camera.z / snap) * snap;
    this.origin.value.set(ox, oz);
    this.mesh.position.set(ox, 0, oz);
  }
}

