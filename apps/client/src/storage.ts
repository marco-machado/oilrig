/**
 * Reads a `localStorage` value. A value saved while the project was called Ocean Home is moved
 * to its new key first, so saved settings survive the rename. Throws when storage is unavailable.
 */
export function readStored(key: string): string | null {
  const old = key.replace(/^oilrig\./, 'ocean-home.');
  const legacy = localStorage.getItem(old);
  if (legacy !== null) {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, legacy);
    localStorage.removeItem(old);
  }
  return localStorage.getItem(key);
}
