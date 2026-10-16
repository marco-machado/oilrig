import { DIMS, type HeliPose, type Surface } from '@ocean-home/shared';

interface RotorVoice {
  bus: GainNode;
  air: BiquadFilterNode;
  panner: PannerNode;
  slap: OscillatorNode;
  slapLevel: GainNode;
  chop: OscillatorNode;
  noise: AudioBufferSourceNode;
  whine: OscillatorNode[];
  whineLevel: GainNode;
  tail: OscillatorNode;
  tailLevel: GainNode;
}

const SPEED_OF_SOUND = 343;

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
  private rotor: RotorVoice | null = null;
  private readonly listenerPos = [0, 0, 0];

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

  /** Narrow pulses: one blade passing per period. */
  private pulseWave(ctx: AudioContext, sharpness: number) {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) real[k] = Math.exp(-((k / sharpness) ** 2));
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  private buildRotor(ctx: AudioContext): RotorVoice {
    const bus = ctx.createGain();
    bus.gain.value = 0;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 12000;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 18;
    panner.rolloffFactor = 1.1;
    panner.maxDistance = 20000;
    bus.connect(air).connect(panner).connect(this.ambience);

    // Blade slap: a pulse train at the blade-passing frequency, low-passed into a "whop".
    const pulses = this.pulseWave(ctx, 9);
    const slap = ctx.createOscillator();
    slap.setPeriodicWave(pulses);
    const slapTone = ctx.createBiquadFilter();
    slapTone.type = 'lowpass';
    slapTone.frequency.value = 900;
    const slapLevel = ctx.createGain();
    slapLevel.gain.value = 0;
    slap.connect(slapTone).connect(slapLevel).connect(bus);
    // Air chop: band-passed noise amplitude-modulated by the same pulses.
    const noise = this.loop(this.white);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 650;
    band.Q.value = 0.7;
    const chopGain = ctx.createGain();
    chopGain.gain.value = 0;
    const chop = ctx.createOscillator();
    chop.setPeriodicWave(this.pulseWave(ctx, 6));
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    chop.connect(depth).connect(chopGain.gain);
    noise.connect(band).connect(chopGain).connect(slapLevel);
    // Turbine whine.
    const whineLevel = ctx.createGain();
    whineLevel.gain.value = 0;
    const whine = [2850, 5700, 8100].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.2, 0.08][i];
      o.connect(g).connect(whineLevel);
      o.start();
      return o;
    });
    whineLevel.connect(bus);
    // Tail rotor buzz.
    const tail = ctx.createOscillator();
    tail.type = 'sawtooth';
    const tailBand = ctx.createBiquadFilter();
    tailBand.type = 'bandpass';
    tailBand.frequency.value = 220;
    tailBand.Q.value = 1.2;
    const tailLevel = ctx.createGain();
    tailLevel.gain.value = 0;
    tail.connect(tailBand).connect(tailLevel).connect(bus);
    slap.start();
    chop.start();
    tail.start();
    return { bus, air, panner, slap, slapLevel, chop, noise, whine, whineLevel, tail, tailLevel };
  }

  /** Synthesized helicopter: blade slap, turbine and tail rotor, placed in 3D with Doppler. */
  helicopter(pose: HeliPose | null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!pose || !pose.visible) {
      if (this.rotor) this.rotor.bus.gain.setTargetAtTime(0, t, 0.3);
      return;
    }
    this.rotor ??= this.buildRotor(ctx);
    const r = this.rotor;
    const [x, y, z] = pose.position;
    const lx = x - this.listenerPos[0];
    const ly = y + 2 - this.listenerPos[1];
    const lz = z - this.listenerPos[2];
    const dist = Math.max(1, Math.hypot(lx, ly, lz));
    // Doppler from the speed along the line of sight (positive = receding).
    const vr = (pose.velocity[0] * lx + pose.velocity[1] * ly + pose.velocity[2] * lz) / dist;
    const doppler = SPEED_OF_SOUND / (SPEED_OF_SOUND + Math.max(-150, Math.min(150, vr)));
    const rpm = pose.rotor;
    const bpf = DIMS.HELI.blades * DIMS.HELI.rotorHz * Math.max(rpm, 0.02) * doppler;
    r.slap.frequency.setTargetAtTime(bpf, t, 0.05);
    r.chop.frequency.setTargetAtTime(bpf, t, 0.05);
    r.noise.playbackRate.setTargetAtTime(doppler, t, 0.05);
    r.tail.frequency.setTargetAtTime(DIMS.HELI.tailRotorHz * 2 * Math.max(rpm, 0.02) * doppler, t, 0.05);
    r.whine.forEach((o, i) => o.frequency.setTargetAtTime([2850, 5700, 8100][i] * (0.55 + 0.45 * rpm) * doppler, t, 0.1));
    const running = rpm > 0.01 ? 1 : 0;
    r.slapLevel.gain.setTargetAtTime(0.9 * rpm * rpm, t, 0.1);
    r.tailLevel.gain.setTargetAtTime(0.12 * rpm, t, 0.1);
    r.whineLevel.gain.setTargetAtTime(0.035 * running * (0.4 + 0.6 * rpm), t, 0.3);
    r.bus.gain.setTargetAtTime(running ? 1 : 0, t, 0.5);
    // Air absorbs the highs over distance.
    r.air.frequency.setTargetAtTime(Math.max(350, 14000 * Math.exp(-dist / 450)), t, 0.1);
    if (r.panner.positionX) {
      r.panner.positionX.setTargetAtTime(x, t, 0.03);
      r.panner.positionY.setTargetAtTime(y + 2, t, 0.03);
      r.panner.positionZ.setTargetAtTime(z, t, 0.03);
    } else {
      r.panner.setPosition(x, y + 2, z);
    }
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
      case 'soft':
        f.type = 'lowpass';
        f.frequency.value = 320;
        dur = 0.14;
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
