// Drives the static loading screen in index.html (it is visible before any script runs).

const loader = () => document.getElementById('loader');

/** Shows a step and progress (0..1), then yields a frame so the browser paints it. */
export async function setLoading(step: string, progress: number) {
  const el = loader();
  if (!el) return;
  const text = el.querySelector('.step');
  const fill = el.querySelector<HTMLElement>('.fill');
  if (text) text.textContent = step;
  if (fill) fill.style.width = `${Math.round(Math.max(0.03, Math.min(1, progress)) * 100)}%`;
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

export function hideLoading() {
  const el = loader();
  if (!el) return;
  el.classList.add('done');
  setTimeout(() => el.remove(), 700);
}
