import { type Account, CLOCK_RATES, type ChatEntry, type PlayerInfo, WEATHER_KINDS, type WeatherKind, type WeatherMode, type WeatherState } from '@oilrig/shared';
import { whenLoaded } from '../loading.ts';
import { buildAccount } from './account.ts';
import { COORDS } from './coords.ts';
import type { PerfReport } from '../perf.ts';
import { QUALITY, type QualityName } from '../render/quality.ts';
import {
  type IconName,
  badge,
  bars,
  brandMark,
  button,
  drawFrameGraph,
  el,
  field,
  group,
  icon,
  input,
  kbd,
  keys,
  pill,
  reveal,
  row,
  section,
  segmented,
  setButton,
  setText,
  sheet,
  shown,
  slider,
  sliderRow,
  stackRow,
  statGrid,
  toggle,
} from './components/index.ts';
import './components.css';
import './screens.css';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);


export interface Settings {
  quality: QualityName;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  volume: number;
  /**
   * Lower the resolution when frames run late, to hold 60 fps. Off by default: every
   * change rebuilds the post-processing targets, which freezes the game for ~1.3 s.
   */
  autoResolution: boolean;
}

const SETTINGS_KEY = 'ocean-home.settings';

export function loadSettings(defaultQuality: QualityName): Settings {
  const base: Settings = { quality: defaultQuality, fov: 72, sensitivity: 1, invertY: false, volume: 0.8, autoResolution: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...base, ...JSON.parse(raw) };
  } catch {
    // storage unavailable
  }
  return base;
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable
  }
}

export interface EnvChange {
  hour?: number;
  rate?: number;
  weather?: WeatherMode;
}

export interface UIHandlers {
  onSignIn(username: string, password: string): void;
  /** Come aboard as the signed-in account (or locally, offline). */
  onJoin(): void;
  /** End the account's session (from the start screen). */
  onSignOut(): void;
  /** The display name changed in the Account section. */
  onAccountChanged(a: Account): void;
  /** Look around alone, without the server. */
  onExploreOffline(): void;
  onResume(): void;
  onChat(text: string): void;
  onSettings(s: Settings, qualityChanged: boolean): void;
  onEnv(change: EnvChange): void;
  onGpuTiming(on: boolean): void;
  /** Leave the world and go back to the start screen, still signed in (confirmed in a dialog first). */
  onLeave(): void;
  /** The sun's elevation in degrees at a local hour today, for the words under the clock. */
  sunElevationAt(hour: number): number;
}

export interface FlightHud {
  pilot: boolean;
  altitude: number;
  ground: number | null;
  speed: number;
  climb: number;
  heading: number;
  /** Body attitude (radians) for the horizon. */
  pitch: number;
  roll: number;
  /** Rotor speed as a fraction of hover rpm. */
  rotor: number;
  grounded: boolean;
  /** Rotors coming up to speed for a lift-off. */
  spooling: boolean;
  seats: string;
  /** Flying itself home: what it is doing and how far it has to go (m). */
  autopilot: { stage: string; distance: number } | null;
  /** Standing on the helipad (nowhere to fly home to). */
  atPad: boolean;
}

type Section = 'account' | 'env' | 'settings' | 'perf' | 'controls';

const NAV: Array<[Section, IconName, string]> = [
  ['account', 'user', 'Account'],
  ['env', 'horizon', 'Time & weather'],
  ['settings', 'sliders', 'Settings'],
  ['perf', 'gauge', 'Performance'],
  ['controls', 'keyboard', 'Controls'],
];

const RATES: Record<number, [string, string]> = {
  0: ['Paused', 'The clock is stopped.'],
  1: ['Real time', 'Follows the real clock at the platform.'],
  12: ['2 h', 'A full day lasts 2 hours.'],
  60: ['24 min', 'A full day lasts 24 minutes.'],
  240: ['6 min', 'A full day lasts 6 minutes.'],
};

const WEATHER_ICON: Record<WeatherKind, IconName> = { clear: 'sun', fair: 'cloudSun', overcast: 'cloud', rain: 'rain', storm: 'storm', fog: 'fog' };

/** Words for the time of day, from the sun's elevation (degrees) and the hour. */
function dayPhase(hour: number, elevation: number): [string, IconName] {
  if (elevation < -6) return ['Night', 'moon'];
  if (elevation < 0) return hour < 12 ? ['Dawn', 'sunrise'] : ['Dusk', 'sunrise'];
  if (elevation < 10) return hour < 12 ? ['Early morning', 'sunrise'] : ['Golden hour', 'sun'];
  return hour < 11 ? ['Morning', 'sun'] : hour < 14 ? ['Midday', 'sun'] : ['Afternoon', 'sun'];
}

function healthOf(r: PerfReport): ['good' | 'warn' | 'bad', string] {
  if (r.fps >= 55 && r.frameMs.p95 < 24) return ['good', 'Smooth'];
  if (r.fps >= 40) return ['warn', 'Uneven'];
  return ['bad', 'Struggling'];
}

/**
 * The DOM overlay: sign in, the HUD, chat, who's aboard, the drone instruments, and the menu
 * (Esc frees the cursor) with its section sheets and the log out dialog. Built from the
 * components in ./components; styles in base.css, components.css and screens.css.
 */
export class UI {
  readonly root = el('div', { class: 'oh' });
  private readonly handlers: UIHandlers;
  settings: Settings;
  chatOpen = false;
  cursorFree = false;
  private isJoined = false;

