import { DataTexture, FloatType, type Light, LightsNode, RGBAFormat, type Vector3 } from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { Fn, If, Loop, cameraViewMatrix, directPointLight, dot, float, int, ivec2, normalize, positionView, smoothstep, textureLoad, vec4 } from 'three/tsl';

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

/** Rows of three's lights texture (module-private constants in ClusteredLightsNode.js, r187). */
const POSITION_ROW = 0; // world position, cutoff distance
const COLOR_ROW = 1; // colour × intensity, decay
const SPOT_ROW = 2; // scaled world spot direction, scaled cone cosine

/**
 * Clustered lighting with aimed point lights.
 *
 * Since three r187 the cluster grid's dimensions are uniforms, so a window resize or a
 * dynamic-resolution step no longer rebuilds every lit shader, and this class adds two things:
 * the aim, and renders through an ArrayCamera. three clusters the lights for the ArrayCamera
 * itself, not for its sub-cameras, so in such a render (r187's light-probe bake) the clustered
 * lights were missing and the room lost their bounce light. There the lights are not clustered:
 * every fragment loops over all of them, in its own sub-camera's view space. Those renders are
 * tiny (16 px cube faces).
 *
 * It overrides private methods of three's ClusteredLightsNode (`_updateLightsTexture`,
 * `_getLightData`) and reads its lights texture: if three renames them, the cones stop
 * applying, with no error.
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
    return { ...d, color: d.color.mul(this.inCone(index, d.viewPosition, (this as any)._cameraViewMatrix)) };
  }

  /** 1 inside the light's cone (or for a light that isn't aimed), 0 outside, with a soft edge. */
  private inCone(index: any, viewPosition: any, viewMatrix: any) {
    const aim = textureLoad(this.aimTexture, ivec2(int(index), 0));
    const aimView = viewMatrix.mul(vec4(aim.xyz, 0)).xyz;
    const toFragment = normalize(positionView.sub(viewPosition));
    const cone = smoothstep(aim.w, aim.w.add(CONE_SOFTNESS), dot(toFragment, aimView));
    return aim.w.lessThan(-1.5).select(float(1), cone);
  }

  setupLights(builder: any, lightNodes: any) {
    if (builder.camera?.isArrayCamera !== true) return (ClusteredLightsNode.prototype as any).setupLights.call(this, builder, lightNodes);
    const self = this as any;
    self._initGrid(builder.renderer);
    const lightingModel = builder.context.reflectedLight;
    lightingModel.directDiffuse.toStack();
    lightingModel.directSpecular.toStack();
    (LightsNode.prototype as any).setupLights.call(this, builder, lightNodes);
    // three's loop over the fragment's cluster, as a loop over every light instead.
    Fn(() => {
      Loop({ start: int(0), end: self._lightsCount, type: 'int', condition: '<' }, ({ i }: any) => {
        const dataA = textureLoad(self._lightsTexture, ivec2(i, POSITION_ROW));
        const dataB = textureLoad(self._lightsTexture, ivec2(i, COLOR_ROW));
        const dataC = textureLoad(self._lightsTexture, ivec2(i, SPOT_ROW));
        const viewPosition = cameraViewMatrix.mul(vec4(dataA.xyz, 1)).xyz;
        const distance = dataA.w;
        const spotDirection = cameraViewMatrix.mul(vec4(dataC.xyz, 0)).xyz;
        const lightVector = viewPosition.sub(positionView);
        const spotAttenuation = smoothstep(0, 1, dot(lightVector.normalize(), spotDirection).sub(dataC.w)).toVar();
        const inRange = distance.equal(0).or(dot(lightVector, lightVector).lessThanEqual(distance.mul(distance)));
        If(inRange.and(spotAttenuation.greaterThan(0)), () => {
          builder.lightsNode.setupDirectLight(
            builder,
            this,
            // three r187 takes `lightVector`; @types/three 0.187.0 still declares `lightViewPosition`.
            directPointLight({
              color: dataB.rgb.mul(spotAttenuation).mul(this.inCone(i, viewPosition, cameraViewMatrix)),
              lightVector,
              cutoffDistance: distance,
              decayExponent: dataB.w,
            } as any),
          );
        });
      });
    }, 'void')();
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
