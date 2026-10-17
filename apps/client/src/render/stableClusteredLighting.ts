import type { Light, WebGPURenderer } from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { Fn, clamp, float, int, log, positionView, screenUV, vec2 } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Clustered lighting whose cluster grid never changes size.
 *
 * three 0.186 bakes the grid (NX × NY screen tiles of 32 px) into every lit shader as
 * constants and rebuilds the grid whenever the drawing buffer changes size, so a window
 * resize or a dynamic-resolution step rebuilt every lit shader (about a second). Here
 * the grid is built once, from the first drawing-buffer size, and fragments find their
 * tile by screen fraction instead of by pixel: the tiles stretch with the screen and
 * the shaders stay valid at any resolution.
 */
class StableClusteredLightsNode extends ClusteredLightsNode {
  updateProgram(renderer: WebGPURenderer) {
    if ((this as any)._bufferSize === null) (ClusteredLightsNode.prototype as any).updateProgram.call(this, renderer);
  }

  setSize(width: number, height: number) {
    if ((this as any)._bufferSize === null) super.setSize(width, height);
    return this;
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
}

export class StableClusteredLighting extends ClusteredLighting {
  createNode(lights: Light[] = []) {
    return new StableClusteredLightsNode(this.maxLights, this.tileSize, this.zSlices, this.maxLightsPerCluster).setLights(lights);
  }
}
