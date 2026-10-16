import type { PerspectiveCamera } from 'three/webgpu';
import {
  CharacterMotor,
  type Layout,
  PLAYER,
  type StaticWorld,
  type Surface,
  type Vec3,
} from '@ocean-home/shared';
import type { Controls } from './controls.ts';

export interface PlayerEvents {
  onFootstep?: (surface: Surface | undefined, run: boolean) => void;
  onLand?: (surface: Surface | undefined, speed: number) => void;
  onFellInSea?: () => void;
  onInteract?: (doorId: string) => void;
}

const FIXED_DT = 1 / 120;

/** Local first-person player: client-side prediction with the shared motor. */
export class Player {
  readonly motor: CharacterMotor;
  private readonly sw: StaticWorld;
  private readonly camera: PerspectiveCamera;
  private readonly controls: Controls;
  private readonly events: PlayerEvents;
  private readonly layout: Layout;
  private acc = 0;
  private stride = 0;
  private bob = 0;
  private wasGrounded = true;
  private fallSpeed = 0;
  private respawning = false;
  /** Door the crosshair rests on, if any (within reach). */
  focusDoor: string | null = null;
  frozen = false;

  constructor(sw: StaticWorld, layout: Layout, camera: PerspectiveCamera, controls: Controls, events: PlayerEvents) {
    this.sw = sw;
    this.camera = camera;
    this.controls = controls;
    this.events = events;
    this.layout = layout;
    this.motor = new CharacterMotor(sw, layout.spawn.position, layout.zones);
    controls.yaw = layout.spawn.yaw;
  }

  teleport(p: Vec3, yaw?: number) {
    this.motor.teleport(p);
    if (yaw !== undefined) this.controls.yaw = yaw;
    this.respawning = false;
  }

  get position(): Vec3 {
    return this.motor.state.position;
  }

  get indoors(): boolean {
    return this.motor.zoneAt('indoor');
  }

  update(dt: number) {
    const input = this.controls.sample(dt);
    if (this.frozen) {
      input.forward = 0;
      input.right = 0;
      input.jump = false;
    }
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 12) {
      this.motor.step(input, FIXED_DT);
      input.jump = false;
      this.acc -= FIXED_DT;
      steps++;
      this.trackLanding();
    }
    const s = this.motor.state;

    // Footsteps and head bob.
    const hs = Math.hypot(s.velocity[0], s.velocity[2]);
    if (s.grounded && hs > 0.5) {
      this.stride += hs * dt;
      this.bob += hs * dt * 2.2;
      const len = input.run ? 1.05 : 0.78;
      if (this.stride >= len) {
        this.stride -= len;
        this.events.onFootstep?.(this.motor.groundSurface(), input.run);
      }
    } else {
      this.bob *= 0.9;
    }
    const bobY = s.grounded ? Math.sin(this.bob * Math.PI) * 0.035 * Math.min(1, hs / 3) : 0;

    this.camera.position.set(s.position[0], s.position[1] + PLAYER.eyeHeight + bobY, s.position[2]);
    this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0, 'YXZ');

    // Interaction ray.
    this.focusDoor = this.pickDoor();
    if (input.interact && this.focusDoor) this.events.onInteract?.(this.focusDoor);

    // Fell into the sea.
    if (!this.respawning && s.position[1] < 0.2) {
      this.respawning = true;
      this.events.onFellInSea?.();
    }
  }

  private trackLanding() {
    const s = this.motor.state;
    if (!s.grounded) this.fallSpeed = Math.max(this.fallSpeed, -s.velocity[1]);
    if (s.grounded && !this.wasGrounded && this.fallSpeed > 2) {
      this.events.onLand?.(this.motor.groundSurface(), this.fallSpeed);
    }
    if (s.grounded) this.fallSpeed = 0;
    this.wasGrounded = s.grounded;
  }

  private pickDoor(): string | null {
    const cp = Math.cos(this.controls.pitch);
    const dx = -Math.sin(this.controls.yaw) * cp;
    const dy = Math.sin(this.controls.pitch);
    const dz = -Math.cos(this.controls.yaw) * cp;
    const o = this.camera.position;
    let best: string | null = null;
    let bestDist = 3.2;
    for (const d of this.layout.doors) {
      const vx = d.center[0] - o.x;
      const vy = d.center[1] - o.y;
      const vz = d.center[2] - o.z;
      const dist = Math.hypot(vx, vy, vz);
      if (dist > bestDist) continue;
      const facing = (vx * dx + vy * dy + vz * dz) / dist;
      if (facing < 0.55) continue;
      best = d.id;
      bestDist = dist;
    }
    return best;
  }
}
