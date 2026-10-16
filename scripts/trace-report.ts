// Summarises a Chromium trace (from `pnpm trace`, or saved from the DevTools Performance panel):
// every long task on the page's main thread, what it spent its time on (self time per event,
// e.g. Compile Shader, MajorGC, a JS function), and what the GPU process was busy with meanwhile.
// Usage: node scripts/trace-report.ts <trace.json> [minMs=50]
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

interface Ev {
  name: string;
  cat?: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: Record<string, any>;
}
interface Span {
  name: string;
  ts: number;
  end: number;
  pid: number;
  tid: number;
  label: string;
  self: number;
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/trace-report.ts <trace.json> [minMs]');
  process.exit(1);
}
const minUs = Number(process.argv[3] ?? 50) * 1000;
// Traces run to hundreds of MB, so read them a line (one event) at a time and keep only the
// events this report uses.
const events: Ev[] = [];
for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
  const t = line.trim().replace(/^\{"traceEvents":\[/, '').replace(/[,\]}]+$/, '');
  if (!t.startsWith('{')) continue;
  let e: Ev;
  try {
    e = JSON.parse(t.endsWith('}') ? t : `${t}}`);
  } catch {
    continue;
  }
  if (e.ph === 'M' || e.ph === 'X' || e.ph === 'B' || e.ph === 'E' || e.name?.startsWith('trace:')) {
    if (e.ph !== 'M') delete (e as any).id;
    events.push(e);
  }
}

// Thread and process names.
const threadName = new Map<string, string>();
const processName = new Map<number, string>();
for (const e of events) {
  if (e.ph !== 'M') continue;
  if (e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args?.name);
  if (e.name === 'process_name') processName.set(e.pid, e.args?.name);
}
const isRendererMain = (pid: number, tid: number) => threadName.get(`${pid}:${tid}`) === 'CrRendererMain';
const isGpu = (pid: number) => /gpu/i.test(processName.get(pid) ?? '');

// A readable label for an event: JS calls carry the function and file.
function labelOf(e: Ev): string {
  const d = e.args?.data ?? e.args?.beginData;
  if ((e.name === 'FunctionCall' || e.name === 'EvaluateScript') && d) {
    const fn = d.functionName || '(anonymous)';
    const url = String(d.url ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    return `${e.name} ${fn} ${url}${d.lineNumber != null ? `:${d.lineNumber}` : ''}`.trim();
  }
  if (e.name === 'TimerFire' || e.name === 'FireAnimationFrame') return e.name;
  return e.name;
}

// Turn complete (X) and begin/end (B/E) events into spans, per thread.
const spansByThread = new Map<string, Span[]>();
const open = new Map<string, Ev[]>();
for (const e of events) {
  if (e.ph !== 'X' && e.ph !== 'B' && e.ph !== 'E') continue;
  if (!isRendererMain(e.pid, e.tid) && !isGpu(e.pid)) continue;
  const key = `${e.pid}:${e.tid}`;
  let s: Span | null = null;
  if (e.ph === 'X') s = { name: e.name, ts: e.ts, end: e.ts + (e.dur ?? 0), pid: e.pid, tid: e.tid, label: labelOf(e), self: 0 };
  else if (e.ph === 'B') (open.get(key) ?? open.set(key, []).get(key)!).push(e);
  else {
    const b = open.get(key)?.pop();
    if (b) s = { name: b.name, ts: b.ts, end: e.ts, pid: b.pid, tid: b.tid, label: labelOf({ ...b, args: { ...b.args, ...e.args } }), self: 0 };
  }
  if (s) (spansByThread.get(key) ?? spansByThread.set(key, []).get(key)!).push(s);
}

// Self time: a span's duration minus its direct children's.
for (const spans of spansByThread.values()) {
  spans.sort((a, b) => a.ts - b.ts || b.end - a.end);
  const stack: Span[] = [];
  for (const s of spans) {
    s.self = s.end - s.ts;
    while (stack.length && stack[stack.length - 1].end <= s.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && s.end <= parent.end) parent.self -= s.end - s.ts;
    stack.push(s);
  }
}

// Phase markers written by the trace spec (performance.mark('trace:<phase>')).
const marks = events
  .filter((e) => e.name?.startsWith('trace:') && e.cat?.includes('user_timing'))
  .map((e) => ({ name: e.name.slice(6), ts: e.ts }))
  .sort((a, b) => a.ts - b.ts);
const phaseAt = (ts: number) => {
  let p = 'start';
  for (const m of marks) if (m.ts <= ts) p = m.name;
  return p;
};

const TOP = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'ThreadPool_RunTask']);
const all = [...spansByThread.values()].flat();
const mainTasks = all.filter((s) => isRendererMain(s.pid, s.tid) && TOP.has(s.name) && s.end - s.ts >= minUs);
// Drop tasks nested in another long task (RunTask can wrap RunTask).
const longTasks = mainTasks.filter((t) => !mainTasks.some((o) => o !== t && o.pid === t.pid && o.tid === t.tid && o.ts <= t.ts && o.end >= t.end && o.end - o.ts > t.end - t.ts));
const gpuSpans = all.filter((s) => isGpu(s.pid) && s.end - s.ts >= 5000);

const ms = (us: number) => Math.round(us / 100) / 10;
const report = longTasks.map((t) => {
  const inside = all.filter((s) => s.pid === t.pid && s.tid === t.tid && s.ts >= t.ts && s.end <= t.end && s !== t);
  const self = new Map<string, number>();
  for (const s of inside) if (!TOP.has(s.name)) self.set(s.label, (self.get(s.label) ?? 0) + s.self);
  const gpu = new Map<string, number>();
  for (const s of gpuSpans) {
    const overlap = Math.min(s.end, t.end) - Math.max(s.ts, t.ts);
    if (overlap > 0 && !TOP.has(s.name)) gpu.set(s.label, Math.max(gpu.get(s.label) ?? 0, overlap));
  }
  const top = (m: Map<string, number>, n: number) =>
    [...m].sort((a, b) => b[1] - a[1]).slice(0, n).filter(([, v]) => v >= 1000).map(([name, v]) => ({ name, ms: ms(v) }));
  return { phase: phaseAt(t.ts), atMs: ms(t.ts - (marks[0]?.ts ?? t.ts)), durMs: ms(t.end - t.ts), main: top(self, 6), gpu: top(gpu, 3) };
});

// Totals per phase and per cause, so repeated stalls stand out.
const byCause = new Map<string, { count: number; ms: number }>();
for (const r of report)
  for (const c of r.main) {
    const v = byCause.get(c.name) ?? { count: 0, ms: 0 };
    v.count++;
    v.ms += c.ms;
    byCause.set(c.name, v);
  }

console.log(`${report.length} main-thread tasks >= ${minUs / 1000} ms in ${file}\n`);
for (const r of report) {
  console.log(`[${r.phase}] +${r.atMs} ms  ${r.durMs} ms`);
  for (const c of r.main) console.log(`    ${String(c.ms).padStart(7)} ms  ${c.name}`);
  for (const c of r.gpu) console.log(`    ${String(c.ms).padStart(7)} ms  (GPU) ${c.name}`);
}
console.log('\nSelf time across all long tasks:');
for (const [name, v] of [...byCause].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15))
  console.log(`  ${String(Math.round(v.ms)).padStart(7)} ms  ${String(v.count).padStart(3)}x  ${name}`);

const out = file.replace(/\.json$/, '') + '.summary.json';
writeFileSync(out, JSON.stringify({ longTasks: report, causes: Object.fromEntries(byCause) }, null, 2));
console.log(`\nSummary written to ${out}`);