  // HUD
  private readonly hud = el('div', { class: 'oh-hud hud' });
  private readonly status = el('div', { class: 'oh-status oh-glass oh-joined-only' });
  private readonly clockEl = el('span', { class: 'oh-status__seg oh-status__time' }, '--:--');
  private readonly wxIcon = el('span', { class: 'oh-wx-icon' });
  private readonly wxText = el('span', {});
  private readonly windIcon = icon('wind', 'oh-wind');
  private readonly windText = el('span', {});
  private readonly windEl = el('span', { class: 'oh-status__seg' }, this.windIcon, this.windText);
  private readonly seasText = el('span', {});
  private readonly presenceDot = el('span', { class: 'oh-dot' });
  private readonly presenceText = el('span', {}, 'Offline');
  private readonly presence = el('div', { class: 'oh-presence oh-glass oh-joined-only is-offline' }, this.presenceDot, this.presenceText);
  private readonly prompt = el('div', { class: 'oh-prompt oh-glass oh-joined-only' });
  private readonly shutter = el('div', { class: 'oh-shutter', 'aria-hidden': 'true' });
  private readonly toast = el('div', { class: 'oh-toast oh-glass', role: 'status' });
  private toastTimer = 0;
  private promptText: string | null = null;
  private readonly chat = el('div', { class: 'oh-chat oh-joined-only' });
  private chatBurst = 0;
  private readonly chatLog = el('div', { class: 'oh-chat__log', role: 'log', 'aria-live': 'polite' });
  private readonly chatInput = input({ type: 'text', maxlength: '280', placeholder: 'Say something…', 'aria-label': 'Chat message' });
  private readonly chatBox = el('div', { class: 'oh-chatbox' }, this.chatInput, el('div', { class: 'oh-chatbox__hint', 'aria-hidden': 'true' }, el('span', {}, kbd('Enter'), 'send'), el('span', {}, kbd('Esc'), 'cancel')));
  private readonly aboard = el('div', { class: 'oh-aboard oh-glass oh-glass--strong' });
  private readonly flight = el('div', { class: 'oh-flight' });
  private flightBuilt: {
    values: HTMLElement[];
    hint: HTMLElement;
    mode: string;
    ap: HTMLElement;
    apStage: HTMLElement;
    apDistance: HTMLElement;
    horizon: HTMLElement;
    state: HTMLElement;
    rotorBar: HTMLElement;
    attitude: string;
    rotor: number;
    flightState: string;
  } | null = null;
  private players: PlayerInfo[] = [];
  private connected = false;
  private self: PlayerInfo | null = null;
  private readonly colors = new Map<string, string>();
  private clockText = '--:--';
  private weatherText = '';
  private hour = 12;
  private wxKey = '';
  private windDeg = Number.NaN;

  // Performance
  private readonly perfHud = el('div', { class: 'oh-perfhud oh-glass oh-glass--strong' });
  private readonly hudFps = el('span', { class: 'oh-fps__n' }, '—');
  private readonly hudHealth = pill('idle', 'Measuring');
  private readonly hudGraph = el('canvas', { class: 'oh-graph' });
  private readonly hudCaption = el('div', { class: 'oh-caption' }, ' ');
  private perfHudOn = false;
  private lastReport: PerfReport | null = null;
  private lastHistory: number[] = [];

  // Menu
  private readonly menu = el('div', { class: 'oh-menu' });
  private readonly navItems = new Map<Section, HTMLButtonElement>();
  private readonly identityAvatar = el('span', { class: 'oh-avatar' });
  private readonly identityName = el('div', { class: 'oh-identity__name' });
  private readonly identityDot = el('span', { class: 'oh-dot' });
  private readonly identityMeta = el('span', {});
  private readonly sheets: Record<Section, ReturnType<typeof sheet>>;
  private section: Section | null = null;
  private readonly dialog = el('div', { class: 'oh-dialog-backdrop' });
  private readonly dialogBody = el('p', { class: 'oh-dialog__body', id: 'oh-logout-desc' });
  private readonly stayButton = button({ label: 'Stay aboard', variant: 'secondary', onClick: () => this.closeDialog() });

  // Time & weather sheet
  private readonly clockBig = el('div', { class: 'oh-clock__time' }, '--:--');
  private readonly phaseEl = el('div', { class: 'oh-clock__phase' });
  private readonly hourSlider = slider({
    label: 'Time of day',
    min: 0,
    max: 24,
    step: 0.25,
    value: 12,
    sky: true,
    onInput: (v) => {
      this.dragging = true;
      this.showHour(v);
    },
    onChange: (v) => {
      this.dragging = false;
      this.handlers.onEnv({ hour: v });
    },
  });
  private readonly rateSeg = segmented(
    'Speed of the day',
    CLOCK_RATES.map((r): [number, string] => [r, RATES[r]?.[0] ?? `${r}×`]),
    -1,
    (rate) => this.handlers.onEnv({ rate }),
  );
  private readonly rateCaption = el('p', { class: 'oh-caption' });
  private readonly weatherTiles = new Map<WeatherMode, HTMLButtonElement>();
  private readonly envNote = el('span', {});
  private dragging = false;
  private envKey = '';
  private phaseKey = '';

  // Performance sheet
  private readonly fpsBig = el('span', { class: 'oh-fps__n' }, '—');
  private readonly healthBig = pill('idle', 'Measuring');
  private readonly frameLine = el('div', { class: 'oh-caption', style: 'font: 500 12px/1.3 var(--font-mono)' }, ' ');
  private readonly graph = el('canvas', { class: 'oh-graph' });
  private readonly stats = statGrid({ cpu: 'CPU', gpu: 'GPU', long: 'Long frames', draws: 'Draw calls', tris: 'Triangles', compute: 'Compute', memory: 'Memory', textures: 'Textures', canvas: 'Canvas' });
  private readonly cpuBars = bars();
  private readonly perfHudToggle = toggle('Show while playing', false, (on) => this.setPerfHud(on));
  private readonly gpuToggle = toggle('GPU timing', false, (on) => this.handlers.onGpuTiming(on));

  // Sign in
  private readonly join = el('div', { class: 'oh-join' });
  private readonly serverPill = pill('checking', 'Checking the server…');
  private readonly serverLine = el('div', {}, this.serverPill.el);
  private readonly userInput = input({ type: 'text', id: 'oh-user', maxlength: '64', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'Your username' });
  private readonly passInput = input({ type: 'password', id: 'oh-pass', maxlength: '256', autocomplete: 'current-password', placeholder: 'Your password' });
  private readonly credentials = el('div', { class: 'oh-join__fields' }, field('Username', this.userInput), field('Password', this.passInput));
  private readonly whoLine = el('p', { class: 'oh-join__who' });
  private readonly signUpLink = el('a', { class: 'oh-link', href: '/signup' }, 'Create an account');
  private readonly signOutLink = el('button', { type: 'button', class: 'oh-link' }, 'Sign out');
  private readonly joinLinks = el('p', { class: 'oh-join__links' }, this.signUpLink, this.signOutLink);
  private readonly joinBtn = button({ label: 'Come aboard', variant: 'primary', size: 'lg', block: true, trail: 'arrow', type: 'submit' });
  private readonly joinStatus = el('p', { class: 'oh-join__status', role: 'status' });
  /** The signed-in account; `undefined` until the server has said. */
  private account: Account | null | undefined = undefined;
  private signups = false;
  private readonly localName: string;
  private accountSheet!: ReturnType<typeof buildAccount>;
  private readonly conditions = el('span', { class: 'oh-eyebrow' });
  /** 'local': ?offline, no server expected. */
  private server: 'checking' | 'online' | 'offline' | 'local' = 'checking';
  private connecting = false;

