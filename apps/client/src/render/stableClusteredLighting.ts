import { DataTexture, FloatType, type Light, RGBAFormat, type Vector3 } from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { dot, float, int, ivec2, normalize, positionView, smoothstep, textureLoad, vec4 } from 'three/tsl';

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
 * Clustered lighting with aimed point lights.
 *
 * Since three r187 the cluster grid's dimensions are uniforms, so a window resize or a
 * dynamic-resolution step no longer rebuilds every lit shader, and this class only adds the
 * aim. It overrides two private methods of three's ClusteredLightsNode (`_updateLightsTexture`
 * and `_getLightData`): if three renames them, the cones stop applying, with no error.
 */
class StableClusteredLightsNode extends ClusteredLightsNode {
  /** Per light, in the same (depth-sorted) order as the lights texture: aim xyz, cone cosine (-2: everywhere). */
  private readonly aimTexture: DataTexture;

  constructor(maxLights: number, tileSize: number, zSlices: number, maxLightsPerCluster: number) {
    super(maxLights, tileSize, zSlices, maxLightsPerCluster);
    this.aimTexture = new DataTexture(new Float32Array(maxLights * 4), maxLights, 1, RGBAFormat, FloatType);
  }

  _updateLightsTexture(camera: any) {
    (ClusteredLightsNode.prototype as any)._updateLightsTexture.call(this, camera);
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

  _getLightData(index: any) {
    const d = (ClusteredLightsNode.prototype as any)._getLightData.call(this, index);
    // Only the fragment pass uses the colour: the cluster compute reads the light bounds instead.
    const aim = textureLoad(this.aimTexture, ivec2(int(index), 0));
    const aimView = (this as any)._cameraViewMatrix.mul(vec4(aim.xyz, 0)).xyz;
    const toFragment = normalize(positionView.sub(d.viewPosition));
    const inCone = smoothstep(aim.w, aim.w.add(CONE_SOFTNESS), dot(toFragment, aimView));
    return { ...d, color: d.color.mul(aim.w.lessThan(-1.5).select(float(1), inCone)) };
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
