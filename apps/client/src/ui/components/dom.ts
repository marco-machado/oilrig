export type Child = Node | string | null | undefined | false;

/** Creates an element with attributes and children (strings become text). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

const tpl = document.createElement('template');

/** Parses trusted, static SVG markup (the icon set) into an element. */
export function svg(markup: string): SVGSVGElement {
  tpl.innerHTML = markup;
  return tpl.content.firstElementChild!.cloneNode(true) as SVGSVGElement;
}

/** Sets text only when it changed: most HUD setters run every frame. */
export function setText(e: Element, text: string) {
  if (e.textContent !== text) e.textContent = text;
}

const leaving = new WeakMap<HTMLElement, number>();

/**
 * Shows or hides an element. Showing restarts its entrance animation (it comes back from
 * display: none); hiding first plays the exit animation its `.is-leaving` rule defines.
 */
export function reveal(e: HTMLElement, on: boolean, leaveMs = 220) {
  const t = leaving.get(e);
  if (on) {
    if (t !== undefined) {
      clearTimeout(t);
      leaving.delete(e);
    }
    e.classList.remove('is-leaving');
    e.hidden = false;
    return;
  }
  if (e.hidden || t !== undefined) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    e.hidden = true;
    return;
  }
  e.classList.add('is-leaving');
  leaving.set(
    e,
    window.setTimeout(() => {
      leaving.delete(e);
      e.classList.remove('is-leaving');
      e.hidden = true;
    }, leaveMs),
  );
}

/** Whether an element is shown and not on its way out. */
export function shown(e: HTMLElement) {
  return !e.hidden && !leaving.has(e);
}
