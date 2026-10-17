import type { MoveInput } from '@ocean-home/shared';

const PITCH_LIMIT = Math.PI / 2 - 0.01;

export interface ControlSettings {
  sensitivity: number;
  invertY: boolean;
}

/** Keyboard, mouse (pointer lock) and gamepad input for first-person movement. */
export class Controls {
  yaw = 0;
  pitch = 0;
  enabled = false;
  readonly settings: ControlSettings = { sensitivity: 1, invertY: false };
  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private interactQueued = false;
  private homeQueued = false;
  private padPrev = { jump: false, interact: false, home: false };
  private readonly element: HTMLElement;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  constructor(element: HTMLElement) {
    this.element = element;
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
      if (e.code === 'KeyE') this.interactQueued = true;
      if (e.code === 'KeyH') this.homeQueued = true;
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022 * this.settings.sensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s * (this.settings.invertY ? -1 : 1);
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.keys.clear();
      this.onPointerLockChange?.(this.locked);
    });
  }

  get locked() {
    return document.pointerLockElement === this.element;
  }

  lock() {
    // Pointer lock can be refused (no recent user gesture, document not focused); the
    // next click on the canvas tries again, so failures are ignored here.
    const attempt = (opts?: object) => {
      try {
        const p = this.element.requestPointerLock(opts as never) as unknown;
        if (p instanceof Promise) return p;
      } catch {
        // ignored
      }
      return Promise.resolve();
    };
    attempt({ unadjustedMovement: true }).catch(() => attempt().catch(() => undefined));
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  private gamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Flying the drone: stick in the view frame, Space climbs, Shift or C descends, H (or Y) flies home. */
  sampleFlight(dt: number) {
    const walk = this.sample(dt);
    const k = this.keys;
    let up = 0;
    if (this.enabled) {
      if (k.has('Space')) up += 1;
      if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyC')) up -= 1;
      const pad = this.gamepad();
      if (pad) up += (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0) + (pad.buttons[0]?.pressed ? 1 : 0) - (pad.buttons[1]?.pressed ? 1 : 0);
    }
    return { forward: walk.forward, right: walk.right, up: Math.max(-1, Math.min(1, up)), interact: walk.interact, home: walk.home, yaw: this.yaw };
  }

  /** Samples the current input. Consumes queued jump/interact/home presses. */
  sample(dt: number): MoveInput & { interact: boolean; home: boolean } {
    let forward = 0;
    let right = 0;
    const k = this.keys;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) forward += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) right += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) right -= 1;
    }
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    let jump = this.jumpQueued;
    let interact = this.interactQueued;
    let home = this.homeQueued;
    this.jumpQueued = false;
    this.interactQueued = false;
    this.homeQueued = false;

    const pad = this.enabled ? this.gamepad() : null;
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      forward -= dz(pad.axes[1] ?? 0);
      right += dz(pad.axes[0] ?? 0);
      const lx = dz(pad.axes[2] ?? 0);
      const ly = dz(pad.axes[3] ?? 0);
      this.yaw -= lx * 2.6 * dt * this.settings.sensitivity;
      this.pitch -= ly * 2.0 * dt * this.settings.sensitivity * (this.settings.invertY ? -1 : 1);
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      const pj = !!pad.buttons[0]?.pressed;
      const pi = !!pad.buttons[2]?.pressed;
      const ph = !!pad.buttons[3]?.pressed;
      if (pj && !this.padPrev.jump) jump = true;
      if (pi && !this.padPrev.interact) interact = true;
      if (ph && !this.padPrev.home) home = true;
      this.padPrev = { jump: pj, interact: pi, home: ph };
      if (pad.buttons[10]?.pressed || pad.buttons[4]?.pressed) run = true;
    }
    return { forward, right, run, jump, interact, home, yaw: this.yaw };
  }
}
