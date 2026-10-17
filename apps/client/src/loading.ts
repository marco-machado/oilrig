// Drives the static loading screen in index.html (it is visible before any script runs).

const loader = () => document.getElementById('loader');
let loaded = false;
const waiting: Array<() => void> = [];

/**
 * Draws the swell lines below the horizon once. Each canvas is twice the window wide and
 * repeats every window width, so a CSS transform can scroll it on the compositor while the
 * main thread is busy compiling shaders.
 */
function drawSea(el: HTMLElement) {
  const w = window.innerWidth;
  const h = Math.round(window.innerHeight * 0.386);
  const lines = 34;
  for (const canvas of el.querySelectorAll<HTMLCanvasElement>('canvas.sea')) {
    const near = canvas.classList.contains('near');
    canvas.width = w * 2;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) continue;
    for (let i = near ? 16 : 0; i < (near ? lines : 16); i++) {
      const d = i / (lines - 1);
      const y0 = d ** 1.9 * h;
      const amp = 0.5 + d * 4.5;
      // Whole periods per window width keep the scroll seamless.
      const k1 = Math.max(1, Math.round(w / (2 * Math.PI * (60 + d * 260))));
      const k2 = k1 * 3 - 1;
      g.strokeStyle = `rgba(127,216,227,${0.035 + d * 0.11 * (1 - d * 0.45)})`;
      g.lineWidth = 0.8 + d * 1.1;
      g.beginPath();
      for (let x = 0; x <= w * 2; x += 8) {
        const t = (x / w) * 2 * Math.PI;
        const y = y0 + Math.sin(t * k1 + i * 1.7) * amp + Math.sin(t * k2 - i) * amp * 0.35;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    canvas.classList.add('on');
  }
}

{
  const el = loader();
  if (el) drawSea(el);
}

/** Shows a step and progress (0..1), then yields a frame so the browser paints it. */
export async function setLoading(step: string, progress: number) {
  const el = loader();
  if (!el) return;
  const p = Math.max(0.03, Math.min(1, progress));
  const text = el.querySelector('.step');
  const pct = el.querySelector('.pct');
  const fill = el.querySelector<HTMLElement>('.fill');
  const glow = el.querySelector<HTMLElement>('.glow');
  if (text) text.textContent = step.replace(/…$/, '');
  if (pct) pct.textContent = `${Math.round(p * 100)}%`;
  if (fill) fill.style.width = `${Math.round(p * 100)}%`;
  glow?.style.setProperty('--gx', `${Math.round(8 + p * 84)}%`);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

export function hideLoading() {
  const el = loader();
  if (!el) return;
  setLoading('Ready', 1);
  el.classList.add('done');
  setTimeout(() => {
    el.remove();
    loaded = true;
    for (const f of waiting.splice(0)) f();
  }, 820);
}

/** Runs `f` once the loading screen has gone (at once if it already has). */
export function whenLoaded(f: () => void) {
  if (loaded || !loader()) f();
  else waiting.push(f);
}
