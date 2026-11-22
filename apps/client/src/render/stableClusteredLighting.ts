import { type Light, LightsNode, type Vector3 } from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { Fn, If, Loop, cameraViewMatrix, directPointLight, dot, int, ivec2, positionView, smoothstep, textureLoad, vec4 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A point light can be aimed: set `light.userData.aim` to a world-space unit vector and
 * `light.userData.cone` to the cosine of the beam's half angle. It then lights only what lies
 * inside that cone (with a soft edge), like a recessed downlight or a floodlight, so the
 * ceiling a downlight sits in, the rail beside a floodlight or the drone above its own landing
 * light stay dark. Aimed lights stay point lights: their cone goes into the clustered lights'
 * own data (below), so they cost no more than three's clustered spot lights and keep this edge.
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
const BOUNDS_ROW = 3; // world bounding sphere centre, radius

/**
 * Clustered lighting with aimed point lights.
 *
 * Since three r187 the cluster grid's dimensions are uniforms, so a window resize or a
 * dynamic-resolution step no longer rebuilds every lit shader, and this class adds three things.
 *
 * The aim. three's lights texture has a row for spot lights, which its shader reads for every
 * clustered light: `smoothstep(0, 1, dot(L, direction) - offset)`, 1 for a point light. An aimed
 * point light gets its cone written there, so three's own loop applies it and skips the lighting
 * model for fragments outside the beam (most of the fragments within a downlight's range).
 *
 * Tighter culling. An aimed light is clustered by the sphere round its cone, not round its
 * whole range, and a lamp that is switched off by no cluster at all: lamps only ever change
 * intensity (hiding one would rebuild every lit shader), so by day most of the 76 were still in
 * the clusters, each running the lighting model for nothing: up to a fifth of the frame indoors.
 *
 * Renders through an ArrayCamera. three clusters the lights for the ArrayCamera itself, not for
 * its sub-cameras, so in such a render (r187's light-probe bake) the clustered lights were
 * missing and the room lost their bounce light. There the lights are not clustered: every
 * fragment loops over all of them, in its own sub-camera's view space. Those renders are tiny
 * (16 px cube faces).
 *
 * It overrides a private method of three's ClusteredLightsNode (`_updateLightsTexture`) and
 * edits its lights texture: if three renames either or reorders the rows, the cones stop
 * applying (downlights then light the ceiling) and dark lamps cost a lighting pass again, with
 * no error.
 */
class StableClusteredLightsNode extends ClusteredLightsNode {
  _updateLightsTexture(camera: any) {
    (ClusteredLightsNode.prototype as any)._updateLightsTexture.call(this, camera);
    const order: number[] = (this as any)._lightSortOrder;
    const image = (this as any)._lightsTexture.image;
    const data = image.data as Float32Array;
    const row = image.width * 4;
    const m = camera.matrixWorld.elements;
    for (let i = 0; i < order.length; i++) {
      const light = this.clusteredLights[order[i]] as Light & { distance: number; isSpotLight?: boolean };
      const bounds = row * BOUNDS_ROW + i * 4;
      if (light.intensity <= 0) {
        // Dark: a point just behind the camera, which no cluster contains.
        data[bounds] = m[12] + m[8];
        data[bounds + 1] = m[13] + m[9];
        data[bounds + 2] = m[14] + m[10];
        data[bounds + 3] = 0;
        continue;
      }
      const { aim, cone } = light.userData as AimedLight;
      if (!aim || cone === undefined || light.isSpotLight) continue;
      // smoothstep(cone, cone + softness, dot(to the fragment, aim)) in three's terms: its L
      // points from the fragment to the light, so the direction is the aim reversed.
      const spot = row * SPOT_ROW + i * 4;
      data[spot] = -aim.x / CONE_SOFTNESS;
      data[spot + 1] = -aim.y / CONE_SOFTNESS;
      data[spot + 2] = -aim.z / CONE_SOFTNESS;
      data[spot + 3] = cone / CONE_SOFTNESS;
      // The smallest sphere round the cone (as three bounds its spot lights), for cones up to a hemisphere.
      const d = light.distance;
      if (d > 0 && cone >= 0) {
        const wide = cone <= Math.SQRT1_2;
        const along = wide ? d * cone : d / (2 * cone);
        data[bounds] += aim.x * along;
        data[bounds + 1] += aim.y * along;
        data[bounds + 2] += aim.z * along;
        data[bounds + 3] = wide ? d * Math.sqrt(1 - cone * cone) : along;
      }
    }
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
              color: dataB.rgb.mul(spotAttenuation),
              lightVector,
              cutoffDistance: distance,
              decayExponent: dataB.w,
            } as any),
          );
        });
      });
    }, 'void')();
  }
}

export class StableClusteredLighting extends ClusteredLighting {
  createNode(lights: Light[] = []) {
    return new StableClusteredLightsNode(this.maxLights, this.tileSize, this.zSlices, this.maxLightsPerCluster).setLights(lights);
  }
}
