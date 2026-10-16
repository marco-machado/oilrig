import { CLOCK_RATES, type ChatEntry, type PlayerInfo, WEATHER_KINDS, type WeatherMode, type WeatherState } from '@ocean-home/shared';
import type { PerfReport } from '../perf.ts';
import { QUALITY, type QualityName } from '../render/quality.ts';
import './style.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export interface Settings {
  quality: QualityName;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  volume: number;
  /** Lower the resolution when frames run late, to hold 60 fps. */
  autoResolution: boolean;
}

const SETTINGS_KEY = 'ocean-home.settings';

export function loadSettings(defaultQuality: QualityName): Settings {
  const base: Settings = { quality: defaultQuality, fov: 72, sensitivity: 1, invertY: false, volume: 0.8, autoResolution: true };
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
  onJoin(name: string, password: string): void;
  /** Look around alone, without the server. */
  onExploreOffline(): void;
  onResume(): void;
  onChat(text: string): void;
  onSettings(s: Settings, qualityChanged: boolean): void;
  onEnv(change: EnvChange): void;
  onGpuTiming(on: boolean): void;
}

export interface FlightHud {
  pilot: boolean;
  altitude: number;
  ground: number | null;
  speed: number;
  climb: number;
  heading: number;
  grounded: boolean;
  seats: string;
}

type PanelName = 'settings' | 'env' | 'perf';

const RATE_LABELS: Record<number, string> = { 0: 'Paused', 1: 'Real time', 12: '2 h day', 60: '24 min day', 240: '6 min day' };

/** DOM overlay: join card, HUD, chat, player list, and the panels reached with the cursor free. */
export class UI {
  readonly root = el('div');
  private readonly overlay = el('div', { class: 'overlay' });
  private readonly joinCard = el('div', { class: 'card' });
  private readonly toolbar = el('div', { class: 'toolbar' });
  private readonly panels = el('div', { class: 'panels' });
  private readonly settingsPanel = el('section', { class: 'panel', 'aria-label': 'Settings' });
  private readonly envPanel = el('section', { class: 'panel', 'aria-label': 'Time and weather' });
  private readonly perfPanel = el('section', { class: 'panel perf', 'aria-label': 'Performance' });
  private readonly open = new Set<PanelName>();
  private readonly flight = el('div', { class: 'flight' });
  private readonly hourInput = el('input', { type: 'range', min: '0', max: '24', step: '0.25' });
  private readonly hourLabel = el('span', { class: 'value' });
  private readonly rateButtons = new Map<number, HTMLButtonElement>();
  private readonly weatherButtons = new Map<string, HTMLButtonElement>();
  private readonly envNote = el('p', { class: 'note' });
  private readonly perfGraph = el('canvas', { width: '300', height: '70' });
  private readonly perfStats = el('div', { class: 'stats' });
  private readonly perfSections = el('div', { class: 'sections' });
  private readonly gpuToggle = el('button', { type: 'button', class: 'secondary small' });
  private dragging = false;
  private lastReport: PerfReport | null = null;
  cursorFree = false;
  private readonly status = el('div', { class: 'status' });
  private readonly nameInput = el('input', { type: 'text', maxlength: '24', autocomplete: 'nickname', placeholder: 'Your name' });
  private readonly passInput = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Only if the host set one' });
  private readonly joinBtn = el('button', { type: 'button' }, 'Enter');
  private readonly serverLine = el('div', { class: 'server-state', 'data-state': 'checking', role: 'status' }, 'Checking the server…');
  private passField: HTMLElement | null = null;
  /** 'local': ?offline, no server expected. */
  private server: 'checking' | 'online' | 'offline' | 'local' = 'checking';
  private connecting = false;
  private readonly hud = el('div', { class: 'hud' });
  private readonly prompt = el('div', { class: 'prompt' });
  private readonly clock = el('div', { class: 'chip' }, '--:--');
  private readonly weather = el('div', { class: 'chip' }, '');
  private readonly online = el('div', { class: 'chip online' }, 'Offline');
  private readonly chat = el('div', { class: 'chat' });
  private readonly chatLog = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  private readonly chatInput = el('input', { class: 'chat-input', type: 'text', maxlength: '280', placeholder: 'Say something…' });
  private readonly players = el('div', { class: 'players' });
  private readonly fade = el('div', { class: 'fade-screen' });
  private readonly handlers: UIHandlers;
  settings: Settings;
  chatOpen = false;
  joined = false;

