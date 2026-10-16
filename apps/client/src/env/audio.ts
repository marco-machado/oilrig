import type { Surface } from '@ocean-home/shared';

/** Fully synthesized ambience and foley (WebAudio): no sample files. */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambience!: BiquadFilterNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private surfGain!: GainNode;
  private surfFilter!: BiquadFilterNode;
  private washGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private volume = 0.8;
  private windWander = 0;
  private washPhase = 0;

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // Outdoor ambience bus, muffled when indoors.
    this.ambience = ctx.createBiquadFilter();
    this.ambience.type = 'lowpass';
    this.ambience.frequency.value = 18000;
    this.ambience.connect(this.master);

    this.white = this.noise(ctx, 'white');
    this.brown = this.noise(ctx, 'brown');

    // Surf: brown noise, low-passed, swelling with a slow wave rhythm.
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = 'lowpass';
    this.surfFilter.frequency.value = 500;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    this.loop(this.brown).connect(this.surfFilter).connect(this.surfGain).connect(this.ambience);
    // Wash: band-passed white noise for water slapping the legs.
    const washBand = ctx.createBiquadFilter();
    washBand.type = 'bandpass';
    washBand.frequency.value = 1300;
    washBand.Q.value = 0.7;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    this.loop(this.white).connect(washBand).connect(this.washGain).connect(this.ambience);
    // Wind.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 1.4;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loop(this.white).connect(this.windFilter).connect(this.windGain).connect(this.ambience);
    // Rain (its own filter so indoors can sound like rain on the roof).
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'highpass';
    this.rainFilter.frequency.value = 2200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.loop(this.white).connect(this.rainFilter).connect(this.rainGain).connect(this.master);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  private noise(ctx: AudioContext, kind: 'white' | 'brown') {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  private loop(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random() * 2;
    s.start(0, Math.random() * 3);
    return s;
  }

  /** Per-frame ambience update. */
  update(dt: number, o: { heightAboveSea: number; windSpeed: number; waveHeight: number; rain: number; indoors: boolean }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const near = Math.max(0, Math.min(1, 1 - (o.heightAboveSea - 2) / 22));
    this.washPhase += dt * (0.12 + o.waveHeight * 0.05);
    const swell = 0.6 + 0.4 * Math.sin(this.washPhase * Math.PI * 2) * Math.sin(this.washPhase * 1.7 + 1);
    const sea = Math.min(1, 0.25 + o.waveHeight * 0.35);
    this.surfGain.gain.setTargetAtTime(sea * swell * (0.25 + 0.55 * near), t, 0.3);
    this.surfFilter.frequency.setTargetAtTime(280 + 900 * near + 300 * sea, t, 0.5);
    const slap = Math.max(0, Math.sin(this.washPhase * Math.PI * 2 * 1.3)) ** 6;
    this.washGain.gain.setTargetAtTime(near * sea * slap * 0.35, t, 0.08);

    this.windWander += (Math.random() - 0.5) * dt * 3;
    this.windWander *= 0.995;
    const ws = o.windSpeed;
    const exposure = 0.55 + 0.45 * (1 - near);
    this.windGain.gain.setTargetAtTime(Math.min(0.5, (ws / 18) ** 2 * 0.6) * exposure, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(380 + ws * 25 + this.windWander * 120, t, 0.6);

    this.rainGain.gain.setTargetAtTime(o.rain * (o.indoors ? 0.35 : 0.22), t, 0.5);
    this.rainFilter.type = o.indoors ? 'lowpass' : 'highpass';
    this.rainFilter.frequency.setTargetAtTime(o.indoors ? 900 : 2200, t, 0.3);
    this.ambience.frequency.setTargetAtTime(o.indoors ? 700 : 18000, t, 0.25);
  }

  thunder(delaySeconds: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delaySeconds;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900 / (1 + delaySeconds * 0.4), t0);
    f.frequency.exponentialRampToValueAtTime(90, t0 + 3.5);
    const g = ctx.createGain();
    const peak = 1.2 / (1 + delaySeconds * 0.35);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.08 + delaySeconds * 0.05);
    g.gain.exponentialRampToValueAtTime(peak * 0.5, t0 + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + 5.2);
  }

  footstep(surface: Surface | undefined, run: boolean, strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = (run ? 0.55 : 0.4) * strength * (0.85 + Math.random() * 0.3);
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    let dur = 0.09;
    let ring: { freq: number; decay: number; level: number } | null = null;
    switch (surface) {
      case 'wood':
        f.type = 'lowpass';
        f.frequency.value = 700;
        dur = 0.12;
        ring = { freq: 140 + Math.random() * 30, decay: 0.08, level: 0.5 };
        break;
      case 'grating':
        f.type = 'bandpass';
        f.frequency.value = 2600;
        f.Q.value = 2;
        ring = { freq: 1400 + Math.random() * 600, decay: 0.12, level: 0.12 };
        break;
      case 'metal':
        f.type = 'bandpass';
        f.frequency.value = 1800;
        f.Q.value = 3;
        ring = { freq: 900 + Math.random() * 300, decay: 0.15, level: 0.15 };
        break;
      case 'hollow':
        f.type = 'bandpass';
        f.frequency.value = 600;
        f.Q.value = 4;
        ring = { freq: 220 + Math.random() * 40, decay: 0.2, level: 0.35 };
        break;
      case 'tile':
        f.type = 'highpass';
        f.frequency.value = 900;
        dur = 0.07;
        break;
      default:
        f.type = 'bandpass';
        f.frequency.value = 1500;
        f.Q.value = 0.8;
        dur = 0.06;
    }
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.02);
    if (ring) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = ring.freq;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(v * ring.level, t);
      rg.gain.exponentialRampToValueAtTime(0.0005, t + ring.decay);
      o.connect(rg).connect(this.master);
      o.start(t);
      o.stop(t + ring.decay + 0.02);
    }
  }
}
