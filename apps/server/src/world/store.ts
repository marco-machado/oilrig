import type { ChatEntry, ClockConfig, WeatherMode } from '@ocean-home/shared';

/** What the world keeps between restarts: the chat log, and what people changed. */
export interface WorldStore {
  addChat(e: ChatEntry): void;
  recentChat(limit: number): ChatEntry[];
  /** A clock someone set, saved together with the configured clock it was set from. */
  savedClock(): { clock: ClockConfig; base: string } | null;
  saveClock(clock: ClockConfig, base: string): void;
  savedWeatherMode(): WeatherMode | null;
  saveWeatherMode(mode: WeatherMode): void;
  doors(): Record<string, boolean>;
  saveDoor(id: string, open: boolean): void;
  /** When a person was last aboard or an agent last out, as of the last time the world stopped. */
  lastPresence(): number | null;
  saveLastPresence(t: number): void;
}

/** In-memory store, for tests. */
export class MemoryWorldStore implements WorldStore {
  private readonly chat: ChatEntry[] = [];
  private clock: { clock: ClockConfig; base: string } | null = null;
  private weather: WeatherMode | null = null;
  private readonly doorStates: Record<string, boolean> = {};
  private presence: number | null = null;

  addChat(e: ChatEntry) {
    this.chat.push(e);
  }

  recentChat(limit: number) {
    return this.chat.slice(-limit);
  }

  savedClock() {
    return this.clock;
  }

  saveClock(clock: ClockConfig, base: string) {
    this.clock = { clock, base };
  }

  savedWeatherMode() {
    return this.weather;
  }

  saveWeatherMode(mode: WeatherMode) {
    this.weather = mode;
  }

  doors() {
    return { ...this.doorStates };
  }

  saveDoor(id: string, open: boolean) {
    this.doorStates[id] = open;
  }

  lastPresence() {
    return this.presence;
  }

  saveLastPresence(t: number) {
    this.presence = t;
  }
}