  constructor(handlers: UIHandlers, settings: Settings, defaultName = '') {
    this.handlers = handlers;
    this.settings = settings;
    document.body.appendChild(this.root);
    this.root.append(this.hud, this.fade, this.overlay);

    // Join card.
    this.joinCard.append(
      el('h1', {}, 'Ocean Home'),
      el('p', {}, 'A glass pavilion on a converted platform, 20 m above the open ocean.'),
    );
    const nameField = el('label', { class: 'field' }, 'Name');
    nameField.append(this.nameInput);
    const passField = el('label', { class: 'field' }, 'Password');
    passField.append(this.passInput);
    this.passField = passField;
    this.nameInput.value = defaultName || this.storedName();
    this.joinCard.append(this.serverLine, nameField, passField, this.joinBtn, this.status, this.keysHelp());
    this.joinBtn.addEventListener('click', () => this.submitJoin());
    for (const i of [this.nameInput, this.passInput]) {
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.submitJoin();
      });
    }

    // Panels reached with the cursor free (Esc): settings, time and weather, performance.
    this.buildSettings();
    this.buildEnv();
    this.buildPerf();
    this.buildToolbar();
    this.overlay.append(this.joinCard);

    // HUD.
    const crosshair = el('div', { class: 'crosshair' });
    this.prompt.hidden = true;
    const bar = el('div', { class: 'status-bar' });
    bar.append(this.clock, this.weather);
    this.chatInput.hidden = true;
    this.chat.append(this.chatLog, this.chatInput);
    this.players.hidden = true;
    this.flight.hidden = true;
    this.hud.append(crosshair, this.prompt, bar, this.online, this.players, this.chat, this.flight, this.toolbar, this.panels);
    document.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.togglePanel('perf');
      }
      // Esc with the cursor already free closes the panels.
      if (e.code === 'Escape' && this.cursorFree && !this.chatOpen) this.closePanels();
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

  private storedName() {
    try {
      return localStorage.getItem('ocean-home.name') ?? '';
    } catch {
      return '';
    }
  }

  private keysHelp() {
    const k = el('div', { class: 'keys' });
    const rows: Array<[string, string]> = [
      ['W A S D', 'Move'],
      ['Shift', 'Run'],
      ['Space', 'Jump'],
      ['E', 'Use: doors, elevator, drone'],
      ['T', 'Chat'],
      ['Tab', 'Who is here'],
      ['Esc', 'Free the cursor: settings, time & weather'],
      ['F3', 'Performance'],
    ];
    for (const [a, b] of rows) {
      const kk = el('span');
      for (const part of a.split(' ')) kk.append(el('kbd', {}, part), ' ');
      k.append(kk, el('span', {}, b));
    }
    return k;
  }

  private submitJoin() {
    if (this.connecting) return;
    if (this.server === 'offline') {
      this.handlers.onExploreOffline();
      return;
    }
    const name = this.nameInput.value.trim();
    if (!name) {
      this.setStatus('Pick a name first.');
      this.nameInput.focus();
      return;
    }
    try {
      localStorage.setItem('ocean-home.name', name);
    } catch {
      // storage unavailable
    }
    this.connecting = true;
    this.joinBtn.disabled = true;
    this.joinBtn.textContent = 'Connecting…';
    this.setStatus('');
    this.handlers.onJoin(name, this.passInput.value);
  }

  /** A join that did not get in. `serverOffline`: the server could not be reached at all. */
  joinFailed(message: string, serverOffline = false) {
    this.connecting = false;
    this.joinBtn.disabled = false;
    if (serverOffline) this.setServer({ online: false });
    else {
      this.joinBtn.textContent = 'Enter';
      this.setStatus(message);
    }
  }

  /** Whether the server is up, from the health check; the button and the password follow it. */
  setServer(s: { online: boolean; players?: number } | 'local') {
    this.server = s === 'local' ? 'local' : s.online ? 'online' : 'offline';
    this.serverLine.dataset.state = this.server;
    this.serverLine.hidden = this.server === 'local';
    if (this.server === 'online') {
      const n = typeof s === 'object' ? s.players : undefined;
      this.serverLine.textContent = n === undefined ? 'Server online' : `Server online · ${n === 0 ? 'nobody' : n} aboard`;
    } else if (this.server === 'offline') this.serverLine.textContent = 'Server offline';
    if (this.passField) this.passField.hidden = this.server === 'offline';
    if (this.connecting) return;
    this.joinBtn.textContent = this.server === 'offline' ? 'Explore offline' : 'Enter';
    if (this.server === 'offline') this.setStatus('Look around on your own for now. This switches back to Enter when the server returns.');
    else if (this.status.textContent?.startsWith('Look around')) this.setStatus('');
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }

  private field(label: string, input: HTMLElement, value?: HTMLElement) {
    const f = el('label', { class: 'field' });
    const head = el('span', { class: 'row spread' }, label);
    if (value) head.append(value);
    f.append(head, input);
    return f;
  }

  private panelHead(panel: HTMLElement, title: string, name: PanelName) {
    const head = el('header');
    const close = el('button', { type: 'button', class: 'icon', 'aria-label': `Close ${title}` }, '×');
    close.addEventListener('click', () => this.togglePanel(name, false));
    head.append(el('h2', {}, title), close);
    panel.append(head);
  }

  private buildSettings() {
    const c = this.settingsPanel;
    this.panelHead(c, 'Settings', 'settings');
    const s = this.settings;
    const q = el('select');
    for (const name of Object.keys(QUALITY)) {
      const o = el('option', { value: name }, name[0].toUpperCase() + name.slice(1));
      if (name === s.quality) o.selected = true;
      q.append(o);
    }
    const range = (min: string, max: string, step: string, value: number) => {
      const r = el('input', { type: 'range', min, max, step });
      r.value = String(value);
      return r;
    };
    const fov = range('55', '100', '1', s.fov);
    const sens = range('0.2', '3', '0.05', s.sensitivity);
    const vol = range('0', '1', '0.05', s.volume);
    const inv = el('input', { type: 'checkbox' });
    inv.checked = s.invertY;
    const invRow = el('label', { class: 'field' });
    const invLine = el('span', { class: 'row' });
    invLine.append(inv, el('span', {}, 'Invert look'));
    invRow.append(invLine);
    const auto = el('input', { type: 'checkbox' });
    auto.checked = s.autoResolution;
    const autoRow = el('label', { class: 'field' });
    const autoLine = el('span', { class: 'row' });
    autoLine.append(auto, el('span', {}, 'Lower the resolution to keep 60 fps'));
    autoRow.append(autoLine);
    const apply = () => {
      const quality = q.value as QualityName;
      const changed = quality !== this.settings.quality;
      this.settings = { quality, fov: Number(fov.value), sensitivity: Number(sens.value), volume: Number(vol.value), invertY: inv.checked, autoResolution: auto.checked };
      saveSettings(this.settings);
      this.handlers.onSettings(this.settings, changed);
    };
    for (const i of [q, fov, sens, vol, inv, auto]) i.addEventListener('change', apply);
    for (const i of [fov, sens, vol]) i.addEventListener('input', apply);
    c.append(this.field('Graphics quality', q), autoRow, this.field('Field of view', fov), this.field('Look sensitivity', sens), this.field('Volume', vol), invRow, this.keysHelp());
  }

  private buildEnv() {
    const c = this.envPanel;
    this.panelHead(c, 'Time & weather', 'env');
    this.hourInput.addEventListener('input', () => {
      this.dragging = true;
      this.hourLabel.textContent = hhmm(Number(this.hourInput.value));
    });
    this.hourInput.addEventListener('change', () => {
      this.dragging = false;
      this.handlers.onEnv({ hour: Number(this.hourInput.value) });
    });
    c.append(this.field('Time of day', this.hourInput, this.hourLabel));
    const speed = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Speed of the day' });
    for (const rate of CLOCK_RATES) {
      const b = el('button', { type: 'button' }, RATE_LABELS[rate] ?? `${rate}×`);
      b.addEventListener('click', () => this.handlers.onEnv({ rate }));
      this.rateButtons.set(rate, b);
      speed.append(b);
    }
    c.append(this.field('Speed of the day', speed));
    const weather = el('div', { class: 'segmented wrap', role: 'group', 'aria-label': 'Weather' });
    for (const kind of ['auto', ...WEATHER_KINDS]) {
      const b = el('button', { type: 'button' }, kind === 'auto' ? 'Forecast' : kind[0].toUpperCase() + kind.slice(1));
      b.addEventListener('click', () => this.handlers.onEnv({ weather: kind as WeatherMode }));
      this.weatherButtons.set(kind, b);
      weather.append(b);
    }
    c.append(this.field('Weather', weather), this.envNote);
  }

  /** Reflects the shared clock and weather in the panel. */
  setEnv(o: { hour: number; rate: number; weatherMode: WeatherMode; online: boolean; by?: string }) {
    if (!this.dragging) {
      this.hourInput.value = String(Math.round(o.hour * 4) / 4);
      this.hourLabel.textContent = hhmm(o.hour);
    }
    for (const [rate, b] of this.rateButtons) b.classList.toggle('on', Math.abs(rate - o.rate) < 1e-6);
    for (const [kind, b] of this.weatherButtons) b.classList.toggle('on', kind === o.weatherMode);
    const who = o.by ? ` Last changed by ${o.by}.` : '';
    this.envNote.textContent = o.online ? `Changes apply to everyone on board.${who}` : 'Offline: changes are only for you.';
  }

  private buildPerf() {
    const c = this.perfPanel;
    this.panelHead(c, 'Performance', 'perf');
    this.gpuToggle.addEventListener('click', () => this.handlers.onGpuTiming(!this.lastReport?.gpu.enabled));
    const copy = el('button', { type: 'button', class: 'secondary small' }, 'Copy report');
    copy.addEventListener('click', () => {
      if (!this.lastReport) return;
      void navigator.clipboard?.writeText(JSON.stringify(this.lastReport, null, 2)).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy report'), 1500);
      });
    });
    const actions = el('div', { class: 'row' });
    actions.append(this.gpuToggle, copy);
    c.append(this.perfGraph, this.perfStats, this.perfSections, actions);
  }

  get perfOpen() {
    return this.open.has('perf');
  }

  /** Draws the frame-time graph and the numbers. */
  setPerf(r: PerfReport, history: number[]) {
    this.lastReport = r;
    const g = this.perfGraph.getContext('2d');
    if (g) {
      const { width: w, height: h } = this.perfGraph;
      const max = 50;
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      for (const ms of [16.7, 33.3]) {
        const y = h - (ms / max) * h;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
      const n = history.length;
      for (let i = 0; i < n; i++) {
        const v = history[i];
        const bh = Math.min(h, (v / max) * h);
        g.fillStyle = v > 33.4 ? '#ff6b5a' : v > 17.5 ? '#f0b20a' : '#4fd38a';
        g.fillRect((i / Math.max(1, n)) * w, h - bh, Math.max(1, w / Math.max(1, n)), bh);
      }
    }
    const gpu = r.gpu.enabled ? (r.gpu.renderMs === null ? '…' : `${r.gpu.renderMs.toFixed(1)} ms render + ${(r.gpu.computeMs ?? 0).toFixed(1)} ms compute`) : 'off';
    const rows: Array<[string, string]> = [
      ['FPS', `${r.fps.toFixed(0)}`],
      ['Frame', `${r.frameMs.avg.toFixed(1)} ms · p95 ${r.frameMs.p95.toFixed(1)} · max ${r.frameMs.max.toFixed(0)}`],
      ['Long frames', `${r.longFrames} of the last ${Math.min(240, r.frames)}`],
      ['CPU (main loop)', `${r.cpuMs.toFixed(2)} ms`],
      ['GPU', gpu],
      ['Draw calls', `${r.renderer.drawCalls} · ${(r.renderer.triangles / 1e6).toFixed(2)} M tris`],
      ['Compute', `${r.renderer.computeCalls} dispatches`],
      ['Memory', `${r.renderer.geometries} geometries · ${r.renderer.textures} textures${r.heapMB === null ? '' : ` · ${r.heapMB.toFixed(0)} MB heap`}`],
      ['Canvas', `${r.canvas.width}×${r.canvas.height} @${r.canvas.pixelRatio} · ${r.quality}${r.resolutionScale < 1 ? ` · ${Math.round(r.resolutionScale * 100)}% res` : ''}`],
    ];
    this.perfStats.replaceChildren(...rows.flatMap(([k, v]) => [el('span', {}, k), el('b', {}, v)]));
    const top = r.sections.slice(0, 10);
    const total = Math.max(0.01, r.sections.reduce((a, b) => a + b.ms, 0));
    this.perfSections.replaceChildren(
      el('span', { class: 'th' }, 'CPU by system'),
      el('span', { class: 'th' }, 'ms / frame'),
      ...top.flatMap((x) => {
        const name = el('span', {}, x.name);
        const bar = el('b', {}, x.ms.toFixed(2));
        bar.style.setProperty('--w', `${Math.round((x.ms / total) * 100)}%`);
        return [name, bar];
      }),
    );
    this.gpuToggle.textContent = r.gpu.enabled ? 'Turn GPU timing off' : 'Turn GPU timing on';
  }

  private buildToolbar() {
    const t = this.toolbar;
    t.hidden = true;
    const button = (label: string, name: PanelName) => {
      const b = el('button', { type: 'button', class: 'secondary' }, label);
      b.addEventListener('click', () => this.togglePanel(name));
      return b;
    };
    const back = el('button', { type: 'button' }, 'Back to the world');
    back.addEventListener('click', () => this.handlers.onResume());
    t.append(button('Settings', 'settings'), button('Time & weather', 'env'), button('Performance', 'perf'), back, el('span', { class: 'hint' }, 'or click anywhere in the world'));
    this.panels.append(this.perfPanel, this.envPanel, this.settingsPanel);
    for (const p of [this.perfPanel, this.envPanel, this.settingsPanel]) p.hidden = true;
  }

  togglePanel(name: PanelName, show = !this.open.has(name)) {
    if (show) this.open.add(name);
    else this.open.delete(name);
    this.settingsPanel.hidden = !this.open.has('settings');
    this.envPanel.hidden = !this.open.has('env');
    this.perfPanel.hidden = !this.open.has('perf');
  }

  /** Closes the panels that need the cursor; the performance overlay stays until closed. */
  closePanels() {
    this.togglePanel('settings', false);
    this.togglePanel('env', false);
  }

  /** Esc frees the cursor: the world keeps running, the toolbar and panels become usable. */
  setCursorFree(free: boolean) {
    this.cursorFree = free && this.joined;
    this.toolbar.hidden = !this.cursorFree;
    this.hud.classList.toggle('cursor-free', this.cursorFree);
    if (!this.cursorFree) this.closePanels();
  }

  /** Instruments while flying or riding in the drone, or null to hide them. */
  setFlight(f: FlightHud | null) {
    this.flight.hidden = !f;
    if (!f) return;
    const kmh = Math.round(f.speed * 3.6);
    const climb = `${f.climb >= 0 ? '+' : ''}${f.climb.toFixed(1)}`;
    const heading = String(Math.round(((f.heading % 360) + 360) % 360)).padStart(3, '0');
    const gauges = el('div', { class: 'gauges' });
    const g = (label: string, value: string) => {
      const d = el('div');
      d.append(el('span', {}, label), el('b', {}, value));
      return d;
    };
    gauges.append(
      g('ALT', `${Math.round(f.altitude)} m`),
      g('AGL', f.ground === null ? '—' : `${f.ground.toFixed(1)} m`),
      g('SPD', `${kmh} km/h`),
      g('V/S', `${climb} m/s`),
      g('HDG', `${heading}°`),
    );
    const hint = f.pilot
      ? f.grounded
        ? 'Space lift off · E climb out'
        : 'W A S D fly · mouse steer · Space climb · Shift / C descend'
      : f.grounded
        ? 'E climb out'
        : 'Riding along · look around with the mouse';
    this.flight.replaceChildren(gauges, el('div', { class: 'hint' }, `${f.seats} · ${hint}`));
  }

  showJoin() {
    this.overlay.replaceChildren(this.joinCard);
    this.overlay.hidden = false;
    this.nameInput.focus();
  }

  hideOverlay() {
    this.overlay.hidden = true;
  }

  get overlayVisible() {
    return !this.overlay.hidden;
  }

  setPrompt(text: string | null) {
    this.prompt.hidden = !text;
    if (text) this.prompt.textContent = text;
  }

  setClock(localHour: number) {
    const h = Math.floor(localHour);
    const m = Math.floor((localHour - h) * 60);
    this.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  setWeather(w: WeatherState) {
    const kind = w.kind[0].toUpperCase() + w.kind.slice(1);
    const from = compass(w.windDirection + 180);
    this.weather.textContent = `${kind} · wind ${Math.round(w.windSpeed * 1.944)} kn from ${from} · seas ${w.waveHeight.toFixed(1)} m`;
  }

  setPlayers(list: PlayerInfo[], connected: boolean) {
    this.online.textContent = connected ? `${list.length} online` : 'Offline';
    const ul = el('ul');
    for (const p of list) {
      const li = el('li');
      const d = el('span', { class: 'dot' });
      d.style.background = p.color;
      li.append(d, el('span', {}, p.name));
      if (p.kind === 'agent') li.append(el('span', { class: 'badge' }, 'AI'));
      ul.append(li);
    }
    this.players.replaceChildren(el('strong', {}, 'On board'), ul);
  }

  togglePlayers(show: boolean) {
    this.players.hidden = !show;
  }

  addChat(entry: ChatEntry | { system: string }) {
    const line = el('div', { class: 'chat-line' });
    if ('system' in entry) {
      line.classList.add('system');
      line.textContent = entry.system;
    } else {
      line.append(el('b', {}, entry.name), entry.text);
    }
    this.chatLog.append(line);
    while (this.chatLog.childElementCount > 40) this.chatLog.firstElementChild?.remove();
    setTimeout(() => line.classList.add('fade'), 12000);
  }

  openChat() {
    this.chatOpen = true;
    this.chat.classList.add('open');
    this.chatInput.hidden = false;
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat() {
    this.chatOpen = false;
    this.chat.classList.remove('open');
    this.chatInput.hidden = true;
    this.chatInput.blur();
    this.handlers.onResume();
  }

  setFade(on: boolean) {
    this.fade.classList.toggle('on', on);
  }
}

function hhmm(hour: number) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
