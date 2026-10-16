import type * as RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER } from '../config.ts';
import type { Surface, Vec3, ZoneDef } from '../layout/types.ts';
import type { StaticWorld } from './colliders.ts';

export interface MoveInput {
  /** -1..1, positive = forward (towards where yaw points). */
  forward: number;
  /** -1..1, positive = right. */
  right: number;
  run: boolean;
  jump: boolean;
  /** Radians; 0 looks north (-z), positive turns left (counter-clockwise from above). */
  yaw: number;
}

export interface MotorState {
  position: Vec3;
  velocity: Vec3;
  grounded: boolean;
}

const HALF_HEIGHT = (PLAYER.height - 2 * PLAYER.radius) / 2;
const CENTER_OFFSET = HALF_HEIGHT + PLAYER.radius;

export function forwardVector(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/** First-person character driven by Rapier's kinematic character controller. Used by the
 * client for prediction and by tests/bots, so both move by exactly the same rules. */
export class CharacterMotor {
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly pos = { x: 0, y: 0, z: 0 };
  private readonly vel = { x: 0, y: 0, z: 0 };
  private onGround = false;
  /** Seconds left in which a fresh jump ignores the controller's "grounded" result. */
  private takeoff = 0;
  private readonly sw: StaticWorld;
  private readonly zones: ZoneDef[];

  constructor(sw: StaticWorld, start: Vec3, zones: ZoneDef[] = []) {
    this.sw = sw;
    this.zones = zones;
    const { R, world } = sw;
    this.collider = world.createCollider(R.ColliderDesc.capsule(HALF_HEIGHT, PLAYER.radius));
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((PLAYER.maxSlopeClimbDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle(((PLAYER.maxSlopeClimbDeg + 5) * Math.PI) / 180);
    // Autostep is left off: with a capsule it does not climb real steps and it stops
    // the controller at the foot of ramps. Every stepped surface has a ramp collider.
    this.controller.disableAutostep();
    this.controller.enableSnapToGround(0.35);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.teleport(start);
  }

  get state(): MotorState {
    return {
      position: [this.pos.x, this.pos.y, this.pos.z],
      velocity: [this.vel.x, this.vel.y, this.vel.z],
      grounded: this.onGround,
    };
  }

  teleport(p: Vec3) {
    this.pos.x = p[0];
    this.pos.y = p[1];
    this.pos.z = p[2];
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.syncCollider();
  }

  /** Moves the character with a platform it stands in (the elevator car), before the next step. */
  ride(dy: number) {
    this.pos.y += dy;
    this.syncCollider();
  }

  private syncCollider() {
    this.collider.setTranslation({ x: this.pos.x, y: this.pos.y + CENTER_OFFSET, z: this.pos.z });
  }

  zoneAt(kind: ZoneDef['kind'], p: Vec3 = [this.pos.x, this.pos.y, this.pos.z]): boolean {
    return this.zones.some(
      (z) =>
        z.kind === kind &&
        p[0] >= z.min[0] &&
        p[0] <= z.max[0] &&
        p[1] >= z.min[1] &&
        p[1] <= z.max[1] &&
        p[2] >= z.min[2] &&
        p[2] <= z.max[2],
    );
  }

  step(input: MoveInput, dt: number) {
    const inPool = this.zoneAt('pool');
    const speed = (input.run ? PLAYER.runSpeed : PLAYER.walkSpeed) * (inPool ? PLAYER.poolSpeedFactor : 1);
    const [fx, fz] = forwardVector(input.yaw);
    const rx = -fz;
    const rz = fx;
    let wx = fx * input.forward + rx * input.right;
    let wz = fz * input.forward + rz * input.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const targetX = wx * speed;
    const targetZ = wz * speed;
    // Exponential approach to the target velocity: snappy on the ground, sluggish in the air.
    const k = Math.min(1, (this.onGround ? 14 : 2) * dt);
    this.vel.x += (targetX - this.vel.x) * k;
    this.vel.z += (targetZ - this.vel.z) * k;

    if (this.onGround && input.jump) {
      this.vel.y = PLAYER.jumpSpeed;
      this.onGround = false;
      this.takeoff = 0.12;
    } else if (this.onGround) {
      this.vel.y = -1;
    } else {
      this.vel.y -= PLAYER.gravity * dt;
      this.vel.y = Math.max(this.vel.y, -50);
    }

    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, undefined, undefined, (c) => c.handle !== this.collider.handle && !this.isCharacter(c));
    const moved = this.controller.computedMovement();
    this.pos.x += moved.x;
    this.pos.y += moved.y;
    this.pos.z += moved.z;
    const wasRising = this.vel.y > 0;
    // Right after take-off the feet are still within the controller's contact offset, so it
    // keeps reporting "grounded"; with small steps (the client runs at 120 Hz) that would
    // snap the character straight back down. A rising jump is airborne until it peaks.
    this.takeoff = Math.max(0, this.takeoff - dt);
    this.onGround = this.controller.computedGrounded() && !(this.takeoff > 0 && this.vel.y > 0);
    if (this.onGround && this.vel.y < 0) this.vel.y = 0;
    if (wasRising && moved.y < desired.y - 1e-4) this.vel.y = 0; // head hit
    // Horizontal velocity is deliberately not replaced by the achieved movement: on a
    // ramp foot the controller returns a short step, and feeding that back stalls the
    // character before it starts climbing.
    this.syncCollider();
  }

  private isCharacter(c: RAPIER.Collider) {
    return !this.sw.info.has(c.handle);
  }

  /** Surface type directly under the feet, if any. */
  groundSurface(): Surface | undefined {
    const { R, world, info } = this.sw;
    const ray = new R.Ray({ x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 0.6, true, undefined, undefined, this.collider, undefined, (c) => info.has(c.handle));
    return hit ? info.get(hit.collider.handle)?.surface : undefined;
  }

  dispose() {
    this.sw.world.removeCharacterController(this.controller);
    this.sw.world.removeCollider(this.collider, false);
  }
}

export const MOTOR = { HALF_HEIGHT, CENTER_OFFSET };
