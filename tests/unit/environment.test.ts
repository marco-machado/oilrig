import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EPOCH,
  type ServerMessage,
  WEATHER_CHANGE_MS,
  WeatherControl,
  WeatherModel,
  adjustClock,
  celestialAt,
  gameTime,
  makeClock,
} from '@ocean-home/shared';
import { makeWorld, who } from './helpers.ts';

// People can set the time of day, the speed of the day and the weather. These tests check
// that the sky lands where asked and keeps moving at the chosen pace, and that weather
// changes ease in rather than snap, for everyone at once.

const hourAt = (clock: ReturnType<typeof makeClock>, real: number) => celestialAt(gameTime(clock, real)).localHour;

describe('clock control', () => {
  it('jumps to the asked local hour on the same day, then runs at the chosen speed', () => {
    const c0 = makeClock({ realTime: false, dayLengthMinutes: 120 });
    const now = DEFAULT_EPOCH + 5 * 3600_000;
    const day0 = Math.floor(gameTime(c0, now) / 86_400_000);
    for (const hour of [0.5, 6.25, 12, 18.75, 23.5]) {
      const c = adjustClock(c0, now, { hour });
      expect(hourAt(c, now)).toBeCloseTo(hour, 5);
      expect(Math.abs(Math.floor(gameTime(c, now) / 86_400_000) - day0)).toBeLessThanOrEqual(1);
    }
    const realTime = adjustClock(c0, now, { hour: 9, rate: 1 });
    expect(hourAt(realTime, now + 3600_000)).toBeCloseTo(10, 5); // an hour later, an hour later
    const paused = adjustClock(c0, now, { hour: 17, rate: 0 });
    expect(hourAt(paused, now + 10 * 3600_000)).toBeCloseTo(17, 5); // the sun stays put
  });
});

describe('weather control', () => {
  it('a chosen weather eases in over a little while, holds, and "auto" eases back to the forecast', () => {
    const model = new WeatherModel(9, DEFAULT_EPOCH);
    const ctl = new WeatherControl(model);
    const g = DEFAULT_EPOCH + 40 * 3600_000;
    const real = 1_000_000;
    const before = ctl.sample(g, real);
    ctl.set('storm', g, real);
    const steps: number[] = [];
    let prevRain = before.rain;
    for (let t = real; t <= real + WEATHER_CHANGE_MS + 2000; t += 500) {
      const w = ctl.sample(g, t);
      steps.push(Math.abs(w.rain - prevRain));
      prevRain = w.rain;
    }
    expect(Math.max(...steps)).toBeLessThan(0.1); // no jumps
    const settled = ctl.sample(g, real + WEATHER_CHANGE_MS + 1);
    expect(settled.kind).toBe('storm');
    expect(settled.rain).toBe(1);
    expect(settled.windSpeed).toBeGreaterThan(12);
    expect(settled.waveHeight).toBeGreaterThan(before.waveHeight);
    ctl.set('auto', g, real + 60_000);
    expect(ctl.sample(g, real + 60_000 + 100).rain).toBeGreaterThan(0.9);
    expect(ctl.sample(g, real + 60_000 + WEATHER_CHANGE_MS + 1)).toEqual(model.sample(g));
  });

  it('a person changes the time and the weather for everyone; perception follows', async () => {
    const world = await makeWorld();
    const inbox = (name: string) => {
      const got: ServerMessage[] = [];
      const conn = { send: (m: ServerMessage) => got.push(m), sendRaw: (j: string) => got.push(JSON.parse(j)), close: () => undefined };
      return { got, conn, player: world.join(conn, who(name)) };
    };
    const a = inbox('Host');
    const b = inbox('Guest');
    const now = Date.now();
    world.handle(a.conn, a.player, { type: 'setenv', hour: 21, rate: 0, weather: 'fog' });
    const ctl = b.got.find((m) => m.type === 'envctl');
    expect(ctl).toMatchObject({ type: 'envctl', weatherMode: 'fog', by: 'Host' });
    expect(hourAt((ctl as Extract<ServerMessage, { type: 'envctl' }>).clock, now)).toBeCloseTo(21, 1);
    const { timeReport, weatherReport } = await import('../../apps/server/src/agents/perception.ts');
    expect(timeReport(world, now + 60_000).daylight).toBe('night');
    expect(weatherReport(world, Date.now() + WEATHER_CHANGE_MS + 1000).kind).toBe('fog');
    world.stop();
  });
});
