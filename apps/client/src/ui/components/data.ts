import { el, setText } from './dom.ts';

const GRAPH_MAX_MS = 50;

/** Frame times as bars, with dashed 60 and 30 fps lines (labelled unless compact). */
export function drawFrameGraph(canvas: HTMLCanvasElement, history: number[], compact: boolean) {
  const cssW = canvas.clientWidth;
  if (!cssW) return;
  const k = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cssW * k);
  const h = Math.round(canvas.clientHeight * k);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, w, h);
  const y = (ms: number) => h - (ms / GRAPH_MAX_MS) * (h - 4 * k);
  g.lineWidth = k;
  g.setLineDash([3 * k, 4 * k]);
  g.strokeStyle = 'rgba(232,239,242,0.16)';
  g.fillStyle = 'rgba(232,239,242,0.42)';
  g.font = `500 ${10 * k}px "JetBrains Mono Variable", monospace`;
  g.textAlign = 'right';
  for (const [ms, label] of [
    [16.7, '60 fps'],
    [33.3, '30 fps'],
  ] as const) {
    g.beginPath();
    g.moveTo(0, y(ms));
    g.lineTo(w, y(ms));
    g.stroke();
    if (!compact) g.fillText(`${ms} ms · ${label}`, w - 8 * k, y(ms) - 5 * k);
  }
  g.setLineDash([]);
  const n = history.length;
  const bw = w / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    const v = history[i];
    const top = Math.max(2 * k, y(Math.min(v, GRAPH_MAX_MS)));
    g.fillStyle = v > 33.4 ? '#ff6a5c' : v > 17.5 ? 'rgba(255,159,69,0.9)' : i === n - 1 ? '#7ff0bd' : 'rgba(82,212,154,0.7)';
    g.fillRect(i * bw, top, Math.max(k, bw - (bw > 2 * k ? k : 0)), h - top);
  }
}

/** Label/value tiles in rows of three. */
export function statGrid<K extends string>(labels: Record<K, string>) {
  const values = {} as Record<K, { value: HTMLElement; unit: HTMLElement }>;
  const e = el('div', { class: 'oh-group oh-stats' });
  for (const key of Object.keys(labels) as K[]) {
    const value = el('span', {});
    const unit = el('span', { class: 'oh-stat__unit' });
    values[key] = { value, unit };
    e.append(el('div', { class: 'oh-stat' }, el('span', { class: 'oh-eyebrow' }, labels[key]), el('span', { class: 'oh-stat__value' }, value, unit)));
  }
  return {
    el: e,
    set(key: K, value: string, unit = '') {
      setText(values[key].value, value);
      setText(values[key].unit, unit);
    },
  };
}

/** Named horizontal bars with their values, sized against the total. */
export function bars() {
  const e = el('div', { class: 'oh-bars' });
  return {
    el: e,
    set(items: Array<{ name: string; ms: number }>) {
      const total = Math.max(0.01, items.reduce((a, b) => a + b.ms, 0));
      while (e.childElementCount > items.length * 3) e.lastElementChild!.remove();
      items.forEach((it, i) => {
        if (e.childElementCount <= i * 3) e.append(el('span', {}), el('span', { class: 'oh-bar' }, el('i', {})), el('b', {}));
        const [name, bar, value] = [e.children[i * 3], e.children[i * 3 + 1], e.children[i * 3 + 2]];
        setText(name, it.name);
        (bar.firstElementChild as HTMLElement).style.setProperty('--w', `${Math.max(2, Math.round((it.ms / total) * 100))}%`);
        setText(value, it.ms.toFixed(2));
      });
    },
  };
}
