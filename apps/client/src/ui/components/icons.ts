import { svg } from './dom.ts';

// Line icons on a 24 px grid, drawn with currentColor (stroke 1.6, round caps; see .oh-i).
const PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/>',
  sunrise: '<path d="M3 18.5h18M6.5 15a5.5 5.5 0 0 1 11 0"/><path d="M12 4.5V8M5.3 8.3l1.7 1.7M18.7 8.3 17 10"/>',
  cloudSun: '<path d="M7.6 3.8v1.1M3.3 7.9h1.1M4.6 4.9l.8.8M10.8 5.6l-.8.8"/><path d="M5.4 11a3.2 3.2 0 0 1 5.4-3.2"/><path d="M8.7 19.5h8.1a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4 1.3 2.8 2.8 0 0 0 1 5.5z"/>',
  cloud: '<path d="M7.2 18.5h9.9a3.9 3.9 0 0 0 .5-7.8 5.9 5.9 0 0 0-11.4 1.7 3.1 3.1 0 0 0 1 6.1z"/>',
  rain: '<path d="M7.2 14.5h9.9a3.9 3.9 0 0 0 .5-7.8A5.9 5.9 0 0 0 6.2 8.4a3.1 3.1 0 0 0 1 6.1z"/><path d="m8.5 17.5-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
  storm: '<path d="M7.2 14.5h9.9a3.9 3.9 0 0 0 .5-7.8A5.9 5.9 0 0 0 6.2 8.4a3.1 3.1 0 0 0 1 6.1z"/><path d="m12.8 12.5-2.3 4h3.2l-2.2 4"/>',
  fog: '<path d="M7.2 11h9.9a3.4 3.4 0 0 0 .3-6.8 5.4 5.4 0 0 0-10.4 1.6"/><path d="M3.5 14.5h17M5.5 18h13M8 21.2h8"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/>',
  horizon: '<path d="M3 18.5h18M6.5 15a5.5 5.5 0 0 1 11 0"/><path d="M12 4.5V8M5.3 8.3l1.7 1.7M18.7 8.3 17 10"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  gauge: '<path d="M4.3 17.5a8.5 8.5 0 1 1 15.4 0"/><path d="m12 13.5 3.8-4.3"/><circle cx="12" cy="13.5" r="1.3"/>',
  keyboard: '<rect x="2.8" y="6" width="18.4" height="12" rx="2.2"/><path d="M6.5 9.8h.01M9.5 9.8h.01M12.5 9.8h.01M15.5 9.8h.01M18 9.8h.01M8 14.2h8"/>',
  logout: '<path d="M14 4h3.6A1.4 1.4 0 0 1 19 5.4v13.2a1.4 1.4 0 0 1-1.4 1.4H14"/><path d="m9.5 8-4 4 4 4M5.5 12H15"/>',
  play: '<path d="M8 5.6v12.8L18 12z"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
  wind: '<path d="M12 20V4.5M6.5 10 12 4.5 17.5 10"/>',
  waves: '<path d="M3 9.5c2 0 2-1.6 4.5-1.6S10 9.5 12 9.5s2-1.6 4.5-1.6S19 9.5 21 9.5M3 15.5c2 0 2-1.6 4.5-1.6S10 15.5 12 15.5s2-1.6 4.5-1.6S19 15.5 21 15.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.2 19.5a5.8 5.8 0 0 1 11.6 0"/><path d="M15.8 5.6a3.2 3.2 0 0 1 0 5.8M17.6 19.5a5.8 5.8 0 0 0-2.3-4.6"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5 15.5V6.4A1.4 1.4 0 0 1 6.4 5h9.1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v5M12 16.2h.01"/>',
  camera: '<path d="M4.4 8.2h3.1l1.6-2.4h5.8l1.6 2.4h3.1a1.4 1.4 0 0 1 1.4 1.4v8.2a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 17.8V9.6a1.4 1.4 0 0 1 1.4-1.4z"/><circle cx="12" cy="13.2" r="3.3"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, cls = ''): SVGSVGElement {
  return svg(`<svg class="oh-i${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`);
}

/** The Ocean Home mark: the glass pavilion on the rig's deck, above the swell. Same as index.html. */
export function brandMark(size = 36): SVGSVGElement {
  return svg(
    `<svg class="oh-mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0a1822"/><rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="none" stroke="rgba(190,222,238,.16)"/><rect x="11" y="6.4" width="10" height="5" rx=".8" fill="rgba(127,216,227,.2)" stroke="#7fd8e3" stroke-width="1.3"/><path d="M6 12h20" stroke="#f2b40c" stroke-width="2.2" stroke-linecap="round"/><path d="M9.5 12v12.5M22.5 12v12.5M9.5 15.8l13 5.2M22.5 15.8l-13 5.2" stroke="#f2b40c" stroke-width="1.7" fill="none" stroke-linecap="round"/><path d="M4.5 24c1.9 0 1.9-1.2 3.8-1.2s1.9 1.2 3.8 1.2 1.9-1.2 3.8-1.2 1.9 1.2 3.8 1.2 1.9-1.2 3.8-1.2 1.9 1.2 3.8 1.2" stroke="#3f9cc4" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`,
  );
}
