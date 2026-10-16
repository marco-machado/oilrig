import type { ChatEntry, PlayerInfo, WeatherState } from '@ocean-home/shared';
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
}

const SETTINGS_KEY = 'ocean-home.settings';

export function loadSettings(defaultQuality: QualityName): Settings {
  const base: Settings = { quality: defaultQuality, fov: 72, sensitivity: 1, invertY: false, volume: 0.8 };
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

export interface UIHandlers {
  onJoin(name: string, password: string): void;
  onResume(): void;
  onChat(text: string): void;
  onSettings(s: Settings, qualityChanged: boolean): void;
}

/** DOM overlay: join card, pause/settings card, HUD, chat and player list. */
export class UI {
  readonly root = el('div');
  private readonly overlay = el('div', { class: 'overlay' });
  private readonly joinCard = el('div', { class: 'card' });
  private readonly pauseCard = el('div', { class: 'card' });
  private readonly status = el('div', { class: 'status' });
  private readonly nameInput = el('input', { type: 'text', maxlength: '24', autocomplete: 'nickname', placeholder: 'Your name' });
  private readonly passInput = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Only if the host set one' });
  private readonly joinBtn = el('button', { type: 'button' }, 'Enter');
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
    this.nameInput.value = defaultName || this.storedName();
    this.joinCard.append(nameField, passField, this.joinBtn, this.status, this.keysHelp());
    this.joinBtn.addEventListener('click', () => this.submitJoin());
    for (const i of [this.nameInput, this.passInput]) {
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.submitJoin();
      });
    }

    // Pause / settings card.
    this.buildPauseCard();
    this.overlay.append(this.joinCard);

    // HUD.
    const crosshair = el('div', { class: 'crosshair' });
    this.prompt.hidden = true;
    const bar = el('div', { class: 'status-bar' });
    bar.append(this.clock, this.weather);
    this.chatInput.hidden = true;
    this.chat.append(this.chatLog, this.chatInput);
    this.players.hidden = true;
    this.hud.append(crosshair, this.prompt, bar, this.online, this.players, this.chat);
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
      ['E', 'Open / close door'],
      ['T', 'Chat'],
      ['Tab', 'Who is here'],
      ['Esc', 'Menu'],
    ];
    for (const [a, b] of rows) {
      const kk = el('span');
      for (const part of a.split(' ')) kk.append(el('kbd', {}, part), ' ');
      k.append(kk, el('span', {}, b));
    }
    return k;
  }

  private submitJoin() {
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
    this.joinBtn.disabled = true;
    this.setStatus('Connecting…');
    this.handlers.onJoin(name, this.passInput.value);
  }

  joinFailed(message: string) {
    this.joinBtn.disabled = false;
    this.setStatus(message);
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }

  private buildPauseCard() {
    const c = this.pauseCard;
    c.append(el('h1', {}, 'Paused'), el('p', {}, 'Click Resume or the world to look around again.'));
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
    const field = (label: string, input: HTMLElement) => {
      const f = el('label', { class: 'field' }, label);
      f.append(input);
      return f;
    };
    const invRow = el('label', { class: 'field' });
    const invLine = el('span', { class: 'row' });
    invLine.append(inv, el('span', {}, 'Invert look'));
    invRow.append(invLine);
    const apply = () => {
      const quality = q.value as QualityName;
      const changed = quality !== this.settings.quality;
      this.settings = { quality, fov: Number(fov.value), sensitivity: Number(sens.value), volume: Number(vol.value), invertY: inv.checked };
      saveSettings(this.settings);
      this.handlers.onSettings(this.settings, changed);
    };
    for (const i of [q, fov, sens, vol, inv]) i.addEventListener('change', apply);
    for (const i of [fov, sens, vol]) i.addEventListener('input', apply);
    const resume = el('button', { type: 'button' }, 'Resume');
    resume.addEventListener('click', () => this.handlers.onResume());
    c.append(field('Graphics quality', q), field('Field of view', fov), field('Look sensitivity', sens), field('Volume', vol), invRow, resume, this.keysHelp());
  }

  showJoin() {
    this.overlay.replaceChildren(this.joinCard);
    this.overlay.hidden = false;
    this.nameInput.focus();
  }

  showPause() {
    if (!this.joined) return;
    this.overlay.replaceChildren(this.pauseCard);
    this.overlay.hidden = false;
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
