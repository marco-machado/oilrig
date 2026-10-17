import { el } from './dom.ts';
import { type IconName, icon } from './icons.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet-danger';

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  block?: boolean;
  /** Icon before the label. */
  icon?: IconName;
  /** Icon after the label; it nudges forward on hover. */
  trail?: IconName;
  type?: 'button' | 'submit';
  onClick?: () => void;
}

export function button(o: ButtonOptions): HTMLButtonElement {
  const cls = ['oh-btn', `oh-btn--${o.variant ?? 'secondary'}`];
  if (o.size) cls.push(`oh-btn--${o.size}`);
  if (o.block) cls.push('oh-btn--block');
  const b = el('button', { type: o.type ?? 'button', class: cls.join(' ') });
  setButton(b, o.label, { icon: o.icon, trail: o.trail });
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** Replaces a button's content; `busy` shows a spinner and disables it. */
export function setButton(b: HTMLButtonElement, label: string, o: { icon?: IconName; trail?: IconName; busy?: boolean } = {}) {
  b.replaceChildren(...[o.busy ? el('span', { class: 'oh-spinner', 'aria-hidden': 'true' }) : o.icon ? icon(o.icon) : null, label, o.trail && !o.busy ? icon(o.trail, 'trail') : null].filter((x) => x !== null));
  b.disabled = !!o.busy;
}

export function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'oh-icon-btn', 'aria-label': label }, icon(name));
  b.addEventListener('click', onClick);
  return b;
}

/** A keycap. */
export const kbd = (key: string) => el('kbd', { class: 'oh-kbd' }, key);

/** Keycaps for a combination written with spaces, "/" for alternatives: "W A S D", "Shift / C". */
export function keys(combo: string): HTMLElement {
  const s = el('span', { class: 'oh-keycombo' });
  for (const k of combo.split(' ')) s.append(k === '/' ? el('span', { class: 'oh-or' }, 'or') : kbd(k));
  return s;
}

export const badge = (text: string, muted = false) => el('span', { class: `oh-badge${muted ? ' oh-badge--muted' : ''}` }, text);

export type Tone = 'good' | 'warn' | 'bad' | 'checking' | 'idle';

/** A status pill: a colored dot and a short label. */
export function pill(tone: Tone = 'idle', text = '') {
  const label = el('span', {}, text);
  const e = el('span', { class: 'oh-pill' }, el('span', { class: 'oh-dot', 'aria-hidden': 'true' }), label);
  const set = (t: Tone, txt: string) => {
    e.className = `oh-pill oh-pill--${t}`;
    if (label.textContent !== txt) label.textContent = txt;
  };
  set(tone, text);
  return { el: e, set };
}

export function input(attrs: Record<string, string>): HTMLInputElement {
  return el('input', { class: 'oh-input', ...attrs });
}

/** A labelled text field, with an optional hint beside the label. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLLabelElement {
  return el('label', { class: 'oh-field' }, el('span', { class: 'oh-field__label' }, label, hint ? el('span', { class: 'oh-field__hint' }, hint) : null), control);
}

export function toggle(label: string, checked: boolean, onChange: (on: boolean) => void): HTMLInputElement {
  const t = el('input', { type: 'checkbox', role: 'switch', class: 'oh-switch', 'aria-label': label });
  t.checked = checked;
  t.addEventListener('change', () => onChange(t.checked));
  return t;
}

/** Options side by side; the thumb slides to the chosen one (CSS, from --i and --n). */
export function segmented<T extends string | number>(label: string, options: Array<[T, string]>, value: T, onPick: (v: T) => void) {
  const e = el('div', { class: 'oh-seg', role: 'group', 'aria-label': label });
  e.style.setProperty('--n', String(options.length));
  const buttons = options.map(([v, text]) => {
    const b = el('button', { type: 'button' }, text);
    b.addEventListener('click', () => onPick(v));
    e.append(b);
    return b;
  });
  const set = (v: T) => {
    const i = options.findIndex((o) => o[0] === v);
    e.classList.toggle('is-empty', i < 0);
    if (i >= 0) e.style.setProperty('--i', String(i));
    buttons.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  };
  set(value);
  return { el: e, set };
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  sky?: boolean;
  onInput?: (v: number) => void;
  onChange?: (v: number) => void;
}

/** A range input whose filled part (or, for the sky dial, the sun) follows the value. */
export function slider(o: SliderOptions) {
  const e = el('input', { type: 'range', class: `oh-range${o.sky ? ' oh-range--sky' : ''}`, min: String(o.min), max: String(o.max), step: String(o.step), 'aria-label': o.label });
  const fill = () => e.style.setProperty('--p', `${((Number(e.value) - o.min) / (o.max - o.min)) * 100}%`);
  const set = (v: number) => {
    e.value = String(v);
    fill();
  };
  set(o.value);
  e.addEventListener('input', () => {
    fill();
    o.onInput?.(Number(e.value));
  });
  e.addEventListener('change', () => o.onChange?.(Number(e.value)));
  return { el: e, set };
}
