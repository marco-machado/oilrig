import { type Child, el } from './dom.ts';
import { iconButton, slider, type SliderOptions } from './controls.ts';

/** Rows on one rounded surface, separated by hairlines. */
export const group = (...rows: Child[]) => el('div', { class: 'oh-group' }, ...rows);

/** A titled section of a sheet. */
export const section = (label: string | null, ...children: Child[]) => el('section', { class: 'oh-section' }, label ? el('div', { class: 'oh-eyebrow' }, label) : null, ...children);

const rowText = (title: string, desc?: Child) => el('div', { class: 'oh-row__text' }, el('div', { class: 'oh-row__title' }, title), desc ? el('div', { class: 'oh-row__desc' }, desc) : null);

/**
 * A row with a title, a description and a control on the right. With a switch the whole row
 * is its label, so clicking anywhere on it flips the switch.
 */
export function row(title: string, desc: Child, control: HTMLElement) {
  const isSwitch = control instanceof HTMLInputElement;
  return el(isSwitch ? 'label' : 'div', { class: 'oh-row' }, rowText(title, desc), control);
}

/** A row with the control underneath (segmented controls). */
export const stackRow = (title: string, desc: Child, control: HTMLElement) => el('div', { class: 'oh-row oh-row--stack' }, rowText(title, desc), control);

/** A slider row: title and current value above the slider. */
export function sliderRow(o: SliderOptions & { format: (v: number) => string }) {
  const value = el('span', { class: 'oh-row__value' }, o.format(o.value));
  const s = slider({
    ...o,
    onInput: (v) => {
      value.textContent = o.format(v);
      o.onInput?.(v);
    },
  });
  const e = el('div', { class: 'oh-row oh-row--stack' }, el('div', { class: 'oh-row__head' }, el('span', { class: 'oh-row__title' }, o.label), value), s.el);
  return {
    el: e,
    set(v: number) {
      s.set(v);
      value.textContent = o.format(v);
    },
  };
}

/** A section sheet beside the menu: eyebrow, serif title, close button, body and footer. */
export function sheet(title: string, onClose: () => void) {
  const eyebrow = el('div', { class: 'oh-eyebrow' });
  const body = el('div', { class: 'oh-sheet__body' });
  const foot = el('footer', { class: 'oh-sheet__foot' });
  foot.hidden = true;
  const e = el(
    'section',
    { class: 'oh-sheet oh-glass oh-glass--strong', 'aria-label': title },
    el('header', { class: 'oh-sheet__head' }, el('div', {}, eyebrow, el('h2', { class: 'oh-sheet__title' }, title)), iconButton('close', `Close ${title}`, onClose)),
    body,
    foot,
  );
  e.hidden = true;
  return {
    el: e,
    body,
    foot,
    setEyebrow(text: string) {
      if (eyebrow.textContent !== text) eyebrow.textContent = text;
    },
  };
}
