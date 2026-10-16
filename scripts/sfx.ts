// Generates the sound effects in apps/client/public/sfx with the ElevenLabs sound-effects
// API (eleven_text_to_sound_v2).
//
//   ELEVENLABS_API_KEY=… node scripts/sfx.ts            all of them
//   ELEVENLABS_API_KEY=… node scripts/sfx.ts steps-wood   only the named ones
//
// Footsteps are generated as a few seconds of walking or running per surface, then cut into
// single steps here: onsets are found on the energy envelope, weak or doubled steps are
// dropped, each step is trimmed, faded and loudness-matched, and the steps of one surface
// and gait are packed into a WAV "sprite" with their offsets in footsteps.json. Loops come
// back as PCM too (an MP3's encoder padding would put a gap in the loop); one-shots are MP3.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/client/public/sfx');
const RATE = 32000;
const API = 'https://api.elevenlabs.io/v1/sound-generation';

type Job =
  | { name: string; kind: 'steps'; text: string; seconds: number; gap: number }
  | { name: string; kind: 'loop'; text: string; seconds: number }
  | { name: string; kind: 'oneshot'; text: string; seconds: number };

const CLEAN = 'Isolated single footsteps with a short silence between each one, close-miked and dry, no music, no voices, no background ambience';
const surfaces: Array<[string, string]> = [
  ['grating', 'a steel bar-grating catwalk: each step is a short sharp metallic clank with a brief ring'],
  ['metal', 'a solid steel plate deck: each step is a dull firm metallic thud'],
  ['wood', 'an outdoor teak wooden deck: each step is a solid warm wooden knock'],
  ['stone', 'a polished concrete floor indoors: each step is a crisp clean shoe tap'],
  ['tile', 'wet ceramic pool-side tiles: each step is a crisp tap with a faint wet slap'],
  ['hollow', 'a hollow aluminium helicopter deck: each step is a short hollow metallic knock'],
  ['soft', 'a thick padded cushion: each step is a soft muffled thump'],
  ['water', 'knee-deep water in a swimming pool: each step is a wading splash'],
];

const JOBS: Job[] = [
  ...surfaces.flatMap(([id, where]): Job[] => [
    { name: `steps-${id}-walk`, kind: 'steps', seconds: 6, gap: 0.32, text: `Slow walking footsteps in rubber-soled shoes on ${where}. ${CLEAN}.` },
    { name: `steps-${id}-run`, kind: 'steps', seconds: 5, gap: 0.22, text: `Fast jogging footsteps in rubber-soled shoes on ${where}. ${CLEAN}.` },
  ]),
  {
    name: 'drone-loop',
    kind: 'loop',
    seconds: 8,
    text: 'A large electric passenger drone hovering close by: four big ducted propellers, a smooth powerful whirring electric hum with a soft rhythmic air pulse, no combustion engine, steady and continuous',
  },
  { name: 'elevator-loop', kind: 'loop', seconds: 6, text: 'A smooth quiet electric motor hum with a soft air rush, as heard inside a modern elevator car while it travels; perfectly steady drone, no clicks, no knocks, no chimes, no doors' },
  { name: 'elevator-chime', kind: 'oneshot', seconds: 1.6, text: 'A soft modern elevator arrival chime, a single gentle two-tone ding, clean' },
  { name: 'elevator-doors', kind: 'oneshot', seconds: 2, text: 'Automatic elevator glass doors sliding on their rail, a smooth short mechanical whoosh and a soft stop' },
  { name: 'door-slide', kind: 'oneshot', seconds: 1.8, text: 'A large sliding glass patio door rolling on its track, smooth rumble of rollers and a soft thud at the end' },
];

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  throw new Error('Set ELEVENLABS_API_KEY.');
}

