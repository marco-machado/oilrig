import { DataTexture, FloatType, type Light, RGBAFormat, type Vector3, type WebGPURenderer } from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { Fn, clamp, dot, float, int, ivec2, log, normalize, positionView, positionWorld, screenUV, smoothstep, textureLoad, vec2 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A point light can be aimed: set `light.userData.aim` to a world-space unit vector and
 * `light.userData.cone` to the cosine of the beam's half angle. It then lights only what lies
 * inside that cone (with a soft edge), like a recessed downlight or a floodlight, so the
 * ceiling a downlight sits in, the rail beside a floodlight or the drone above its own landing
 * light stay dark. Aimed lights stay clustered point lights: a spot light would be evaluated in
 * every lit material instead.
 */
export interface AimedLight {
  aim?: Vector3;
  cone?: number;
}

/** Width of a cone's soft edge, in cosine. */
export const CONE_SOFTNESS = 0.22;

/**
 * Clustered lighting whose cluster grid never changes size, with aimed point lights.
 *
 * three 0.186 bakes the grid (NX × NY screen tiles of 32 px) into every lit shader as
 * constants and rebuilds the grid whenever the drawing buffer changes size, so a window
 * resize or a dynamic-resolution step rebuilt every lit shader (about a second). Here
 * the grid is built once, from the first drawing-buffer size, and fragments find their
 * tile by screen fraction instead of by pixel: the tiles stretch with the screen and
 * the shaders stay valid at any resolution.
 */
class StableClusteredLightsNode extends ClusteredLightsNode {
  /** Per light, in the same (depth-sorted) order as the lights texture: aim xyz, cone cosine (-2: everywhere). */
  private readonly aimTexture: DataTexture;

  constructor(maxLights: number, tileSize: number, zSlices: number, maxLightsPerCluster: number) {
    super(maxLights, tileSize, zSlices, maxLightsPerCluster);
    this.aimTexture = new DataTexture(new Float32Array(maxLights * 4), maxLights, 1, RGBAFormat, FloatType);
  }

  updateProgram(renderer: WebGPURenderer) {
    if ((this as any)._bufferSize === null) (ClusteredLightsNode.prototype as any).updateProgram.call(this, renderer);
  }

  setSize(width: number, height: number) {
    if ((this as any)._bufferSize === null) super.setSize(width, height);
    return this;
  }

  updateLightsTexture(camera: any) {
    (ClusteredLightsNode.prototype as any).updateLightsTexture.call(this, camera);
    const order: number[] = (this as any)._lightSortOrder;
    const data = this.aimTexture.image.data as Float32Array;
    for (let i = 0; i < order.length; i++) {
      const u = (this.clusteredLights[order[i]] as Light).userData as AimedLight;
      const o = i * 4;
      if (u.aim && u.cone !== undefined) {
        data[o] = u.aim.x;
        data[o + 1] = u.aim.y;
        data[o + 2] = u.aim.z;
        data[o + 3] = u.cone;
      } else {
        data[o + 3] = -2;
      }
    }
    this.aimTexture.needsUpdate = true;
  }

  getLightData(index: any) {
    const d = (ClusteredLightsNode.prototype as any).getLightData.call(this, index);
    // Only the fragment pass uses the colour: the cluster compute never builds this.
    const aim = textureLoad(this.aimTexture, ivec2(int(index), 0));
    const toFragment = normalize(positionWorld.sub(d.position));
    const inCone = smoothstep(aim.w, aim.w.add(CONE_SOFTNESS), dot(toFragment, aim.xyz));
    return { ...d, color: d.color.mul(aim.w.lessThan(-1.5).select(float(1), inCone)) };
  }

  create(width: number, height: number) {
    (ClusteredLightsNode.prototype as any).create.call(this, width, height);
    const self = this as any;
    const NX = Math.floor(width / this.tileSize);
    const NY = Math.floor(height / this.tileSize);
    const NZ = this.zSlices;
    // Same as three's cluster lookup, with the screen tile from screenUV instead of pixels.
    self._screenClusterIndex = Fn(() => {
      const tile = clamp(screenUV.mul(vec2(NX, NY)).floor(), vec2(0, 0), vec2(NX - 1, NY - 1));
      const viewDepth = positionView.z.negate();
      const invLogFarOverNear = float(1).div(log(self._cameraFar.div(self._cameraNear)));
      const sliceFloat = log(viewDepth.div(self._cameraNear)).mul(invLogFarOverNear).mul(float(NZ));
      const zSlice = clamp(sliceFloat.floor(), float(0), float(NZ - 1));
      return int(tile.x)
        .add(int(tile.y).mul(int(NX)))
        .add(int(zSlice).mul(int(NX * NY)));
    })().toVar();
  }

  dispose() {
    this.aimTexture.dispose();
    super.dispose();
  }
}

export class StableClusteredLighting extends ClusteredLighting {
  createNode(lights: Light[] = []) {
    return new StableClusteredLightsNode(this.maxLights, this.tileSize, this.zSlices, this.maxLightsPerCluster).setLights(lights);
  }
}
