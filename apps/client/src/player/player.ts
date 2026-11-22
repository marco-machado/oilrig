import { type PerspectiveCamera, Vector3 } from 'three/webgpu';
import {
  CharacterMotor,
  type Layout,
  PLAYER,
  type StaticWorld,
  type Surface,
  type Vec3,
  inCar,
} from '@oilrig/shared';
import type { Controls } from './controls.ts';

export type StepSurface = Surface | 'water';

export interface PlayerEvents {
  onFootstep?: (surface: StepSurface | undefined, run: boolean) => void;
  onLand?: (surface: StepSurface | undefined, speed: number) => void;
  onFellInSea?: () => void;
  onInteract?: (id: string) => void;
}

/** Something the crosshair can rest on and E operates: a door, a button, the drone. */
export interface Interactable {
  id: string;
  point: Vec3;
  /** Metres from the eye. */
  reach: number;
  /** How squarely it must be looked at (cosine of the angle), default 0.55. */
  facing?: number;
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
  private readonly dir = new Vector3();
  /** A jump press waits here until a physics step uses it (some frames run no step). */
  private jumpHeld = false;
  /** What the crosshair rests on, if anything within reach. */
  focus: string | null = null;
  /** Things that can be operated this frame (set by the game loop). */
  targets: Interactable[] = [];
  frozen = false;
  /** Sitting in the drone: no walking, the camera is placed by the seat. */
  seated = false;

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

  /** Carries the player along with the elevator car if they are in it. */
  ride(prevCarY: number, carY: number) {
    if (carY !== prevCarY && !this.seated && inCar(prevCarY, this.motor.state.position)) this.motor.ride(carY - prevCarY);
  }

  private surface(): StepSurface | undefined {
    return this.motor.zoneAt('pool') ? 'water' : this.motor.groundSurface();
  }

  update(dt: number) {
    const input = this.controls.sample(dt);
    if (this.seated) {
      this.focus = this.pick();
      if (input.interact && this.focus) this.events.onInteract?.(this.focus);
      return;
    }
    if (this.frozen) {
      input.forward = 0;
      input.right = 0;
      input.jump = false;
    }
    if (input.jump) this.jumpHeld = true;
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 12) {
      input.jump = this.jumpHeld;
      this.jumpHeld = false;
      this.motor.step(input, FIXED_DT);
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
        this.events.onFootstep?.(this.surface(), input.run);
      }
    } else {
      this.bob *= 0.9;
    }
    const bobY = s.grounded ? Math.sin(this.bob * Math.PI) * 0.035 * Math.min(1, hs / 3) : 0;

    this.camera.position.set(s.position[0], s.position[1] + PLAYER.eyeHeight + bobY, s.position[2]);
    this.camera.rotation.set(this.controls.pitch, this.controls.yaw, 0, 'YXZ');

    // Interaction ray.
    this.focus = this.pick();
    if (input.interact && this.focus) this.events.onInteract?.(this.focus);

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
      this.events.onLand?.(this.surface(), this.fallSpeed);
    }
    if (s.grounded) this.fallSpeed = 0;
    this.wasGrounded = s.grounded;
  }

  /** The target most squarely in view within its reach. */
  private pick(): string | null {
    const dir = this.camera.getWorldDirection(this.dir);
    const o = this.camera.position;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const t of this.targets) {
      const vx = t.point[0] - o.x;
      const vy = t.point[1] - o.y;
      const vz = t.point[2] - o.z;
      const dist = Math.hypot(vx, vy, vz);
      if (dist > t.reach || dist < 1e-3) continue;
      const facing = (vx * dir.x + vy * dir.y + vz * dir.z) / dist;
      if (facing < (t.facing ?? 0.55)) continue;
      const score = facing * 2 - dist / t.reach;
      if (score > bestScore) {
        best = t.id;
        bestScore = score;
      }
    }
    return best;
  }
}
