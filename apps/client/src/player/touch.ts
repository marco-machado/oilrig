import { el } from '../ui/components/dom.ts';
import { type IconName, icon } from '../ui/components/icons.ts';
import type { Controls } from './controls.ts';
import { STICK_RADIUS, stickVector } from './stick.ts';
import '../ui/touch.css';

/** Radians of turn per CSS pixel of a look drag (before the sensitivity setting). */
const LOOK_SPEED = 0.0045;
/** The stick starts where a thumb lands in this part of the screen; a drag anywhere else looks around. */
const STICK_ZONE = { width: 0.42, top: 0.3 };

export interface TouchHandlers {
  onMenu(): void;
  onChat(): void;
}

/** True where the main way of pointing is a finger (phones and tablets), or with ?touch in the URL. */
export function wantsTouchControls(): boolean {
  if (new URLSearchParams(location.search).has('touch')) return true;
  return navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
}

/**
 * The on-screen controls of a touch screen: a stick that appears under the left thumb, a drag
 * anywhere else to look around, and buttons for what the keyboard does. All of it goes into
 * Controls, so the game reads touch like any other input.
 */
export class TouchControls {
  readonly root = el('div', { class: 'oh-touch' });
  private readonly controls: Controls;
  private readonly surface: HTMLElement;
  private readonly ring = el('div', { class: 'oh-touch__ring' });
  private readonly knob = el('div', { class: 'oh-touch__knob' });
  private readonly descend: HTMLButtonElement;
  private readonly home: HTMLButtonElement;
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private readonly looks = new Map<number, { x: number; y: number }>();
  private climbing = 0;
  private descending = 0;

  /** `surface` is the game's canvas: touches on it move and look. */
  constructor(controls: Controls, surface: HTMLElement, handlers: TouchHandlers) {
    this.controls = controls;
    this.surface = surface;
    document.documentElement.classList.add('is-touch');

    this.ring.append(this.knob);
    this.ring.hidden = true;
    this.ring.style.setProperty('--r', `${STICK_RADIUS}px`);

    const jump = this.button('up', 'Jump, or climb in the drone', 'oh-touch__btn--jump');
    this.hold(jump, (down) => {
      if (down) controls.press('jump');
      this.climbing = down ? 1 : 0;
      this.syncClimb();
    });
    this.descend = this.button('down', 'Descend', 'oh-touch__btn--descend');
    this.hold(this.descend, (down) => {
      this.descending = down ? 1 : 0;
      this.syncClimb();
    });
    const use = this.button(null, 'Use', 'oh-touch__btn--use');
    use.append('Use');
    this.hold(use, (down) => down && controls.press('interact'));
    this.home = this.button('home', 'Fly home', 'oh-touch__btn--home');
    this.hold(this.home, (down) => down && controls.press('home'));
    const menu = this.button('menu', 'Menu', 'oh-touch__btn--menu');
    menu.addEventListener('click', () => handlers.onMenu());
    const chat = this.button('chat', 'Chat', 'oh-touch__btn--chat');
    chat.addEventListener('click', () => handlers.onChat());

    this.root.append(this.ring, el('div', { class: 'oh-touch__top' }, chat, menu), el('div', { class: 'oh-touch__pad' }, this.home, this.descend, use, jump));
    this.root.hidden = true;
    this.setFlying(false);
    document.body.appendChild(this.root);

    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) surface.addEventListener(type, (e) => this.up(e));
    // A long press must not open the browser's menu over the game.
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Shown while playing; hidden under the menu, the chat and the start screen. */
  setActive(on: boolean) {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
    if (!on) this.release();
  }

  /** In the drone the jump button climbs, and descend and fly-home appear. */
  setFlying(on: boolean) {
    if (this.descend.hidden === !on) return;
    this.descend.hidden = !on;
    this.home.hidden = !on;
    if (!on) {
      this.descending = 0;
      this.syncClimb();
    }
  }

  private button(name: IconName | null, label: string, cls: string): HTMLButtonElement {
    return el('button', { type: 'button', class: `oh-touch__btn ${cls}`, 'aria-label': label }, name ? icon(name) : null);
  }

  /** Calls `on(true)` when a finger lands on the button and `on(false)` when it leaves. */
  private hold(b: HTMLButtonElement, on: (down: boolean) => void) {
    let pointer: number | null = null;
    b.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      b.setPointerCapture(e.pointerId);
      b.classList.add('is-down');
      on(true);
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      b.classList.remove('is-down');
      on(false);
    };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private syncClimb() {
    this.controls.setClimb(this.climbing - this.descending);
  }

  private down(e: PointerEvent) {
    if (this.root.hidden) return;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone: its moves simply stop.
    }
    const inZone = e.clientX < window.innerWidth * STICK_ZONE.width && e.clientY > window.innerHeight * STICK_ZONE.top;
    if (inZone && this.stickPointer === null) {
      this.stickPointer = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.ring.style.left = `${e.clientX}px`;
      this.ring.style.top = `${e.clientY}px`;
      this.ring.hidden = false;
      this.setStick(0, 0);
    } else {
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    e.preventDefault();
  }

  private move(e: PointerEvent) {
    if (e.pointerId === this.stickPointer) {
      this.setStick(e.clientX - this.stickOrigin.x, e.clientY - this.stickOrigin.y);
      return;
    }
    const last = this.looks.get(e.pointerId);
    if (!last) return;
    this.controls.look((e.clientX - last.x) * LOOK_SPEED, (e.clientY - last.y) * LOOK_SPEED);
    last.x = e.clientX;
    last.y = e.clientY;
  }

  private up(e: PointerEvent) {
    this.looks.delete(e.pointerId);
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.ring.hidden = true;
    this.controls.setStick(0, 0, false);
  }

  private setStick(dx: number, dy: number) {
    const s = stickVector(dx, dy);
    this.controls.setStick(s.forward, s.right, s.run);
    this.knob.style.transform = `translate(${s.knobX}px, ${s.knobY}px)`;
    this.ring.classList.toggle('is-running', s.run);
  }

  private release() {
    this.stickPointer = null;
    this.looks.clear();
    this.ring.hidden = true;
    this.climbing = 0;
    this.descending = 0;
    this.controls.setStick(0, 0, false);
    this.syncClimb();
  }
}