  private readonly veil = el('div', { class: 'oh-veil', 'aria-hidden': 'true' });

  constructor(handlers: UIHandlers, settings: Settings, localName = '') {
    this.handlers = handlers;
    this.settings = settings;
    this.localName = localName;
    this.sheets = {
      account: sheet('Account', () => this.openSection(null)),
      env: sheet('Time & weather', () => this.openSection(null)),
      settings: sheet('Settings', () => this.openSection(null)),
      perf: sheet('Performance', () => this.openSection(null)),
      controls: sheet('Controls', () => this.openSection(null)),
    };
    this.buildHud();
    this.buildJoin();
    this.accountSheet = buildAccount(this.sheets.account, (a) => {
      this.account = a;
      this.refreshAccount();
      this.handlers.onAccountChanged(a);
    });
    this.buildEnv();
    this.buildSettings();
    this.buildPerf();
    this.buildControls();
    this.buildDialog();
    this.buildMenu();
    this.refreshAccount();
    this.root.append(this.hud, this.veil, this.menu, this.join);
    document.body.appendChild(this.root);

    document.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.setPerfHud(!this.perfHudOn);
      }
      // Esc with the cursor already free closes the dialog, then the open section.
      if (e.code === 'Escape' && this.cursorFree && !this.chatOpen) {
        if (shown(this.dialog)) this.closeDialog();
        else this.openSection(null);
      }
    });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) this.handlers.onChat(t);
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
    });
  }

  get joined() {
    return this.isJoined;
  }

  set joined(on: boolean) {
    this.isJoined = on;
    this.hud.classList.toggle('is-joined', on);
    if (on) this.refreshIdentity();
  }

  // ---------------------------------------------------------------- sign in

  private buildJoin() {
    for (const i of [this.userInput, this.passInput]) {
      i.addEventListener('input', () => {
        if (!i.hasAttribute('aria-invalid')) return;
        i.removeAttribute('aria-invalid');
        this.setStatus('');
      });
    }
    this.signOutLink.addEventListener('click', () => this.handlers.onSignOut());
    const form = el(
      'form',
      { class: 'oh-join__card oh-glass oh-glass--strong oh-enter', style: '--i: 3', novalidate: '' },
      this.serverLine,
      this.whoLine,
      this.credentials,
      this.joinBtn,
      this.joinStatus,
      this.joinLinks,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitJoin();
    });
    const essentials: Array<[string, string]> = [
      ['W A S D', 'Move'],
      ['Shift', 'Run'],
      ['E', 'Use'],
      ['T', 'Chat'],
      ['Esc', 'Menu'],
    ];
    this.join.append(
      el('div', { class: 'oh-join__scrim' }),
      el(
        'div',
        { class: 'oh-join__col' },
        el('div', { class: 'oh-join__brand oh-enter', style: '--i: 0' }, brandMark(40), el('span', { class: 'oh-eyebrow' }, COORDS)),
        el('h1', { class: 'oh-wordmark oh-enter', style: '--i: 1' }, 'Oilrig'),
        el('p', { class: 'oh-join__tagline oh-enter', style: '--i: 2' }, 'A glass pavilion on a converted platform, 20 m above the open ocean.'),
        form,
      ),
      el('div', { class: 'oh-join__foot oh-enter', style: '--i: 5' }, el('div', { class: 'oh-keys' }, ...essentials.map(([k, l]) => el('span', {}, keys(k), l))), this.conditions),
    );
    this.join.hidden = true;
    this.refreshAccount();
  }

  /** Who is signed in, and whether people can sign up (from the server). `null`: nobody. */
  setAccount(a: Account | null, signups = this.signups) {
    this.account = a;
    this.signups = signups;
    this.accountSheet.setAccount(a);
    this.refreshAccount();
    this.refreshIdentity();
  }

  /** The sign-in card follows the server and the account: offline, signed out, or signed in. */
  private refreshAccount() {
    const online = this.server === 'online' || this.server === 'checking';
    const signedIn = !!this.account;
    this.credentials.hidden = !online || signedIn || this.account === undefined;
    this.whoLine.hidden = !online || !signedIn;
    if (this.account) {
      this.whoLine.replaceChildren('Signed in as ', el('b', {}, this.account.displayName), ` (@${this.account.username})`);
    }
    this.signUpLink.hidden = !online || signedIn || !this.signups || this.account === undefined;
    this.signOutLink.hidden = !online || !signedIn;
    this.joinLinks.hidden = this.signUpLink.hidden && this.signOutLink.hidden;
    this.navItems.get('account')?.toggleAttribute('hidden', !signedIn || this.server === 'local');
    if (!this.connecting) this.updateJoinButton();
  }

  private submitJoin() {
    if (this.connecting) return;
    if (this.server === 'offline') {
      this.handlers.onExploreOffline();
      return;
    }
    if (this.server === 'local' || this.account) {
      this.connecting = true;
      setButton(this.joinBtn, 'Connecting…', { busy: true });
      this.setStatus('');
      this.handlers.onJoin();
      return;
    }
    if (this.account === undefined) return;
    const username = this.userInput.value.trim();
    const missing = !username ? this.userInput : !this.passInput.value ? this.passInput : null;
    if (missing) {
      this.setStatus(missing === this.userInput ? 'Type your username.' : 'Type your password.', true);
      this.shake(missing);
      return;
    }
    this.connecting = true;
    setButton(this.joinBtn, 'Signing in…', { busy: true });
    this.setStatus('');
    this.handlers.onSignIn(username, this.passInput.value);
  }

  private shake(i: HTMLInputElement) {
    i.setAttribute('aria-invalid', 'true');
    i.classList.remove('oh-shake');
    void i.offsetWidth;
    i.classList.add('oh-shake');
    i.focus();
  }

  /** A sign-in that did not work: say why, keep the username. */
  signInFailed(message: string) {
    this.connecting = false;
    this.updateJoinButton();
    this.setStatus(message, true);
    this.passInput.value = '';
    this.passInput.focus();
  }

  private updateJoinButton() {
    const label = this.server === 'offline' ? 'Explore offline' : this.server === 'local' || this.account ? 'Come aboard' : 'Sign in';
    setButton(this.joinBtn, label, { trail: 'arrow' });
  }

  /** A join that did not get in. `serverOffline`: the server could not be reached at all. */
  joinFailed(message: string, serverOffline = false) {
    this.connecting = false;
    if (serverOffline) this.setServer({ online: false });
    else {
      this.updateJoinButton();
      this.setStatus(message, true);
    }
  }

  /** Whether the server is up, from the health check; the button and the password follow it. */
  setServer(s: { online: boolean; players?: number } | 'local') {
    this.server = s === 'local' ? 'local' : s.online ? 'online' : 'offline';
    this.serverLine.hidden = this.server === 'local';
    if (this.server === 'online') {
      const n = typeof s === 'object' ? s.players : undefined;
      this.serverPill.set('good', n === undefined ? 'Server online' : `Server online · ${n === 0 ? 'nobody' : n} aboard`);
    } else if (this.server === 'offline') this.serverPill.set('bad', 'Server offline');
    this.refreshAccount();
    if (this.connecting) return;
    this.updateJoinButton();
    if (this.server === 'offline') this.setStatus('You can look around on your own. The button switches back when the server returns.');
    else if (this.joinStatus.textContent?.startsWith('You can look around')) this.setStatus('');
  }

  setStatus(text: string, error = false) {
    this.joinStatus.textContent = text;
    this.joinStatus.classList.toggle('is-error', error);
  }

  showJoin() {
    reveal(this.join, true);
    whenLoaded(() => {
      this.join.classList.add('is-ready');
      if (!this.joined && !this.credentials.hidden) (this.userInput.value ? this.passInput : this.userInput).focus();
    });
  }

  hideOverlay() {
    reveal(this.join, false, 360);
  }

  get overlayVisible() {
    return shown(this.join);
  }

  /** After leaving (or being sent off): back to the start screen, with a word on why. */
  left(message = 'You left the platform.', error = false) {
    this.joined = false;
    this.setCursorFree(false);
    this.chatOpen = false;
    this.chat.classList.remove('is-open');
    this.chatBox.remove();
    this.chatLog.replaceChildren();
    this.setFlight(null);
    this.setPrompt(null);
    reveal(this.aboard, false);
    this.self = null;
    this.colors.clear();
    this.connecting = false;
    this.updateJoinButton();
    this.setStatus(message, error);
    this.showJoin();
  }

  /** Who this browser is aboard as (from the server's welcome). */
  setSelf(p: PlayerInfo | null) {
    this.self = p;
    if (p) this.colors.set(p.id, p.color);
    this.refreshIdentity();
  }

  // ---------------------------------------------------------------- HUD

  private buildHud() {
    this.status.append(this.clockEl, el('span', { class: 'oh-status__seg' }, this.wxIcon, this.wxText), this.windEl, el('span', { class: 'oh-status__seg', title: 'Wave height' }, icon('waves'), this.seasText));
    this.prompt.hidden = true;
    this.chat.append(this.chatLog);
    this.aboard.hidden = true;
    this.perfHud.append(el('div', { class: 'oh-perf-top' }, el('div', { class: 'oh-fps' }, this.hudFps, el('span', { class: 'oh-fps__u' }, 'FPS')), this.hudHealth.el), this.hudGraph, this.hudCaption);
    this.perfHud.hidden = true;
    this.flight.hidden = true;
    this.toast.hidden = true;
    this.hud.append(
      this.shutter,
      this.toast,
      this.status,
      this.presence,
      el('div', { class: 'oh-crosshair oh-joined-only' }),
      this.prompt,
      this.chat,
      el('div', { class: 'oh-hud-right' }, this.aboard, this.perfHud),
      this.flight,
    );
  }

  setPrompt(text: string | null) {
    if (text === this.promptText) return;
    this.promptText = text;
    if (!text) {
      this.prompt.hidden = true;
      return;
    }
    // "E · Open the door": the key becomes a keycap.
    const m = /^(\S+) · (.+)$/.exec(text);
    this.prompt.replaceChildren(...(m ? [kbd(m[1]), m[2]] : [text]));
    this.prompt.classList.toggle('is-plain', !m);
    this.prompt.hidden = false;
  }

  setClock(localHour: number) {
    const h = Math.floor(localHour);
    const m = Math.floor((localHour - h) * 60);
    this.hour = localHour;
    this.clockText = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    setText(this.clockEl, this.clockText);
    if (!this.join.hidden) setText(this.conditions, `${this.clockText} · ${this.weatherText}`);
  }

  setWeather(w: WeatherState) {
    const night = this.hour < 6 || this.hour >= 18.75;
    const name: IconName = night && w.kind === 'clear' ? 'moon' : night && w.kind === 'fair' ? 'cloud' : WEATHER_ICON[w.kind];
    const key = `${w.kind}|${name}`;
    if (key !== this.wxKey) {
      this.wxKey = key;
      this.wxIcon.replaceChildren(icon(name));
      this.wxText.textContent = cap(w.kind);
    }
    const from = compass(w.windDirection + 180);
    const kn = Math.round(w.windSpeed * 1.944);
    const seas = `${w.waveHeight.toFixed(1)} m`;
    setText(this.windText, `${from} ${kn} kn`);
    setText(this.seasText, seas);
    // The arrow points where the wind blows.
    const deg = Math.round(w.windDirection);
    if (deg !== this.windDeg) {
      this.windDeg = deg;
      this.windIcon.style.transform = `rotate(${deg}deg)`;
      this.windEl.title = `Wind from the ${from}, ${kn} knots`;
    }
    this.weatherText = `${cap(w.kind)} · Wind ${from} ${kn} kn · Seas ${seas}`;
  }

  setPlayers(list: PlayerInfo[], connected: boolean) {
    this.players = list;
    this.connected = connected;
    for (const p of list) this.colors.set(p.id, p.color);
    setText(this.presenceText, connected ? `${list.length} aboard` : 'Offline');
    this.presence.classList.toggle('is-offline', !connected);
    this.presenceDot.className = `oh-dot${connected ? ' oh-dot--good' : ''}`;
    if (shown(this.aboard)) this.renderAboard();
    this.refreshIdentity();
  }

  private renderAboard() {
    const ul = el('ul');
    for (const p of this.players) {
      const you = this.self?.id === p.id;
      ul.append(el('li', {}, el('span', { class: 'oh-avatar oh-avatar--sm', style: `--c: ${p.color}` }, p.name[0]?.toUpperCase() ?? '?'), p.name, p.kind === 'agent' ? badge('AI') : you ? badge('YOU', true) : null));
    }
    this.aboard.replaceChildren(
      el('div', { class: 'oh-eyebrow' }, this.connected ? `On board · ${this.players.length}` : 'On board'),
      this.connected ? ul : el('div', { class: 'oh-aboard__empty' }, 'Offline: nobody else is here.'),
    );
  }

  togglePlayers(show: boolean) {
    if (show) this.renderAboard();
    reveal(this.aboard, show, 200);
  }

  addChat(entry: ChatEntry | { system: string }) {
    const line = el('div', { class: 'oh-chat__line' });
    if ('system' in entry) {
      line.classList.add('oh-chat__line--sys');
      line.textContent = entry.system;
    } else {
      const color = this.colors.get(entry.from);
      if (color) line.style.setProperty('--c', color);
      line.append(el('b', {}, entry.name), entry.text);
    }
    // Lines that arrive together (the history on joining) come in one after another.
    line.style.animationDelay = `${Math.min(this.chatBurst, 10) * 45}ms`;
    if (this.chatBurst++ === 0) queueMicrotask(() => (this.chatBurst = 0));
    this.glideChat(() => {
      this.chatLog.append(line);
      while (this.chatLog.childElementCount > 40) this.chatLog.firstElementChild?.remove();
    });
    setTimeout(() => line.classList.add('is-faded'), 12000);
  }

  /**
   * Runs a change to the chat's layout and lets the lines already shown glide to their new
   * places (a FLIP animation) instead of jumping: up to make room for a new line, down when
   * the input box closes.
   */
  private glideChat(change: () => void) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    const lines = [...this.chatLog.children] as HTMLElement[];
    const tops = lines.map((l) => l.getBoundingClientRect().top);
    change();
    lines.forEach((l, i) => {
      if (!l.isConnected) return;
      const dy = tops[i] - l.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5) return;
      l.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', composite: 'add' });
    });
  }

  openChat() {
    this.chatOpen = true;
    // Faded lines come back from the newest up, one after another.
    const lines = [...this.chatLog.children] as HTMLElement[];
    lines.forEach((l, i) => l.style.setProperty('--i', String(lines.length - 1 - i)));
    this.glideChat(() => {
      this.chat.classList.add('is-open');
      this.chat.append(this.chatBox);
    });
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat() {
    this.chatOpen = false;
    this.chatInput.blur();
    this.glideChat(() => {
      this.chat.classList.remove('is-open');
      this.chatBox.remove();
    });
    this.handlers.onResume();
  }

  setFade(on: boolean) {
    this.veil.classList.toggle('on', on);
  }

  /** A shutter flash and a note with the file name. */
  screenshotTaken(name: string) {
    this.shutter.classList.remove('is-on');
    void this.shutter.offsetWidth; // restart the flash
    this.shutter.classList.add('is-on');
    this.toast.replaceChildren(icon('camera'), el('span', {}, 'Screenshot saved'), el('span', { class: 'oh-toast__file' }, name));
    reveal(this.toast, true);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => reveal(this.toast, false, 260), 2600);
  }

  /** Instruments while flying or riding in the drone, or null to hide them. Runs every frame. */
  setFlight(f: FlightHud | null) {
    if (!f) {
      if (!this.flight.hidden) reveal(this.flight, false);
      return;
    }
    if (!this.flightBuilt) {
      const gauges = el('div', { class: 'oh-gauges oh-glass' });
      // Attitude indicator: a round window on the horizon, which banks and slides with the cabin.
      const horizon = el('div', { class: 'oh-horizon__disc' }, el('div', { class: 'oh-horizon__sky' }), el('div', { class: 'oh-horizon__line' }), el('div', { class: 'oh-horizon__ticks' }));
      const state = el('span', { class: 'oh-horizon__state' }, '');
      const rotorBar = el('i', {});
      const horizonBox = el(
        'div',
        { class: 'oh-gauge oh-gauge--horizon' },
        el('div', { class: 'oh-horizon' }, horizon, el('div', { class: 'oh-horizon__wings', 'aria-hidden': 'true' })),
        el('div', { class: 'oh-horizon__side' }, state, el('span', { class: 'oh-rotor' }, el('span', { class: 'oh-rotor__track' }, rotorBar), el('span', { class: 'oh-rotor__label' }, 'RPM'))),
      );
      gauges.append(horizonBox);
      const values: HTMLElement[] = [];
      for (const [label, unit] of [
        ['ALT', 'm'],
        ['AGL', 'm'],
        ['SPD', 'km/h'],
        ['V/S', 'm/s'],
        ['HDG', '°'],
      ]) {
        const v = el('span', {});
        values.push(v);
        gauges.append(el('div', { class: 'oh-gauge' }, el('span', { class: 'oh-gauge__label' }, label), el('span', { class: 'oh-gauge__value' }, v, el('span', { class: 'oh-gauge__unit' }, unit))));
      }
      const hint = el('div', { class: 'oh-flight__hint oh-glass' });
      const apStage = el('span', {});
      const apDistance = el('span', { class: 'oh-autopilot__dist' });
      const ap = el('div', { class: 'oh-autopilot oh-glass', role: 'status' }, el('span', { class: 'oh-autopilot__dot', 'aria-hidden': 'true' }), el('b', {}, 'Autopilot'), apStage, apDistance);
      ap.hidden = true;
      this.flight.append(ap, gauges, hint);
      this.flightBuilt = { values, hint, mode: '', ap, apStage, apDistance, horizon, state, rotorBar, attitude: '', rotor: -1, flightState: '' };
    }
    reveal(this.flight, true);
    const b = this.flightBuilt;
    const [alt, agl, spd, vs, hdg] = b.values;
    setText(alt, String(Math.round(f.altitude)));
    setText(agl, f.ground === null ? '—' : Math.max(0, f.ground).toFixed(1));
    setText(spd, String(Math.round(f.speed * 3.6)));
    setText(vs, `${f.climb >= 0 ? '+' : ''}${f.climb.toFixed(1)}`);
    setText(hdg, String(Math.round(((f.heading % 360) + 360) % 360)).padStart(3, '0'));
    // Horizon: nose up slides the line down; a right bank (roll < 0) tilts it anticlockwise.
    const rollDeg = (f.roll * 180) / Math.PI;
    const pitchPx = Math.max(-26, Math.min(26, (f.pitch * 180) / Math.PI * 1.6));
    const attitude = `${rollDeg.toFixed(1)}|${pitchPx.toFixed(1)}`;
    if (attitude !== b.attitude) {
      b.attitude = attitude;
      b.horizon.style.transform = `rotate(${rollDeg.toFixed(1)}deg) translateY(${pitchPx.toFixed(1)}px)`;
    }
    const rotor = Math.round(Math.min(1, Math.max(0, f.rotor)) * 100);
    if (rotor !== b.rotor) {
      b.rotor = rotor;
      b.rotorBar.style.width = `${rotor}%`;
    }
    const flightState = f.autopilot ? 'AUTO' : f.spooling ? 'SPOOL' : f.grounded ? 'PARKED' : f.speed > 3 ? (Math.abs(f.climb) > 1.2 ? (f.climb > 0 ? 'CLIMB' : 'DESCENT') : 'CRUISE') : Math.abs(f.climb) > 0.8 ? (f.climb > 0 ? 'CLIMB' : 'DESCENT') : 'HOVER';
    if (flightState !== b.flightState) {
      b.flightState = flightState;
      setText(b.state, flightState);
      b.state.dataset.state = flightState.toLowerCase();
    }
    if (f.autopilot) {
      setText(b.apStage, f.autopilot.stage);
      const d = f.autopilot.distance;
      setText(b.apDistance, d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);
    }
    reveal(b.ap, !!f.autopilot);
    const mode = `${f.pilot}|${f.grounded}|${f.spooling}|${f.seats}|${!!f.autopilot}|${f.atPad}`;
    if (mode !== b.mode) {
      b.mode = mode;
      const home: Array<[string | null, string]> = f.atPad ? [] : [['H', 'fly home']];
      const items: Array<[string | null, string]> = f.pilot
        ? f.autopilot
          ? [
              ['H', 'take over'],
              [null, 'or move the stick'],
              [null, 'Mouse looks around'],
            ]
          : f.grounded
            ? [['Space', f.spooling ? 'hold to lift off' : 'lift off'], ...home, ['E', 'climb out']]
            : [['W A S D', 'fly'], [null, 'Mouse steer'], ['Space', 'climb'], ['Shift / C', 'descend'], ...home]
        : f.grounded
          ? [['E', 'climb out']]
          : [[null, 'Riding along · look around with the mouse']];
      b.hint.replaceChildren(el('span', { class: 'oh-flight__seat' }, f.seats), ...items.map(([k, label]) => el('span', {}, k ? keys(k) : null, label)));
    }
  }

  // ---------------------------------------------------------------- menu

  private buildMenu() {
    const scrim = el('div', { class: 'oh-scrim', 'aria-hidden': 'true' });
    scrim.addEventListener('click', () => this.handlers.onResume());
    const nav = el('div', { class: 'oh-nav' });
    for (const [id, ic, label] of NAV) {
      const b = el('button', { type: 'button', class: 'oh-nav__item', 'aria-current': 'false' }, icon(ic), label, el('span', { class: 'oh-nav__meta' }, id === 'perf' ? kbd('F3') : null, icon('chev')));
      b.addEventListener('click', () => this.openSection(this.section === id ? null : id));
      this.navItems.set(id, b);
      nav.append(b);
    }
    const rail = el(
      'nav',
      { class: 'oh-rail oh-glass oh-glass--strong', 'aria-label': 'Menu' },
      el('div', { class: 'oh-brand' }, brandMark(38), el('div', {}, el('div', { class: 'oh-brand__name' }, 'Oilrig'), el('div', { class: 'oh-brand__sub' }, COORDS))),
      el('div', { class: 'oh-identity' }, this.identityAvatar, el('div', {}, this.identityName, el('div', { class: 'oh-identity__meta' }, this.identityDot, this.identityMeta))),
      el(
        'div',
        { class: 'oh-rail__resume' },
        button({ label: 'Back to the world', variant: 'primary', size: 'lg', block: true, icon: 'play', onClick: () => this.handlers.onResume() }),
        el('p', { class: 'oh-rail__hint' }, 'or click anywhere in the world'),
      ),
      nav,
      el('div', { class: 'oh-rail__foot' }, button({ label: 'Leave', variant: 'quiet-danger', block: true, icon: 'logout', onClick: () => this.openDialog() })),
    );
    this.menu.append(scrim, rail, ...Object.values(this.sheets).map((s) => s.el), this.dialog);
    this.menu.hidden = true;
  }

  private refreshIdentity() {
    const name = this.self?.name ?? this.account?.displayName ?? (this.localName || 'You');
    this.identityAvatar.style.setProperty('--c', this.self?.color ?? 'var(--oh-rig)');
    setText(this.identityAvatar, name[0].toUpperCase());
    setText(this.identityName, name);
    this.identityDot.className = `oh-dot${this.connected ? ' oh-dot--good' : ''}`;
    setText(this.identityMeta, this.connected ? `Online · ${this.players.length} aboard` : 'Exploring offline');
  }

  /** Opens one section beside the menu rail (or none); the previous one slides away. */
  private openSection(id: Section | null) {
    this.section = id;
    for (const [key, s] of Object.entries(this.sheets) as Array<[Section, ReturnType<typeof sheet>]>) reveal(s.el, key === id);
    for (const [key, b] of this.navItems) b.setAttribute('aria-current', String(key === id));
    if (id === 'perf' && this.lastReport) this.setPerf(this.lastReport, this.lastHistory);
    if (id === 'account') this.accountSheet.opened();
  }

  /** Closes the sections that need the cursor; the performance readout stays until F3. */
  closePanels() {
    this.openSection(null);
  }

  /** Esc frees the cursor: the world keeps running and the menu opens over it. */
  setCursorFree(free: boolean) {
    this.cursorFree = free && this.joined;
    this.hud.classList.toggle('is-menu', this.cursorFree);
    reveal(this.status, !this.cursorFree);
    if (this.cursorFree) {
      this.refreshIdentity();
      reveal(this.menu, true);
      return;
    }
    if (!this.menu.hidden) reveal(this.menu, false, 220);
    this.closeDialog();
    this.closePanels();
  }

  private buildDialog() {
    const confirm = button({
      label: 'Leave',
      variant: 'danger',
      icon: 'logout',
      onClick: () => {
        this.closeDialog();
        this.handlers.onLeave();
      },
    });
    this.dialog.append(
      el(
        'div',
        { class: 'oh-dialog oh-glass oh-glass--strong', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'oh-logout-title', 'aria-describedby': 'oh-logout-desc' },
        el('div', { class: 'oh-dialog__icon' }, icon('logout')),
        el('h2', { class: 'oh-dialog__title', id: 'oh-logout-title' }, 'Leave the platform?'),
        this.dialogBody,
        el('div', { class: 'oh-dialog__actions' }, this.stayButton, confirm),
      ),
    );
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.closeDialog();
    });
    this.dialog.hidden = true;
  }

  private openDialog() {
    this.dialogBody.textContent = this.connected
      ? 'You’ll go back to the start screen, still signed in. Everyone aboard will see that you left.'
      : 'You’ll go back to the start screen.';
    reveal(this.dialog, true);
    this.stayButton.focus();
  }

  private closeDialog() {
    reveal(this.dialog, false, 200);
  }

  // ---------------------------------------------------------------- time & weather

  private buildEnv() {
    const s = this.sheets.env;
    const forecast = el(
      'button',
      { type: 'button', class: 'oh-tile oh-tile--wide', 'aria-pressed': 'false' },
      icon('compass'),
      el('span', {}, el('b', {}, 'Forecast'), el('small', {}, 'Changes on its own through the day')),
      icon('check', 'oh-check'),
    );
    forecast.addEventListener('click', () => this.handlers.onEnv({ weather: 'auto' }));
    this.weatherTiles.set('auto', forecast);
    const tiles = el('div', { class: 'oh-tiles' });
    for (const kind of WEATHER_KINDS) {
      const b = el('button', { type: 'button', class: 'oh-tile', 'aria-pressed': 'false' }, icon(WEATHER_ICON[kind]), cap(kind));
      b.addEventListener('click', () => this.handlers.onEnv({ weather: kind }));
      this.weatherTiles.set(kind, b);
      tiles.append(b);
    }
    s.body.append(
      section(null, el('div', { class: 'oh-clock' }, this.clockBig, this.phaseEl), this.hourSlider.el, el('div', { class: 'oh-ticks', 'aria-hidden': 'true' }, ...['00', '06', '12', '18', '24'].map((t) => el('span', {}, t)))),
      section('Speed of the day', this.rateSeg.el, this.rateCaption),
      section('Weather', forecast, tiles),
    );
    s.foot.append(el('p', { class: 'oh-note' }, icon('users'), this.envNote));
    s.foot.hidden = false;
  }

  /** The clock, the words under it and the sun or moon on the dial, for an hour. */
  private showHour(hour: number) {
    const h = Math.floor(((hour % 24) + 24) % 24);
    const m = Math.floor((hour - Math.floor(hour)) * 60);
    setText(this.clockBig, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    const quarter = Math.round(hour * 4) / 4;
    const key = String(quarter);
    if (key === this.phaseKey) return;
    this.phaseKey = key;
    const elevation = this.handlers.sunElevationAt(quarter);
    const [label, ic] = dayPhase(quarter, elevation);
    this.phaseEl.replaceChildren(icon(ic), label);
    this.hourSlider.el.classList.toggle('is-night', elevation < -3);
  }

  /** Reflects the shared clock and weather in the sheet. */
  setEnv(o: { hour: number; rate: number; weatherMode: WeatherMode; online: boolean; by?: string }) {
    if (!this.dragging) {
      const q = Math.round(o.hour * 4) / 4;
      if (Number(this.hourSlider.el.value) !== q) this.hourSlider.set(q);
      this.showHour(o.hour);
    }
    const key = `${o.rate}|${o.weatherMode}|${o.online}|${o.by ?? ''}`;
    if (key === this.envKey) return;
    this.envKey = key;
    this.rateSeg.set(o.rate);
    setText(this.rateCaption, RATES[o.rate]?.[1] ?? `The day runs ${o.rate}× faster than real time.`);
    for (const [kind, b] of this.weatherTiles) b.setAttribute('aria-pressed', String(kind === o.weatherMode));
    this.sheets.env.setEyebrow(o.online ? 'Shared with everyone aboard' : 'Only for you while offline');
    setText(this.envNote, o.online ? `Changes apply to everyone aboard.${o.by ? ` Last changed by ${o.by}.` : ''}` : 'Offline: changes are only for you.');
  }

  // ---------------------------------------------------------------- settings

  private buildSettings() {
    const s = this.sheets.settings;
    s.setEyebrow('Saved on this device');
    const apply = (patch: Partial<Settings>) => {
      const changed = patch.quality !== undefined && patch.quality !== this.settings.quality;
      this.settings = { ...this.settings, ...patch };
      saveSettings(this.settings);
      this.handlers.onSettings(this.settings, changed);
    };
    const quality = segmented(
      'Graphics quality',
      Object.keys(QUALITY).map((n): [QualityName, string] => [n as QualityName, cap(n)]),
      this.settings.quality,
      (v) => {
        quality.set(v);
        apply({ quality: v });
      },
    );
    const st = this.settings;
    s.body.append(
      section(
        'Graphics',
        group(
          stackRow('Quality', 'Changing it reloads the world.', quality.el),
          row(
            'Automatic resolution',
            'Lowers the resolution when frames run late, to hold 60 fps. Each change pauses the game for about a second.',
            toggle('Automatic resolution', st.autoResolution, (on) => apply({ autoResolution: on })),
          ),
        ),
      ),
      section(
        'View',
        group(
          sliderRow({ label: 'Field of view', min: 55, max: 100, step: 1, value: st.fov, format: (v) => `${Math.round(v)}°`, onInput: (v) => apply({ fov: v }) }).el,
          sliderRow({ label: 'Look sensitivity', min: 0.2, max: 3, step: 0.05, value: st.sensitivity, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => apply({ sensitivity: v }) }).el,
          row('Invert look', 'Move the mouse up to look down.', toggle('Invert look', st.invertY, (on) => apply({ invertY: on }))),
        ),
      ),
      section('Sound', group(sliderRow({ label: 'Volume', min: 0, max: 1, step: 0.05, value: st.volume, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => apply({ volume: v }) }).el)),
    );
  }

  // ---------------------------------------------------------------- performance

  private buildPerf() {
    const s = this.sheets.perf;
    s.setEyebrow('This browser');
    const copy = button({ label: 'Copy report', variant: 'secondary', size: 'sm', icon: 'copy' });
    copy.addEventListener('click', () => {
      if (!this.lastReport) return;
      const done = (ok: boolean) => {
        setButton(copy, ok ? 'Copied' : 'Couldn’t copy', { icon: ok ? 'check' : 'alert' });
        setTimeout(() => setButton(copy, 'Copy report', { icon: 'copy' }), 1600);
      };
      const text = JSON.stringify(this.lastReport, null, 2);
      if (!navigator.clipboard) done(false);
      else navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    });
    const legend = el(
      'div',
      { class: 'oh-legend' },
      el('span', {}, el('i', { style: 'background: var(--oh-good)' }), 'On time'),
      el('span', {}, el('i', { style: 'background: var(--oh-warn)' }), 'Late'),
      el('span', {}, el('i', { style: 'background: var(--oh-bad)' }), 'Long frame'),
    );
    const desc = el('span', {}, 'A compact readout in the corner. ', kbd('F3'), ' also toggles it.');
    s.body.append(
      section(null, el('div', { class: 'oh-perf-top' }, el('div', { class: 'oh-fps' }, this.fpsBig, el('span', { class: 'oh-fps__u' }, 'FPS')), this.healthBig.el), this.frameLine, this.graph, legend),
      section(null, this.stats.el),
      section('CPU by system · ms per frame', this.cpuBars.el),
      section(
        null,
        group(row('Show while playing', desc, this.perfHudToggle), row('GPU timing', 'Measures render and compute time on the GPU. Reloads the world.', this.gpuToggle)),
      ),
    );
    s.foot.append(copy, el('span', { class: 'oh-caption' }, 'JSON, for bug reports'));
    s.foot.hidden = false;
  }

  /** The performance readout in the corner (F3). */
  private setPerfHud(on: boolean) {
    this.perfHudOn = on;
    this.perfHudToggle.checked = on;
    reveal(this.perfHud, on, 200);
    if (on && this.lastReport) this.setPerf(this.lastReport, this.lastHistory);
  }

  get perfOpen() {
    return this.perfHudOn || (this.cursorFree && this.section === 'perf');
  }

  /** Draws the frame-time graphs and the numbers. */
  setPerf(r: PerfReport, history: number[]) {
    this.lastReport = r;
    this.lastHistory = history;
    const [tone, label] = healthOf(r);
    const fps = r.fps.toFixed(0);
    if (shown(this.perfHud)) {
      setText(this.hudFps, fps);
      this.hudHealth.set(tone, label);
      drawFrameGraph(this.hudGraph, history, true);
      setText(this.hudCaption, `${r.frameMs.avg.toFixed(1)} ms · p95 ${r.frameMs.p95.toFixed(1)} · max ${r.frameMs.max.toFixed(0)}`);
    }
    if (!this.cursorFree || this.section !== 'perf') return;
    this.sheets.perf.setEyebrow(`This browser · ${cap(r.quality)} quality`);
    setText(this.fpsBig, fps);
    this.healthBig.set(tone, label);
    setText(this.frameLine, `${r.frameMs.avg.toFixed(1)} ms average · p95 ${r.frameMs.p95.toFixed(1)} · max ${r.frameMs.max.toFixed(0)}`);
    drawFrameGraph(this.graph, history, false);
    const st = this.stats;
    st.set('cpu', r.cpuMs.toFixed(2), 'ms');
    if (!r.gpu.enabled) st.set('gpu', 'Off');
    else if (r.gpu.renderMs === null) st.set('gpu', '…');
    else st.set('gpu', `≥${r.gpu.renderMs.toFixed(1)}`, 'ms');
    st.set('long', String(r.longFrames), `/ ${Math.min(240, r.frames)}`);
    st.set('draws', String(r.renderer.drawCalls));
    st.set('tris', (r.renderer.triangles / 1e6).toFixed(2), 'M');
    st.set('compute', String(r.renderer.computeCalls), 'disp.');
    if (r.heapMB === null) st.set('memory', String(r.renderer.geometries), 'geo.');
    else st.set('memory', r.heapMB.toFixed(0), 'MB');
    st.set('textures', String(r.renderer.textures));
    st.set('canvas', `${r.canvas.width}×${r.canvas.height}`, r.resolutionScale < 1 ? `${Math.round(r.resolutionScale * 100)}%` : `@${r.canvas.pixelRatio}`);
    this.cpuBars.set(r.sections.slice(0, 6));
    this.gpuToggle.checked = r.gpu.enabled;
  }

  // ---------------------------------------------------------------- controls

  private buildControls() {
    const s = this.sheets.controls;
    s.setEyebrow('Keyboard, mouse and gamepad');
    const keyRow = (combo: string, label: string) => el('div', { class: 'oh-row oh-row--keys' }, el('span', { class: 'oh-row__title' }, label), keys(combo));
    s.body.append(
      section(
        'On foot',
        group(
          keyRow('W A S D', 'Move'),
          keyRow('Shift', 'Run'),
          keyRow('Space', 'Jump'),
          keyRow('E', 'Use doors, elevator, drone'),
          keyRow('T / Enter', 'Chat'),
          keyRow('Tab', 'Who’s aboard (hold)'),
          keyRow('Esc', 'Menu'),
          keyRow('P', 'Screenshot'),
          keyRow('F3', 'Performance'),
        ),
      ),
      section(
        'Flying the drone',
        group(keyRow('W A S D', 'Fly'), keyRow('Space', 'Climb'), keyRow('Shift / C', 'Descend'), keyRow('H', 'Fly home and land on the helipad'), keyRow('E', 'Climb out once landed')),
      ),
      el('p', { class: 'oh-note' }, icon('alert'), el('span', {}, 'Gamepad: left stick moves, right stick looks, A jumps, X uses, LB runs, Y flies the drone home.')),
    );
  }
}