async function generate(job: Job, format: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}?output_format=${format}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' },
      body: JSON.stringify({
        text: job.text,
        duration_seconds: job.seconds,
        prompt_influence: 0.55,
        loop: job.kind === 'loop',
        model_id: 'eleven_text_to_sound_v2',
      }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`${job.name}: HTTP ${res.status} ${body.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

function pcmToFloat(buf: Buffer): Float32Array {
  const out = new Float32Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/** The loop model answers in interleaved stereo PCM; the sample count against the requested
 * duration tells the channel count. Downmix to mono. */
function monoFrom(x: Float32Array, seconds: number): Float32Array {
  if (Math.round(x.length / (seconds * RATE)) < 2) return x;
  const out = new Float32Array(x.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (x[2 * i] + x[2 * i + 1]) / 2;
  return out;
}

function wav(samples: Float32Array, rate = RATE): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Second-order Butterworth high-pass (removes rumble and DC), in place. */
function highPass(x: Float32Array, hz: number) {
  const w = Math.tan((Math.PI * hz) / RATE);
  const k = 1 / (1 + Math.SQRT2 * w + w * w);
  const b0 = k;
  const a1 = 2 * (w * w - 1) * k;
  const a2 = (1 - Math.SQRT2 * w + w * w) * k;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * (v - 2 * x1 + x2) - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/** Energy envelope in 2 ms hops (RMS over 6 ms). */
function envelope(x: Float32Array) {
  const hop = Math.round(RATE * 0.002);
  const win = hop * 3;
  const env = new Float32Array(Math.floor(x.length / hop));
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    const a = i * hop;
    for (let k = 0; k < win && a + k < x.length; k++) s += x[a + k] * x[a + k];
    env[i] = Math.sqrt(s / win);
  }
  return { env, hop };
}

interface Cut {
  start: number;
  end: number;
  peak: number;
}

/** Splits a take of footsteps into single steps. */
function cutSteps(x: Float32Array, minGap: number): { cuts: Cut[]; found: number; clarity: number } {
  highPass(x, 70);
  const { env, hop } = envelope(x);
  const max = env.reduce((a, b) => Math.max(a, b), 0);
  const gapHops = Math.round(minGap / 0.002);
  // Onsets: the envelope jumps above a fraction of the loudest step after being quiet.
  const peaks: number[] = [];
  for (let i = 3; i < env.length - 3; i++) {
    if (env[i] < 0.18 * max) continue;
    let isMax = true;
    for (let k = -20; k <= 20 && isMax; k++) if (k && env[i + k] > env[i]) isMax = false;
    if (!isMax) continue;
    if (peaks.length && i - peaks[peaks.length - 1] < gapHops) {
      if (env[i] > env[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  const cuts: Cut[] = [];
  peaks.forEach((p, n) => {
    const pk = env[p];
    let a = p;
    while (a > 0 && p - a < 40 && env[a - 1] > pk * 0.06) a--;
    const limit = n + 1 < peaks.length ? peaks[n + 1] - 15 : env.length - 1;
    let b = p;
    let quiet = 0;
    while (b < limit && b - a < 260) {
      b++;
      quiet = env[b] < pk * 0.035 ? quiet + 1 : 0;
      if (quiet > 12) break;
    }
    // A second strong hit inside the cut means two steps ran together.
    let second = false;
    for (let k = p + 40; k < b; k++) if (env[k] > pk * 0.75) second = true;
    if (!second && b - a > 30) cuts.push({ start: Math.max(0, a * hop - Math.round(RATE * 0.004)), end: Math.min(x.length, b * hop), peak: pk });
  });
  // Clarity: how far the steps stand out above the floor between them (a take that is one
  // continuous rattle scores ~2, clean separate steps score well above 10).
  const floor = [...env].sort((a, b) => a - b)[Math.floor(env.length * 0.5)];
  const peakLevels = peaks.map((p) => env[p]).sort((a, b) => a - b);
  const clarity = peakLevels.length ? peakLevels[peakLevels.length >> 1] / Math.max(floor, 1e-6) : 0;
  if (cuts.length === 0) return { cuts, found: peaks.length, clarity };
  // Keep the steps closest to the typical loudness (drop scuffs and the odd stomp).
  const sorted = [...cuts].sort((a, b) => a.peak - b.peak);
  const median = sorted[sorted.length >> 1].peak;
  const kept = cuts.filter((c) => c.peak > median * 0.45 && c.peak < median * 2.2);
  kept.sort((a, b) => Math.abs(Math.log(a.peak / median)) - Math.abs(Math.log(b.peak / median)));
  return { cuts: kept.slice(0, 6).sort((a, b) => a.start - b.start), found: peaks.length, clarity };
}

function finish(x: Float32Array, c: Cut): Float32Array {
  const s = x.slice(c.start, c.end);
  const fadeIn = Math.min(s.length, Math.round(RATE * 0.002));
  const fadeOut = Math.min(s.length, Math.round(RATE * 0.04));
  for (let i = 0; i < fadeIn; i++) s[i] *= i / fadeIn;
  for (let i = 0; i < fadeOut; i++) s[s.length - 1 - i] *= i / fadeOut;
  // Loudness match on the attack (first 120 ms), peak kept below full scale.
  let e = 0;
  const n = Math.min(s.length, Math.round(RATE * 0.12));
  for (let i = 0; i < n; i++) e += s[i] * s[i];
  const rms = Math.sqrt(e / n);
  let peak = 0;
  for (const v of s) peak = Math.max(peak, Math.abs(v));
  const g = Math.min(0.16 / Math.max(rms, 1e-5), 0.95 / Math.max(peak, 1e-5));
  for (let i = 0; i < s.length; i++) s[i] *= g;
  return s;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const wanted = process.argv.slice(2);
  const jobs = wanted.length ? JOBS.filter((j) => wanted.some((w) => j.name.startsWith(w))) : JOBS;
  const manifestPath = path.join(OUT, 'footsteps.json');
  let manifest: Record<string, Array<[number, number]>> = {};
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    // first run
  }
  // A few at a time keeps within the API's concurrency limits.
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (job.kind === 'oneshot') {
        writeFileSync(path.join(OUT, `${job.name}.mp3`), await generate(job, 'mp3_44100_128'));
        console.log(`${job.name}.mp3`);
        continue;
      }
      if (job.kind === 'loop') {
        const x = monoFrom(pcmToFloat(await generate(job, `pcm_${RATE}`)), job.seconds);
        writeFileSync(path.join(OUT, `${job.name}.wav`), wav(x));
        console.log(`${job.name}.wav  ${(x.length / RATE).toFixed(2)} s`);
        continue;
      }
      // Footsteps: up to three takes, keeping the one whose steps stand out best.
      let best: { x: Float32Array; cuts: Cut[]; found: number; clarity: number } | null = null;
      for (let take = 0; take < 3; take++) {
        const x = monoFrom(pcmToFloat(await generate(job, `pcm_${RATE}`)), job.seconds);
        const r = { x, ...cutSteps(x, job.gap) };
        const score = (q: typeof r) => q.clarity * Math.min(1, q.cuts.length / 5);
        if (!best || score(r) > score(best)) best = r;
        if (best.clarity > 12 && best.cuts.length >= 5) break;
      }
      const { x, cuts, found, clarity } = best!;
      const pad = Math.round(RATE * 0.03);
      const parts: Float32Array[] = [];
      const offsets: Array<[number, number]> = [];
      let at = 0;
      for (const c of cuts) {
        const s = finish(x, c);
        offsets.push([+(at / RATE).toFixed(4), +(s.length / RATE).toFixed(4)]);
        parts.push(s, new Float32Array(pad));
        at += s.length + pad;
      }
      const sprite = new Float32Array(at);
      let o = 0;
      for (const p of parts) {
        sprite.set(p, o);
        o += p.length;
      }
      const key = job.name.replace(/^steps-/, '');
      manifest[key] = offsets;
      writeFileSync(path.join(OUT, `${job.name}.wav`), wav(sprite));
      console.log(`${job.name}: clarity ${clarity.toFixed(1)}, ${found} onsets, kept ${cuts.length}: ${offsets.map(([, d]) => `${Math.round(d * 1000)}ms`).join(' ')}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
