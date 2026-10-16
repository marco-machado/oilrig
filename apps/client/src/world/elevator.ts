import { BoxGeometry, type BufferGeometry, CylinderGeometry, Group, Mesh, MeshStandardNodeMaterial, PointLight } from 'three/webgpu';
import { color, uniform } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DIMS, type ElevatorPose, carPanel, elevatorPanels } from '@ocean-home/shared';
import { U } from '../state.ts';
import type { MaterialSet } from './materials/index.ts';
import { tubeGeometry } from './structure.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

const E = DIMS.ELEVATOR;

/** The glass elevator's moving parts: the car, the landing doors at both stops and the buttons. */
export class ElevatorView {
  readonly group = new Group();
  private readonly car = new Group();
  private readonly doors: Array<[Group, Group]> = [];
  private readonly lit = E.stops.map(() => uniform(0));
  private readonly carLit = uniform(0);
  private readonly light = new PointLight(0xfff1dc, 0, 5, 2);

  constructor(materials: MaterialSet) {
    this.group.name = 'elevator';
    const w = E.x1 - E.x0;
    const d = E.z1 - E.z0;
    const cx = (E.x0 + E.x1) / 2;
    const cz = (E.z0 + E.z1) / 2;

    // Car, built around its floor at y = 0.
    const bronze = new MeshStandardNodeMaterial({ color: 0x8c6a43, metalness: 0.85, roughness: 0.32 });
    const floor = new BoxGeometry(w - 0.12, 0.12, d - 0.12);
    floor.translate(0, -0.06, 0);
    this.car.add(new Mesh(floor, materials.stone));
    const ceiling = new BoxGeometry(w - 0.12, 0.08, d - 0.12);
    ceiling.translate(0, 2.42, 0);
    const posts: BufferGeometry[] = [ceiling];
    for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) for (const z of [-d / 2 + 0.1, d / 2 - 0.1]) posts.push(tubeGeometry([x, 0, z], [x, 2.4, z], 0.035, 8));
    // Handrails on the three glass sides.
    const rail = (a: [number, number, number], b: [number, number, number]) => posts.push(tubeGeometry(a, b, 0.02, 8));
    rail([-w / 2 + 0.12, 0.95, -d / 2 + 0.3], [-w / 2 + 0.12, 0.95, d / 2 - 0.12]);
    rail([w / 2 - 0.12, 0.95, -d / 2 + 0.6], [w / 2 - 0.12, 0.95, d / 2 - 0.12]);
    rail([-w / 2 + 0.12, 0.95, d / 2 - 0.12], [w / 2 - 0.12, 0.95, d / 2 - 0.12]);
    const frame = new Mesh(mergeGeometries(posts, false)!, bronze);
    frame.castShadow = true;
    this.car.add(frame);
    const panelMat = new MeshStandardNodeMaterial({ color: 0x141619, roughness: 0.4 });
    panelMat.emissiveNode = color(0x46d8ff).mul(this.carLit.mul(3).add(0.15));
    const lamp = new BoxGeometry(w - 0.5, 0.02, d - 0.5);
    lamp.translate(0, 2.37, 0);
    const lampMat = new MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.5 });
    lampMat.emissiveNode = color(0xfff1dc).mul(U.nightLights.mul(5).add(1.5));
    this.car.add(new Mesh(lamp, lampMat));
    const cp = carPanel(0);
    const panel = new BoxGeometry(0.03, 0.34, 0.16);
    panel.translate(cp[0] - cx, cp[1], cp[2] - cz);
    this.car.add(new Mesh(panel, panelMat));
    this.light.position.set(0, 2.2, 0);
    this.car.add(this.light);
    this.car.position.set(cx, E.stops[1], cz);
    this.group.add(this.car);

    // Landing doors: two glass leaves opening from the middle, at each stop.
    const dw = E.door.x1 - E.door.x0;
    E.stops.forEach((y, i) => {
      const leaves: [Group, Group] = [new Group(), new Group()];
      for (const leaf of leaves) {
        const glass = new Mesh(new BoxGeometry(dw / 2, E.door.height, 0.03), materials.glassThin);
        const edge = (x0: number, x1: number, y0: number, y1: number) => {
          const b = new BoxGeometry(x1 - x0, y1 - y0, 0.05);
          b.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
          return b;
        };
        const h = E.door.height / 2;
        const q = dw / 4;
        const leafFrame = new Mesh(
          mergeGeometries([edge(-q, q, h - 0.05, h), edge(-q, q, -h, -h + 0.05), edge(-q, -q + 0.05, -h, h), edge(q - 0.05, q, -h, h)], false)!,
          bronze,
        );
        leaf.add(glass, leafFrame);
        leaf.position.set(0, y + h, E.z0 - 0.07);
        this.group.add(leaf);
      }
      this.doors.push(leaves);
      // Call button on the post beside the door.
      const p = elevatorPanels()[i].position;
      const plate = new BoxGeometry(0.14, 0.3, 0.025);
      plate.translate(p[0], p[1], p[2] + 0.01);
      this.group.add(new Mesh(plate, panelMat));
      const button = new CylinderGeometry(0.035, 0.035, 0.02, 20);
      button.rotateX(Math.PI / 2);
      button.translate(p[0], p[1], p[2] - 0.01);
      const bm = new MeshStandardNodeMaterial({ color: 0x1b1d20, roughness: 0.3, metalness: 0.6 });
      bm.emissiveNode = color(0x46d8ff).mul((this.lit[i] as any).mul(4).add(0.25));
      this.group.add(new Mesh(button, bm));
    });
  }

  /** `calling`: the stop the car has been called to and is not standing at yet, if any. */
  update(p: ElevatorPose, calling: number | null) {
    this.car.position.y = p.y;
    const dw = E.door.x1 - E.door.x0;
    const mid = (E.door.x0 + E.door.x1) / 2;
    this.doors.forEach(([l, r], i) => {
      const open = p.stop === i ? p.doors : 0;
      const slide = (dw / 4) * (1 + open * 0.96);
      l.position.x = mid - slide;
      r.position.x = mid + slide;
      (this.lit[i] as any).value = calling === i || (p.phase === 'travel' && i === (p.vy < 0 ? 0 : 1)) ? 1 : 0;
    });
    (this.carLit as any).value = p.phase === 'travel' ? 1 : 0;
    this.light.intensity = 1.5 + 4 * U.nightLights.value;
  }
}
