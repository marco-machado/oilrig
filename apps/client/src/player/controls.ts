import type { MoveInput } from '@ocean-home/shared';

const PITCH_LIMIT = Math.PI / 2 - 0.01;

export interface ControlSettings {
  sensitivity: number;
  invertY: boolean;
}

export type TouchAction = 'jump' | 'interact' | 'home';

/**
 * Keyboard, mouse (pointer lock), gamepad and touch input for first-person movement.
 *
 * On a touch screen there is no pointer lock: `touch` makes `lock()` and `unlock()` switch a
 * flag instead, so the rest of the game (menu, chat) follows the same "locked" state, and
 * TouchControls (touch.ts) feeds the stick, the look drags and the buttons in here.
 */
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
  /** A touch screen: no pointer lock, input comes from the on-screen controls. */
  touch = false;
  private touchLocked = false;
  private readonly stick = { forward: 0, right: 0, run: false };
  private touchClimb = 0;

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
      if (this.touch || !this.locked) return;
      this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.keys.clear();
      this.onPointerLockChange?.(this.locked);
    });
  }

  get locked() {
    return this.touch ? this.touchLocked : document.pointerLockElement === this.element;
  }

  /** Turns the view by an angle in radians (before the sensitivity setting). */
  look(dx: number, dy: number) {
    const s = this.settings.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  /** The on-screen stick: forward and right in -1..1. */
  setStick(forward: number, right: number, run: boolean) {
    this.stick.forward = forward;
    this.stick.right = right;
    this.stick.run = run;
  }

  /** The on-screen climb and descend buttons of the drone: -1, 0 or 1. */
  setClimb(up: number) {
    this.touchClimb = up;
  }

  /** An on-screen button, as one press of its key. */
  press(action: TouchAction) {
    if (!this.enabled) return;
    if (action === 'jump') this.jumpQueued = true;
    else if (action === 'interact') this.interactQueued = true;
    else this.homeQueued = true;
  }

  private setTouchLocked(locked: boolean) {
    if (this.touchLocked === locked) return;
    this.touchLocked = locked;
    if (!locked) {
      this.keys.clear();
      this.setStick(0, 0, false);
      this.touchClimb = 0;
    }
    this.onPointerLockChange?.(locked);
  }

  lock() {
    if (this.touch) {
      this.setTouchLocked(true);
      return;
    }
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
    if (this.touch) this.setTouchLocked(false);
    else if (this.locked) document.exitPointerLock();
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
      up += this.touchClimb;
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
      forward += this.stick.forward;
      right += this.stick.right;
    }
    let run = k.has('ShiftLeft') || k.has('ShiftRight') || this.stick.run;
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
