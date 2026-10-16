import type { DronePose, Surface, Vec3 } from '@ocean-home/shared';

/** Where a looping sample plays from: its source, level, filter and 3D panner. */
interface LoopVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
}

const SPEED_OF_SOUND = 343;
const SFX = '/sfx/';

/** Footstep sets per surface; water is the pool. */
type StepSurface = Surface | 'water';

/**
 * Ambience (sea, wind, rain, thunder) is synthesized with WebAudio. Footsteps, the drone,
 * the elevator and the doors are sound effects generated with ElevenLabs (scripts/sfx.ts):
 * footsteps come as one sprite per surface and gait, cut into single steps that are played
 * in a shuffled order with small pitch and level changes so no two in a row sound alike.
 */
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
  private readonly listenerPos = [0, 0, 0];
  private readonly buffers = new Map<string, AudioBuffer>();
  private steps: Record<string, Array<[number, number]>> = {};
  private readonly lastStep = new Map<string, number>();
  private drone: LoopVoice | null = null;
  private lift: LoopVoice | null = null;
  /** Inside the drone cabin: its own hum is close and muffled, the outside is quieter. */
  private seated = false;
  private loaded: Promise<void> | null = null;

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
    this.loaded = this.loadSamples();
  }

  private async fetchBuffer(name: string) {
    const res = await fetch(SFX + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
    this.buffers.set(name, buf);
    return buf;
  }

  private async loadSamples() {
    try {
      const res = await fetch(`${SFX}footsteps.json`);
      this.steps = await res.json();
      // The loops and the surfaces underfoot most often first; the rest follow.
      const first = ['drone-loop.wav', 'elevator-loop.wav', 'steps-wood-walk.wav', 'steps-wood-run.wav', 'steps-grating-walk.wav', 'steps-grating-run.wav', 'steps-stone-walk.wav', 'steps-stone-run.wav'];
      await Promise.all(first.map((n) => this.fetchBuffer(n)));
      const rest = Object.keys(this.steps)
        .map((k) => `steps-${k}.wav`)
        .filter((n) => !first.includes(n))
        .concat(['elevator-chime.mp3', 'elevator-doors.mp3', 'door-slide.mp3']);
      await Promise.all(rest.map((n) => this.fetchBuffer(n)));
    } catch (e) {
      console.warn('Sound effects did not load:', e);
    }
  }

  /** Resolves once the sample files are decoded (or failed to load). */
  ready() {
    return this.loaded ?? Promise.resolve();
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

  /** Places the listener at the camera. */
  setListener(p: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }) {
    const ctx = this.ctx;
    this.listenerPos[0] = p.x;
    this.listenerPos[1] = p.y;
    this.listenerPos[2] = p.z;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  private panner(refDistance: number, rolloff = 1) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = 20000;
    return p;
  }

  private place(p: PannerNode, x: number, y: number, z: number, smooth = 0.03) {
    const t = this.ctx!.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, t, smooth);
      p.positionY.setTargetAtTime(y, t, smooth);
      p.positionZ.setTargetAtTime(z, t, smooth);
    } else {
      p.setPosition(x, y, z);
    }
  }

  private loopVoice(name: string, refDistance: number, bus: AudioNode): LoopVoice | null {
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 16000;
    const panner = this.panner(refDistance);
    src.connect(filter).connect(gain).connect(panner).connect(bus);
    src.start(0, Math.random() * buf.duration);
    return { src, gain, filter, panner };
  }

  /** The listener sits in the drone (changes how loud and muffled things sound). */
  setSeated(seated: boolean) {
    this.seated = seated;
  }

  /** The drone: four ducted rotors, pitched by rotor speed, placed in 3D with Doppler. */
  setDrone(pose: DronePose | null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!pose || !pose.visible || pose.rotor < 0.01) {
      this.drone?.gain.gain.setTargetAtTime(0, t, 0.4);
      return;
    }
    this.drone ??= this.loopVoice('drone-loop.wav', 14, this.master);
    const v = this.drone;
    if (!v) return;
    const [x, y, z] = pose.position;
    const lx = x - this.listenerPos[0];
    const ly = y + 1.5 - this.listenerPos[1];
    const lz = z - this.listenerPos[2];
    const dist = Math.max(1, Math.hypot(lx, ly, lz));
    // Doppler from the speed along the line of sight (positive = receding).
    const vr = this.seated ? 0 : (pose.velocity[0] * lx + pose.velocity[1] * ly + pose.velocity[2] * lz) / dist;
    const doppler = SPEED_OF_SOUND / (SPEED_OF_SOUND + Math.max(-150, Math.min(150, vr)));
    const rpm = Math.max(0, pose.rotor);
    v.src.playbackRate.setTargetAtTime(Math.max(0.3, (0.55 + 0.5 * rpm) * doppler), t, 0.08);
    v.gain.gain.setTargetAtTime(Math.min(1.2, rpm * rpm * 1.1) * (this.seated ? 0.55 : 1), t, 0.15);
    // Air absorbs the highs over distance; the cabin muffles them for whoever sits inside.
    v.filter.frequency.setTargetAtTime(this.seated ? 1800 : Math.max(500, 15000 * Math.exp(-dist / 380)), t, 0.1);
    this.place(v.panner, x, y + 1.5, z);
  }

  /** The elevator car: motor hum while it travels. */
  setElevator(carCenter: Vec3, moving: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.lift ??= this.loopVoice('elevator-loop.wav', 3, this.master);
    const v = this.lift;
    if (!v) return;
    v.gain.gain.setTargetAtTime(moving ? 0.55 : 0, ctx.currentTime, moving ? 0.4 : 0.25);
    this.place(v.panner, carCenter[0], carCenter[1], carCenter[2]);
  }

  /** A one-shot sample at a point in the world. */
  playAt(name: 'elevator-chime.mp3' | 'elevator-doors.mp3' | 'door-slide.mp3', at: Vec3, level = 1, refDistance = 4) {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = ctx.createGain();
    g.gain.value = level;
    const p = this.panner(refDistance, 1.2);
    this.place(p, at[0], at[1], at[2], 0.001);
    src.connect(g).connect(p).connect(this.master);
    src.start();
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

  /** One footstep of the local player: a random step from the surface's set, never the same one twice running. */
  footstep(surface: StepSurface | undefined, run: boolean, strength = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const key = `${surface ?? 'stone'}-${run ? 'run' : 'walk'}`;
    const slices = this.steps[key];
    const buf = this.buffers.get(`steps-${key}.wav`);
    if (!slices?.length || !buf) return;
    let i = Math.floor(Math.random() * slices.length);
    if (slices.length > 1 && i === this.lastStep.get(key)) i = (i + 1 + Math.floor(Math.random() * (slices.length - 1))) % slices.length;
    this.lastStep.set(key, i);
    const [offset, duration] = slices[i];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = ctx.createGain();
    const level = (run ? 0.62 : 0.5) * strength * (0.82 + Math.random() * 0.3);
    g.gain.value = Math.min(1.4, level);
    src.connect(g).connect(this.master);
    src.start(ctx.currentTime, offset, duration);
  }
}
