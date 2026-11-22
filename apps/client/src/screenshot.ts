/** `oilrig-2026-10-17-214405.png`, in local time. */
export function screenshotName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `oilrig-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

/**
 * Saves what the canvas shows as a PNG download (the world only: the HUD is DOM on top of it).
 * Call it right after rendering, in the same task: a WebGPU canvas keeps its picture only until
 * the frame is presented.
 */
export function saveScreenshot(canvas: HTMLCanvasElement): Promise<string> {
  const name = screenshotName();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The browser could not capture the picture.'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      resolve(name);
    }, 'image/png');
  });
}
