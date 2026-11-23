# Performance pass, November 2026

**Status:** done. Measured before and after on one machine; the numbers, the method and the limits are below.
**Area:** `apps/client` (three r187, `WebGPURenderer`): the ocean's simulation and its buffers, clustered lighting, the sky, the tender and the light-probe bake. `scripts/bench.ts` is the harness; [performance-results.md](performance-results.md) has every table.

## Summary

At 1440p on the High preset a frame takes 17–26% less time in the six standard viewpoints (87–149 fps before, 116–183 fps after, with the frame cap off), 21% less along a 60-second flight through the world, 13–18% less at night and in rain, 7% less on Ultra's north view and 3% less on Ultra in a storm. Under the 60 Hz cap High already held 60 fps on this machine with no frame over budget, and still does: there the gain is headroom. Ultra's north view goes from 38.1 to 41.7 fps.

A re-bake of the light probes after a jump in time or weather is complete in 1.12 s instead of 2.24 s, with no frame over budget in either build. The ocean's simulation issues 22 compute dispatches a frame instead of 212 and needs 32 compute pipelines instead of 222. The main thread does about a quarter less work per frame and allocates 23% less, so minor garbage collections come less often. The game's own buffers and textures are the same size, and neither its heap nor its GPU resources grow over regenerations or reloads. The ocean's work buffers are created empty on the device instead of being uploaded as megabytes of zeros, which leaves the renderer process 21–25 MB smaller than the original's on High (8–10%) and 80 MB smaller on Ultra (20%), with the GPU process within 0.6% of the original's. Start-up is no slower.

The picture is the same: a mean difference of at most 0.003/255 over 28 fixed views, against 0.000 for the original against itself. There is one deliberate change of fidelity, kept out of the comparison: beyond 40 m the tender's small windscreen is a plain transparent pane. The figures above and the table below are at equal fidelity. For the four scenes that show the tender from afar (north view, aerial, flight, Ultra's north view) they compare the original with the final build keeping the original windscreen at every distance; the plain pane makes those four 3.3%, 3.7%, 2.0% and 3.0% faster again.

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| Frame time, north view, no cap (ms) | 6.69 | 5.46 | −1.23 | −18.4% |
| Frame time, deck, no cap (ms) | 8.38 | 6.37 | −2.01 | −24.0% |
| Frame time, interior, no cap (ms) | 11.46 | 8.47 | −2.99 | −26.1% |
| Frame time, aerial, no cap (ms) | 7.24 | 5.94 | −1.30 | −18.0% |
| Frame time, waterline, no cap (ms) | 10.35 | 8.62 | −1.73 | −16.7% |
| Frame time, helipad, no cap (ms) | 9.36 | 7.54 | −1.82 | −19.4% |
| Frame time, 60 s flight, no cap: average (ms) | 9.35 | 7.35 | −2.00 | −21.4% |
| Frame time, 60 s flight, no cap: p95 (ms) | 13.0 | 10.2 | −2.8 | −21.5% |
| Frame time, 60 s flight, no cap: p99 (ms) | 14.8 | 12.3 | −2.5 | −16.9% |
| Frame time, interior at night, no cap (ms) | 11.30 | 9.32 | −1.98 | −17.5% |
| Frame time, Ultra north view, no cap (ms) | 26.89 | 25.29 | −1.60 | −6.0% |
| Frame time, Ultra north view, no cap: p99 (ms) | 31.8 | 35.2 | +3.4 | +10.7% |
| Frame time, Ultra deck in a storm, no cap (ms) | 47.63 | 45.90 | −1.73 | −3.6% |
| Average FPS at 60 Hz, each of the ten High scenes | 60.0 | 60.0 | 0.0 | 0.0% |
| Frames over the 16.7 ms budget at 60 Hz, High (%) | 0.00 | 0.00 | 0.00 | 0.0% |
| Average FPS at 60 Hz, Ultra north view | 38.1 | 41.7 | +3.6 | +9.4% |
| Light-probe regeneration complete after, 60 Hz (ms) | 2,242 | 1,124 | −1,119 | −49.9% |
| Frames over budget during a regeneration, 60 Hz | 0 | 0 | 0 | 0.0% |
| Time to a usable scene, warm (ms) | 1,308 | 1,270 | −38 | −2.9% |
| Time to a usable scene, cold shaders (ms) | 7,327 | 7,241 | −86 | −1.2% |
| Compute dispatches per frame | 212 | 22 | −190 | −89.6% |
| Draw calls per frame, all passes (deck) | 289 | 289 | 0 | 0.0% |
| Compute pipelines | 222 | 32 | −190 | −85.6% |
| JavaScript and WebGPU-call time per frame at 60 Hz, deck (sampling profiler, ms) | 2.03 | 1.54 | −0.49 | −24.0% |
| JavaScript allocated per frame, deck (KB) | 211.2 | 162.3 | −48.9 | −23.1% |
| JS heap after GC, deck (MB) | 68.6 | 68.2 | −0.4 | −0.6% |
| GPU textures and buffers alive, deck (MB) | 567.1 | 567.1 | 0.0 | 0.0% |
| Buffer contents uploaded at creation, deck (MB) | 65.2 | 45.7 | −19.5 | −29.9% |
| Renderer process footprint, deck (MB) | 264 | 243 | −21 | −8.0% |
| GPU process footprint, deck (MB) | 1,372 | 1,378 | +7 | +0.5% |
| Renderer process footprint, Ultra deck in a storm (MB) | 395 | 315 | −80 | −20.3% |
| GPU process footprint, Ultra deck in a storm (MB) | 2,798 | 2,812 | +14 | +0.5% |
| JS heap growth over 8 regenerations (MB) | 0.19 | 0.26 | +0.06 | +34.2% |
| GPU memory growth over 8 regenerations (MB) | 0.00 | 0.00 | 0.00 | 0.0% |

Frame times are medians over five runs of each build; paired run by run, the six views change by −18.4%, −23.9%, −25.5%, −18.5%, −16.7% and −19.5%. "No cap" is headless Chrome with its 60 Hz limit off (throughput); "60 Hz" is with it on. Every row, with its spread over runs, is in [performance-results.md](performance-results.md). The memory, start-up and resource rows are of the delivered build; the frame-time, main-thread and regeneration-time rows are of the final build before its last change, which does not act on a frame (see "Builds" below). The start-up rows are of the last session; an earlier one had the two builds level (see "Start-up").

## How it was measured

**Machine and browser.** Apple M5 Pro (5 + 10 CPU cores, 16 GPU cores, 24 GB), macOS, on mains power, except for two sets of runs of the last change that were made on battery (see the limits). Chrome 157 from the `chrome` channel, headless, with Playwright's own temporary profile and `--enable-unsafe-webgpu --enable-gpu --ignore-gpu-blocklist --use-angle=metal`, as the repo's Playwright suites use. Viewport 2560×1440 at a device pixel ratio of 1 (the size of `pnpm perf`); the canvas is 2560×1440 on Low to High and 3840×2160 on Ultra, checked equal in both builds for every measurement. Automatic resolution is off (`fixedres`).

**Builds.** Two production builds (`pnpm build`), frozen as directories and served by the harness's own static file server, each on its own port: the original is commit `a3ca5db`, built from a clean export of that commit; the final is the working tree. Only the client is measured, offline (`?offline`), so the Worker takes no part.

**One change came after the timing runs.** The last change, which creates seven of the ocean's buffers empty instead of uploading zeros into them, was made to remove a memory regression that the first measurement found. It acts once, at start-up, and is not on the frame path. So the tables of frame time, the main thread, regeneration time and the ablation are of the final build as it was before that change, and "The ocean's buffers" under the results shows the delivered build's frame times to be the same, with and without the cap. Memory (the growth over regenerations and reloads included), start-up, the resource counts and the pictures were measured again with the delivered build, and those tables are of it.

**The harness measures from outside the game.** A script injected before the page's own scripts wraps `requestAnimationFrame` and records, per frame, the frame's timestamp and the time spent inside animation callbacks. For the counting suites it also wraps the WebGPU API (draws and their primitives, including those replayed from render bundles; passes; dispatches; pipelines, shader modules, buffers and textures created and destroyed; uploads). Memory comes from the DevTools protocol (heap after a forced collection) and from macOS's `footprint` for the renderer and GPU processes. The game is not instrumented, so both builds are measured by the same code.

**Scenarios.** All use `offline&fixedres&date=2026-12-21`, which fixes the seeded weather and the sun's path.

| Scenario | Query | What it is |
|---|---|---|
| `high-refn`, `-deck`, `-interior`, `-aerial`, `-swim`, `-pad` | `cam=…&hour=11&weather=fair&q=high` | The six viewpoints of `pnpm perf`: typical rendering |
| `ultra-refn` | `cam=refn&hour=11&weather=fair&q=ultra` | Ultra: 3840×2160, SSR, full-resolution AO, a 512² ocean |
| `ultra-deck-storm` | `cam=deck&hour=14&weather=storm&q=ultra` | Ultra in a storm: rain, the biggest sea |
| `high-lounge-night`, `high-interior-night` | `cam=lounge&hour=22…`, `cam=interior&hour=21…` | Night: every lamp lit |
| `high-pad-drone-rain` | `cam=pad&hour=16&weather=rain&q=high&drone=hold` | The drone hovering in rain |
| `high-path` | `cam=aerial&hour=11&weather=fair&q=high&ts=12` | 60 s flight between eight viewpoints (outside, deck, rooms, pad, waterline) with the clock at the game's default rate, so the environment map and the light probes regenerate as in play |

**Timing runs.** Per run one fresh browser; per measurement a new page: load, 5 s to settle (the first probe bake, exposure, temporal AA), then a 15 s window (60 s for the path). The two builds alternate within each scenario and swap who goes first, because the machine drifts: run to run, the same build's uncapped frame time moved by up to 20% as it warmed up. Five runs per build. The tables give the median over runs of each run's statistic, the range over runs, and for uncapped frame time the median of the per-run paired change.

**Equal fidelity.** One change alters the picture slightly (the tender's windscreen from afar), and four scenarios have the tender in view from afar. For those, a third build, the final with the original windscreen at every distance, took turns with the other two in five further runs; the comparison of the original with that build is the one reported, and the windscreen's own effect is reported apart.

**Two frame-pacing modes.** Headless Chrome presents at 60 Hz. With that cap the High preset is pinned at 60 fps in both builds on this machine, so capped runs show pacing (missed refreshes, hitches) but not the gain. Uncapped runs (`--disable-frame-rate-limit --disable-gpu-vsync`) show throughput: how long a frame takes when nothing waits for the display.

**Definitions.** The frame budget is 16.67 ms (60 Hz). A frame is over budget when its interval exceeds 17.2 ms (the budget plus 0.5 ms of timestamp jitter), a hitch when it exceeds 41.7 ms (2.5 refreshes).

**Main-thread work per frame** is given three ways, because none is complete alone.

1. *Time inside the animation callbacks* from a Chrome trace, on the wall clock and on the thread's own CPU clock (the `thread` suite). Under the cap the main thread works for a sixth of each frame, and the same callbacks of the same build take 2.5–2.9 ms on an otherwise idle machine and 1.4–2.8 ms with eight other cores kept busy (`--busy 8`); they also take less at Ultra than at High, although Ultra does more per frame. The likeliest reading is that the machine clocks an under-used core down; that was not measured directly. The busy figure is taken as the one that compares work, and the idle one is reported beside it. Without the cap the callbacks also wait for the GPU process, so their time is not used.
2. *Self time of JavaScript and WebGPU calls* from V8's sampling profiler (the `cpu` suite). It leaves out native time the profiler cannot attribute.
3. *Allocation per frame* from V8's sampling heap profiler, and the garbage collections in the trace.

**GPU time is not reported.** WebGPU timestamp queries are available, but on this GPU the passes' intervals overlap (the game's own profiler notes 21 passes of ~7 ms each in a 15 ms frame), so their sum is not a frame's GPU time, and the longest single pass is only a lower bound. The uncapped frame interval is used instead as the measure of the whole pipeline; it is not GPU time and is not presented as such.

**Startup.** Time from navigation start, with the loading screen's steps timestamped by a mutation observer. "Usable" is the third frame, when the loading screen starts to lift. Warm: one unmeasured visit first, then five. Cold: the same, with every fragment shader made new to the driver's shader cache for that run, by inserting a never-true `discard` on an interpolated input into the WGSL (an unused variable would compile to the same machine code and hit the cache). Vertex and compute shaders stay cached, so a real first visit is somewhat slower still; and the inserted `discard` means cold runs are for start-up times only.

**Regeneration.** The world is built once and never torn down in the page, so regeneration here means what the running game rebuilds: a jump of the time of day and the weather re-renders the sky's environment map, rebuilds the ocean's spectrum and re-bakes all 135 light probes. Eight jumps per run, 24 s apart (re-bakes are at least 20 s apart), with every `bake()` call timed and the frames meanwhile recorded. Memory is read after each jump. Reloading the page is the only teardown there is; the reload suite loads the world six times in one tab.

**Pictures.** `shots` renders 28 views with a seeded `Math.random` and a clock that advances 1/60 s per frame, stops at game frame 420 and takes a screenshot; `diff` compares two sets pixel by pixel and says where the largest differences are. The original against itself gives the noise floor (the tender's pose depends on asynchronous GPU readbacks). Sets were also taken of two variants of the final build, one without the plain windscreen and one without that or the sky's cut, to see which change moves which pixels.

**Memory.** Counts and sizes of what the game creates are exact and do not vary. Process footprints do, so those were measured four times per build, the builds taking turns to go first. Where a footprint differed, `footprint` gave it by category and `footprint -v` by region, which is how the two causes in "The ocean's buffers" were told apart.

**Noise floor for timing.** The original measured against itself, uncapped and paired the same way, differed by 0.1–0.9% (median of three runs; single runs up to 4%). Differences of that size are not claimed.

## Where the time went

The game is GPU-bound: at 1440p High a frame took 6.7–11.5 ms uncapped in the six standard views, of which the main thread was busy for about 2 ms. Switching things off inside one running page (the `ablate` suite: each comparison is seconds apart, four rounds) changed the original build's frame time by:

| Switched off | North view | Deck | Interior | Aerial |
|---|---:|---:|---:|---:|
| Lamps at zero intensity taken out of the light clusters | −2.6% | −17.0% | −22.0% | −4.8% |
| The sky | −16.0% | −8.1% | −2.9% | −12.9% |
| The ocean's simulation (frozen, still drawn) | −13.2% | −13.0% | −11.9% | −15.4% |
| The ocean's surface (simulation still running) | −28.7% | −10.6% | −10.5% | −39.2% |
| Glass | +0.2% | −11.6% | −10.5% | −4.1% |
| Grass | +5.3% | −0.8% | −1.3% | −0.5% |
| (The sky drawn after everything else instead of first) | +1.4% | +0.5% | −0.3% | +0.6% |

Each figure is the median of four rounds; their spread is in the results. It is widest on the north view, where a frame is shortest (up to ±5 points), and one round of the aerial view's grass row was 11 points off. The grass and "sky last" rows are inside the spread. The same table for the final build is further down.

What this pointed to:

1. **The ocean's simulation ran as 212 compute dispatches in 21 passes** (each FFT step of each of the four fields of each of the three cascades separately), 12–15% of the frame everywhere, and 222 compute pipelines to create.
2. **Lamps that are switched off still cost a lighting pass.** Lamps change intensity only (hiding one rebuilds every lit shader), so by day 68 of the 76 point lights sat in the light clusters at zero intensity and every fragment in range ran the lighting model for each: 17–22% of the frame on the deck and indoors. Glass seems to have paid it again: its own share fell from 11% to 4% once the dark lamps were gone.
3. **Aimed lamps ran the lighting model outside their beam.** The cone factor was multiplied into the colour afterwards.
4. **The sky was shaded under the sea.** The sea is drawn in a later pass (it copies the frame for refraction first), so the GPU's hidden-surface removal cannot skip the sky behind it, and the sky's stars and moon were computed in daylight too. Up to 16% of the frame.
5. **The tender's 0.7 m windscreen was transmissive**, which makes three copy the whole frame and build the copy's mip chain whenever the pane is in view: 12 render passes and a 37.5 MB texture for a pane a few pixels wide.
6. **Each probe bake call has a fixed cost** (the bake light's shadow map, the repack), and a re-bake made 135 of them.

Things measured and left alone are listed at the end.

## What changed

1. **Ocean simulation as one pass** (`env/ocean/`). All cascades' data lie in the same buffers, one N×N layer after another, and the four complex fields are packed two to a `vec4`. Each FFT step is one dispatch over everything, the sign fix-up is folded into the assembly, and the whole frame is one `renderer.compute()` call: 22 dispatches in 3 passes instead of 212 in 21, 32 compute pipelines instead of 222. The arithmetic per element is the same.
2. **Clustered lights** (`render/stableClusteredLighting.ts`). A lamp at zero intensity gets bounds that touch no cluster. An aimed lamp's cone is written into the spot row of three's lights texture, so three's own loop skips fragments outside the beam, and the lamp is clustered by the sphere round its cone instead of its whole range. The separate aim texture and the `_getLightData` override are gone.
3. **Sky** (`env/sky.ts`, `env/ocean/ocean.ts`, `game/frame.ts`). For the game's own render the sky is left black below the direction under which the sea surely covers it (`Ocean.coversBelow`, from the camera's height, the grid's radius and the measured wave heights); the environment map and the probe bakes still see the whole sky. Stars are computed only at night and the moon's surface only inside its disc.
4. **Tender windscreen** (`world/tender.ts`): beyond 40 m, where it is under 20 pixels wide, a plain transparent pane stands in for the transmissive one. A fidelity change: see the trade-offs.
5. **Light probes** (`world/interiorLight.ts`): two per bake call instead of one. A trade: see below.
6. **Smaller things.** The wave readback reuses one GPU buffer instead of creating one per readback; the CPU sky model, the mooring lines and the frame loop no longer build arrays and vectors every frame.
7. **The ocean's work buffers are created empty** (`env/ocean/simulation.ts`). Seven buffers hold the spectra and the fields being transformed (19.5 MB on High, 78.0 MB on Ultra), and only compute kernels write them. three creates a storage buffer mapped and copies its CPU array in, here megabytes of zeros; the game now creates these seven on the device itself and gives them to three, so nothing is uploaded and their CPU arrays are never touched. This was the fix for a memory regression of change 1 and depends on three's internals: see the results and the limits.

## Results

Each table has the same five columns; [performance-results.md](performance-results.md) adds the spread over runs and the rows left out here.

### Frame time with the cap off

Average frame time in ms, the median of five runs. The last column is the median of the five per-run paired changes, with their range.

| Scene | Original | Final | Absolute change | Percentage change | Paired by run (range) |
|---|---:|---:|---:|---:|---:|
| North view (`high-refn`) * | 6.69 | 5.46 | −1.23 | −18.4% | −18.4% (−24.0 … −17.6) |
| Deck (`high-deck`) | 8.38 | 6.37 | −2.01 | −24.0% | −23.9% (−25.0 … −23.7) |
| Interior (`high-interior`) | 11.46 | 8.47 | −2.99 | −26.1% | −25.5% (−26.3 … −20.0) |
| Aerial (`high-aerial`) * | 7.24 | 5.94 | −1.30 | −18.0% | −18.5% (−26.3 … −17.6) |
| Waterline (`high-swim`) | 10.35 | 8.62 | −1.73 | −16.7% | −16.7% (−16.9 … −15.8) |
| Helipad (`high-pad`) | 9.36 | 7.54 | −1.82 | −19.4% | −19.5% (−19.6 … −18.4) |
| Ultra, north view (`ultra-refn`) * | 26.89 | 25.29 | −1.60 | −6.0% | −7.2% (−17.1 … −6.0) |
| Ultra, deck in a storm (`ultra-deck-storm`) | 47.63 | 45.90 | −1.73 | −3.6% | −3.3% (−4.2 … −1.3) |
| Lounge at night (`high-lounge-night`) | 8.97 | 7.72 | −1.25 | −13.9% | −14.1% (−16.3 … −13.4) |
| Interior at night (`high-interior-night`) | 11.30 | 9.32 | −1.98 | −17.5% | −17.5% (−18.4 … −17.3) |
| Helipad, drone hovering in rain (`high-pad-drone-rain`) | 7.65 | 6.63 | −1.02 | −13.3% | −13.5% (−14.1 … −12.5) |
| 60 s flight (`high-path`) * | 9.35 | 7.35 | −2.00 | −21.4% | −21.1% (−24.4 … −20.9) |

\* At equal fidelity: the original against the final build with the original windscreen at every distance (see the change of fidelity below). Five runs, as for the other scenes, but made in a later session on a warmer machine: absolute values differ between sessions (the original's Ultra north view ran at 42.5 fps under the cap in the first and 38.1 fps in this one), so only the changes within a session compare.

In the ten High scenes p95 fell by 19–32%. p99 fell by 10–23% in 8 of them and moved by −2% in the north view and +8% in the aerial, where it sits on the periodic waits described under the regressions. No frame of any High run was a hitch (over 41.7 ms) in either build, and the share of frames over the 60 Hz budget went from 0.00–0.31% to 0.00–0.18%. On Ultra's north view p99 rose from 31.8 to 35.2 ms (see the regressions).

### At 60 Hz

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| Average FPS, each of the ten High scenes | 60.0 | 60.0 | 0.0 | 0.0% |
| Frames over budget, High (%) | 0.00 | 0.00 | 0.00 | 0.0% |
| Hitches over 41.7 ms, High (per minute) | 0.00 | 0.00 | 0.00 | 0.0% |
| Frame time p95, High, slowest scene (ms) | 16.8 | 16.8 | 0.0 | 0.0% |
| Frame time p99, High, slowest scene (ms) | 16.8 | 16.8 | 0.0 | 0.0% |
| Longest frame in any High run (ms) | 16.8 | 16.8 | 0.0 | 0.0% |
| Average FPS, Ultra north view * | 38.1 | 41.7 | +3.6 | +9.4% |
| Frames over budget, Ultra north view (%) * | 57.3 | 43.8 | −13.5 | −23.6% |
| Longest frame in any run, Ultra north view (ms) * | 33.5 | 33.5 | 0.0 | 0.0% |
| Average FPS, Ultra deck in a storm | 23.1 | 24.2 | +1.1 | +4.8% |
| Frames over budget, Ultra deck in a storm (%) | 100.0 | 100.0 | 0.0 | 0.0% |
| Longest frame in any run, Ultra deck in a storm (ms) | 66.7 | 50.1 | −16.6 | −24.9% |

High was pinned at the cap before and still is: every frame of every run arrived on its refresh in both builds. On Ultra a frame takes one or two refreshes (north view) or two or three (storm), so the average moves while the percentiles sit on multiples of 16.7 ms. In the storm every frame is over budget in both builds, and most count as hitches by the 41.7 ms definition (824 a minute before, 691 after): they are the 50 ms frames of a scene that runs at 23–24 fps, not stalls.

### Start-up

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| Usable scene, warm (ms) | 1,308 | 1,270 | −38 | −2.9% |
| Usable scene, cold shaders (ms) | 7,327 | 7,241 | −86 | −1.2% |
| First frame, warm (ms) | 1,217 | 1,191 | −26 | −2.1% |
| Generating the world, warm (ms) | 87 | 88 | +1 | +1.1% |
| Compiling shaders, warm (ms) | 696 | 700 | +4 | +0.6% |
| Compiling shaders, cold (ms) | 5,366 | 5,330 | −36 | −0.7% |
| Main-thread blocking until usable, warm: excess of tasks over 50 ms (ms) | 343 | 310 | −33 | −9.6% |
| Longest main-thread task until usable, warm (ms) | 295 | 261 | −34 | −11.5% |
| Light probes all baked, warm (ms) | 3,483 | 2,330 | −1,153 | −33.1% |

Measured in the north view, so at equal fidelity: the original against the delivered build with the original windscreen, five runs each, in runs where the build before the last change took turns with them (its column is in the results). Start-up was not a target. Warm, the usable scene came at 1,308 ms for the original and 1,270 ms for the delivered build (runs of 1289–1315 and 1252–1296 ms). The earlier session, which compared the original with the build before the last change, had them level at 1,246 and 1,252 ms. So start-up is no slower, and between level and 3% sooner. The last change itself does nothing measurable here: 1,274 ms before it, 1,270 ms with it. Cold, 7,327 against 7,241 ms (runs of 7244–7468 and 7228–7275 ms). The longest main-thread task before the scene is usable is 34 ms shorter. The interior's bounce light is complete 1.2 s sooner because the probes are baked two at a time. With the plain windscreen the final build was usable 30 ms sooner warm in the main runs, before the last change (1264 → 1234 ms).

### Regeneration: a jump of the time of day and the weather

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| Complete after, 60 Hz (ms) | 2,242 | 1,124 | −1,119 | −49.9% |
| `bake()` calls | 135 | 68 | −67 | −49.6% |
| Main-thread time in `bake()`, total, 60 Hz (ms) | 97.4 | 52.8 | −44.6 | −45.8% |
| Main-thread time in `bake()`, longest call, 60 Hz (ms) | 1.0 | 1.0 | 0.0 | 0.0% |
| Frame time meanwhile, p95, 60 Hz (ms) | 16.8 | 16.8 | 0.0 | 0.0% |
| Longest frame meanwhile, 60 Hz (ms) | 16.8 | 16.8 | 0.0 | 0.0% |
| Frames over budget meanwhile, 60 Hz | 0 | 0 | 0 | 0.0% |
| Draw calls in the busiest frame | 504 | 599 | +95 | +18.8% |
| Complete after, no cap (ms) | 1,253 | 598 | −655 | −52.3% |
| Median frame time meanwhile, above the rest of the window, no cap (ms) | 0.55 | 1.10 | +0.55 | +100.0% |
| Longest frame meanwhile, no cap (ms) | 18.1 | 25.7 | +7.6 | +41.6% |

16 jumps per build at 60 Hz, 8 without the cap. The sky's environment map and the ocean's spectrum are rebuilt in the first frame of a jump in both builds; the 135 probes follow, one per frame before and two per frame now. No shader or pipeline is created by a jump in either build.

### Work per frame and resources

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| Draw calls per frame, all passes (deck) | 289 | 289 | 0 | 0.0% |
| Triangles per frame, all passes (deck) | 969,008 | 969,008 | 0 | 0.0% |
| Render passes per frame (deck) | 85 | 85 | 0 | 0.0% |
| Draw calls per frame, all passes (interior) | 264 | 264 | 0 | 0.0% |
| Triangles per frame, all passes (interior) | 964,737 | 964,737 | 0 | 0.0% |
| Render passes per frame (interior) | 73 | 73 | 0 | 0.0% |
| Compute passes per frame | 21 | 3 | −18 | −85.7% |
| Compute dispatches per frame | 212 | 22 | −190 | −89.6% |
| Command buffers submitted per frame | 52 | 34 | −18 | −34.6% |
| Texture uploads per frame (KB) | 80.4 | 64.4 | −16.0 | −19.9% |
| Buffer uploads per frame (KB, deck) | 9.2 | 9.2 | 0.0 | 0.0% |
| GPU buffers created per frame | 1 | 0 | −1 | −100.0% |
| Compute pipelines | 222 | 32 | −190 | −85.6% |
| Render pipelines | 167 | 169 | +2 | +1.2% |
| Shader modules | 289 | 292 | +3 | +1.0% |
| Shader programs (three: vertex, fragment and compute) | 227 | 230 | +3 | +1.3% |
| Geometries (three) | 132 | 132 | 0 | 0.0% |
| Textures (three) | 61 | 60 | −1 | −1.6% |
| Compute dispatches per frame, Ultra | 235 | 23 | −212 | −90.2% |
| Compute pipelines, Ultra | 246 | 34 | −212 | −86.2% |

Draw calls, triangles and render passes are those of a whole frame: shadow cascades, the scene, the ocean textures' mips, post-processing. They are the same in every scene at equal fidelity; where the tender is in view from afar the plain windscreen takes 12 passes and 11 one-triangle draws away (see the fidelity change). The two extra render pipelines and three shader modules are presumably the plain pane's; that was not isolated.

### Main thread

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| CPU time in the animation callbacks per frame, 60 Hz, eight other cores busy: deck (ms) | 2.14 | 1.56 | −0.58 | −27.0% |
| CPU time in the animation callbacks per frame, 60 Hz, eight other cores busy: interior (ms) | 2.02 | 1.57 | −0.46 | −22.6% |
| CPU time in the animation callbacks per frame, 60 Hz, eight other cores busy: waterline (ms) | 1.95 | 1.43 | −0.52 | −26.7% |
| The same on an otherwise idle machine: deck (ms) | 2.65 | 2.58 | −0.07 | −2.7% |
| The same on an otherwise idle machine: interior (ms) | 2.55 | 2.63 | +0.08 | +3.2% |
| The same on an otherwise idle machine: waterline (ms) | 2.52 | 2.61 | +0.09 | +3.4% |
| Self time of JavaScript and WebGPU calls per frame (sampling profiler): deck (ms) | 2.03 | 1.54 | −0.49 | −24.0% |
| Self time of JavaScript and WebGPU calls per frame (sampling profiler): interior (ms) | 1.77 | 1.36 | −0.41 | −23.4% |
| JavaScript allocated per frame: deck (KB) | 211.2 | 162.3 | −48.9 | −23.1% |
| JavaScript allocated per frame: interior (KB) | 206.2 | 159.6 | −46.6 | −22.6% |
| Minor garbage collections per minute, 60 Hz: deck | 30 | 18 | −12 | −40.0% |
| Minor garbage collections per minute, 60 Hz: interior | 30 | 24 | −6 | −20.0% |
| Minor garbage collections per minute, 60 Hz: waterline | 24 | 24 | 0 | 0.0% |
| Longest minor GC pause, 60 Hz: deck (ms) | 1.20 | 1.51 | +0.31 | +25.8% |

Three readings of the same work. With other cores kept busy, the callbacks cost 23–27% less CPU time (two runs; eight spinning cores heat the machine, so runs differ by up to 20%, and over the four runs made this way the paired change ranged from −13% to −36%). The sampling profiler, on an idle machine, attributes 23–24% less to JavaScript and WebGPU calls. On an idle machine the callbacks' own time hardly moves (−3% to +3% here; in the five timing runs the ten High scenes went from 2.3–2.9 ms to 2.5–2.7 ms): the final's High scenes all land near 2.6 ms whatever they draw. That fits a core being clocked down when it has little to do, which is an inference (see the method).

Minor collections pause the main thread for 1.2–1.5 ms each in both builds, and a major collection, about one per ten-second window in both, for 3–5 ms. A ten-second window holds three to six collections, so the rates are coarse. The north view is left out of this table because it shows the tender from afar; its rows are in the results.

### Memory

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| JS heap after GC, deck (MB) | 68.6 | 68.2 | −0.4 | −0.6% |
| JS heap after GC, interior (MB) | 64.9 | 64.5 | −0.3 | −0.5% |
| JS heap after GC, Ultra, deck in a storm (MB) | 68.6 | 68.0 | −0.6 | −0.9% |
| GPU textures alive, deck (MB, estimate) | 501.9 | 501.9 | 0.0 | 0.0% |
| GPU textures, peak, deck (MB, estimate) | 501.9 | 501.9 | 0.0 | 0.0% |
| GPU textures alive, interior (MB, estimate) | 464.4 | 464.4 | 0.0 | 0.0% |
| GPU textures, peak, interior (MB, estimate) | 464.4 | 464.4 | 0.0 | 0.0% |
| GPU textures alive, Ultra, deck in a storm (MB, estimate) | 1,513.2 | 1,513.2 | 0.0 | 0.0% |
| GPU textures, peak, Ultra, deck in a storm (MB, estimate) | 1,513.2 | 1,513.2 | 0.0 | 0.0% |
| GPU buffers alive, deck (MB, measured sizes) | 65.3 | 65.3 | 0.0 | 0.0% |
| Buffer contents uploaded at creation, deck (MB) | 65.2 | 45.7 | −19.5 | −29.9% |
| GPU buffers alive, Ultra, deck in a storm (MB, measured sizes) | 164.8 | 164.8 | 0.0 | 0.0% |
| Buffer contents uploaded at creation, Ultra, deck in a storm (MB) | 164.7 | 86.7 | −78.0 | −47.4% |
| GPU process footprint, north view (MB) | 1,387 | 1,365 | −22 | −1.6% |
| Renderer process footprint, north view (MB) | 280 | 252 | −27 | −9.7% |
| Renderer process footprint, peak, north view (MB) | 428 | 392 | −36 | −8.4% |
| GPU process footprint, deck (MB) | 1,372 | 1,378 | +7 | +0.5% |
| Renderer process footprint, deck (MB) | 264 | 243 | −21 | −8.0% |
| Renderer process footprint, peak, deck (MB) | 400 | 378 | −22 | −5.6% |
| GPU process footprint, interior (MB) | 1,332 | 1,341 | +8 | +0.6% |
| Renderer process footprint, interior (MB) | 262 | 237 | −25 | −9.5% |
| Renderer process footprint, peak, interior (MB) | 400 | 370 | −30 | −7.6% |
| GPU process footprint, Ultra, deck in a storm (MB) | 2,798 | 2,812 | +14 | +0.5% |
| Renderer process footprint, Ultra, deck in a storm (MB) | 395 | 315 | −80 | −20.3% |
| Renderer process footprint, peak, Ultra, deck in a storm (MB) | 506 | 428 | −78 | −15.5% |
| JS heap growth over 8 regenerations: highest reading above the first (MB) | 0.19 | 0.26 | +0.06 | +34.2% |
| GPU buffers and textures, growth over 8 regenerations (MB) | 0.00 | 0.00 | 0.00 | 0.0% |
| Geometries, textures and pipelines (three), growth over 8 regenerations | 0 | 0 | 0 | 0.0% |
| JS heap growth over six loads of the world in one tab (MB) | 0.04 | 0.05 | +0.01 | +25.0% |

Every row is of the delivered build. The process rows and the heap are medians of four runs, the builds taking turns to go first; the counts and sizes do not vary. What the game allocates is unchanged, buffers to the byte and textures by their descriptors, with a slightly smaller JS heap; the 19.5 MB less uploaded on High is the ocean's seven work buffers, now created empty. The renderer process is smaller than the original's in every scene and the GPU process is within 0.6% of it, apart from the north view, where the plain windscreen saves a frame copy. How that came about, with the build before the last change beside these two, is the next section.

The page's heap and GPU resources do not grow: over eight regenerations the JS heap rises by at most 0.19 MB in the original and 0.26 MB in the delivered build, flattening as it goes (16 jumps per build), and the GPU's buffers and textures by 0.00 and 0.00 MB; over six loads of the world in one tab (the north view, as the final build draws it) the heap changes by +0.04 and +0.05 MB. The processes do hold more after six loads than after one, in both builds: the renderer 21 MB more in the original and 17 MB in the delivered build, the GPU process 46 and 24 MB (one run each; the earlier run of the build before the last change had 25 and 17 MB, and 24 and 31 MB). That is the browser's memory, not the page's heap or its GPU resources; it was there before this pass and was not looked into (see the limits).

### The ocean's buffers, created empty

The first measurement of this pass found the browser's processes holding more memory in the final build than in the original, although the game's buffers and textures were the same size. It had two causes. The last change of the pass removes the first; the second is the other side of submitting fewer command buffers, and stays. This was measured last, with three builds taking turns: the original, the final build as the frame-time tables have it ("before"), and the delivered build.

| Metric | Original | Final before this change | Final |
|---|---:|---:|---:|
| Buffer contents uploaded at creation, deck (MB) | 65.2 | 65.2 | 45.7 |
| GPU buffers alive, deck (MB) | 65.3 | 65.3 | 65.3 |
| Buffer contents uploaded at creation, Ultra, deck in a storm (MB) | 164.7 | 164.7 | 86.7 |
| GPU buffers alive, Ultra, deck in a storm (MB) | 164.8 | 164.8 | 164.8 |
| Renderer process footprint, north view (MB) | 280 | 283 | 252 |
| Renderer process footprint, deck (MB) | 264 | 270 | 243 |
| Renderer process footprint, interior (MB) | 262 | 267 | 237 |
| Renderer process footprint, Ultra, deck in a storm (MB) | 395 | 440 | 315 |
| GPU process footprint, north view (MB) | 1,387 | 1,375 | 1,365 |
| GPU process footprint, deck (MB) | 1,372 | 1,389 | 1,378 |
| GPU process footprint, interior (MB) | 1,332 | 1,350 | 1,341 |
| GPU process footprint, Ultra, deck in a storm (MB) | 2,798 | 2,876 | 2,812 |

Medians of four runs; the spread and the peaks are in the results. In the north view the plain windscreen also saves a 37.5 MB frame copy in the GPU process. On the deck and indoors the GPU process is 7–8 MB above the original's in these runs, which use the harness's counters and open four scenes one after another in one browser. It is not above it in either of two other ways of measuring: with each scene opened alone in its own browser (the deck: 1,345 MB for the original and 1,340 MB for the delivered build, four runs each) and with the same sequence of scenes but no counters (the deck: 1,331 and 1,318 MB; the interior: 1,339 and 1,339 MB; three runs each). So those 7–8 MB are of the size that the way of measuring moves, and were not traced further.

**The upload.** three creates a storage buffer mapped and copies the attribute's CPU array into it. For the ocean's seven work buffers that was 19.5 MB of zeros on High and 78.0 MB on Ultra. macOS's `footprint` shows on Ultra where that was held:

| Category (`footprint`), Ultra, deck in a storm | Original | Final before this change | Final |
|---|---:|---:|---:|
| Renderer process, total (MB) | 508 (500–512) | 552 (548–554) | 417 (416–421) |
| Renderer: `app-specific tag 16` (MB) | 347 (336–348) | 344 (343–347) | 274 (273–276) |
| Renderer: `untagged (VM_ALLOCATE)` (MB) | 92 (92–94) | 138 (137–139) | 77 (77–77) |
| GPU process, total (MB) | 2800 (2782–2821) | 2858 (2855–2860) | 2800 (2795–2819) |
| GPU process: `untagged (VM_ALLOCATE)` (MB) | 92 (92–94) | 138 (137–139) | 77 (77–77) |
| GPU process: `IOAccelerator (graphics)` (MB) | 112 (112–112) | 149 (149–149) | 149 (149–149) |

Median (range) of four runs on pages without the harness's counters, which is why the totals differ from the table above. Two things went with the upload. One category of the renderer's own memory, `app-specific tag 16`, is 73 MB smaller without it, about the size of the arrays of zeros: presumably they became resident when the copy read them, and now nothing reads them. And the mapped contents pass through memory the two processes share (`untagged (VM_ALLOCATE)`, the same figure in both). The original uploaded the same zeros as 33 smaller buffers and held 92 MB there; packing them into seven large buffers (change 1) raised that to 138 MB, which was the regression; with no upload it is 77 MB. The buffers themselves are the same size in all three builds.

**The command storage.** What is left is one category of the GPU process on Ultra, `IOAccelerator (graphics)`: 112 → 149 MB, the same before and after this change. `footprint -v` shows it as 63 or 64 pairs of regions of 1 MiB and 0.75 MiB, each pair wholly dirty or untouched. How many are dirty follows how a frame is cut into command buffers, not what the game allocates:

| Scene and build | Command buffers submitted per frame | Region pairs dirty (of 63–64) | Dirty in the category (MiB) | Samples |
|---|---:|---:|---:|---:|
| Ultra, deck in a storm: original | 58 | 39 | 112 | 3 |
| The same: final | 38 | 57 | 149 | 3 |
| The same, ocean off (`off=ocean`): original | 31 | 54 | 142 | 2 |
| The same, ocean off: final | 31 | 54 | 142 | 2 |
| The same, bloom off (`off=bloom`): original | 44 | 32 | 97 | 1 |
| The same, bloom off: final | 24 | 32 | 92 | 1 |
| The same: final with the ocean's kernels submitted one by one | 59 | 38 | 110 | 2 |
| Ultra, north view: original |  | 39 | 117 | 1 |
| Ultra, north view: final |  | 57 | 150 | 1 |
| High, deck: original | 52 | 20 | 61 | 1 |
| High, deck: final | 34 | 20 | 59 | 1 |

Sampled 20–50 s after the scene appeared; on Ultra a scene sampled more than once gave the same figures each time. Switching the ocean off brings the original to the final's level, bloom moves both by more than the two builds differ, and a build that submits the final's kernels one by one (made for this test) is back at the original's figure. On High the category is not steady in any build: the one sample of the deck had 20 pairs in each, but over four runs of the deck it lay between 60 and 86 MB in all three builds, and with the scenes opened in sequence the interior had 39 pairs in the original and 21 to 48 in the final. Nothing is claimed for High. The regions are presumably the Metal driver's storage for command buffers in flight, of which a Metal command queue allows 64; that reading was not verified. Whatever they are, they are bounded: 64 pairs are 112 MiB.

The same test build shows what the single compute pass buys and costs:

| Without the cap, median of five runs | Before this change | Final | Kernels submitted one by one | One by one against final, paired (range) |
|---|---:|---:|---:|---:|
| Deck: average frame time (ms) | 6.05 | 6.04 | 6.63 | +9.9% (+9.1 … +10.2) |
| Deck: p95 (ms) | 6.7 | 6.6 | 7.0 | |
| Deck: p99 (ms) | 9.0 | 9.0 | 8.0 | |
| Ultra, north view: average frame time (ms) | 23.52 | 23.55 | 23.68 | +0.4% (+0.1 … +0.9) |
| Ultra, north view: p95 (ms) | 27.7 | 27.9 | 26.9 | |
| Ultra, north view: p99 (ms) | 35.0 | 35.0 | 28.7 | |

Submitting the kernels one by one brings that category back to the original's level on Ultra (the process's total was not measured for that build, and on High other categories were seen to move the other way) and takes the p99 of Ultra's north view from 35.0 to 28.7 ms (the regression listed below), and it makes a frame on the deck at High 9.9% longer. The single pass stays.

**Frame time is unchanged by this change.** The delivered build against the build before it, without the cap, five runs each, paired by run:

| Scene | Runs | Before this change (ms) | Final (ms) | Paired by run (range) |
|---|---:|---:|---:|---:|
| Interior (`high-interior`) | 5 | 8.87 | 8.77 | +0.1% (−4.4 … +1.2) |
| Waterline (`high-swim`) | 5 | 8.93 | 9.02 | +0.9% (−5.1 … +1.0) |
| Ultra, deck in a storm (`ultra-deck-storm`) | 5 | 48.06 | 48.95 | +0.7% (−0.3 … +4.5) |
| Deck (`high-deck`) | 5 | 6.05 | 6.04 | −0.2% (−0.3 … +0.3) |
| Ultra, north view (`ultra-refn`) | 5 | 23.52 | 23.55 | +0.3% (−0.7 … +0.9) |

The medians of the paired changes are −0.2% to +0.9%, inside the noise floor of 0.1–0.9%. Under the cap the two pace alike:

| At 60 Hz, five runs | Before this change | Final |
|---|---:|---:|
| Deck: average FPS | 60.0 | 60.0 |
| Deck: frames over budget (%) | 0.0 | 0.0 |
| Deck: p99 (ms) | 16.8 | 16.8 |
| Deck: longest frame in any run (ms) | 16.8 | 16.8 |
| Ultra, north view: average FPS | 43.5 | 43.5 |
| Ultra, north view: frames over budget (%) | 38.1 | 37.8 |
| Ultra, north view: p99 (ms) | 33.4 | 33.4 |
| Ultra, north view: longest frame in any run (ms) | 50.0 | 33.5 |
| Ultra, deck in a storm: average FPS | 22.6 | 22.5 |
| Ultra, deck in a storm: frames over budget (%) | 100.0 | 100.0 |
| Ultra, deck in a storm: p99 (ms) | 50.1 | 50.1 |
| Ultra, deck in a storm: longest frame in any run (ms) | 66.7 | 50.1 |

**Regeneration and reloads were checked again with the delivered build**, the original taking turns with it: 16 jumps per build at 60 Hz, and six loads of the world in one tab. They agree with the regeneration table above, which is of the build before the last change:

| Measured again with the delivered build | Original | Final |
|---|---:|---:|
| Regeneration complete after, 60 Hz (ms) | 2,240 | 1,122 |
| `bake()` calls per regeneration | 135 | 68 |
| Main-thread time in `bake()` per regeneration (ms) | 98.1 | 53.0 |
| Longest frame during a regeneration, 60 Hz (ms) | 16.8 | 16.8 |
| Frames over budget during a regeneration, 60 Hz | 0 | 0 |
| Pipelines created by a regeneration | 0 | 0 |
| JS heap, highest over 8 regenerations above the first (MB) | 0.19 | 0.26 |
| GPU buffers and textures, growth over 8 regenerations (MB) | 0.00 | 0.00 |
| Geometries, textures and pipelines (three), growth over 8 regenerations | 0 | 0 |
| JS heap growth over six loads of the world in one tab (MB) | 0.04 | 0.05 |
| Renderer process footprint, first of six loads (MB) | 268 | 249 |
| Renderer process footprint, last of six loads (MB) | 289 | 266 |
| GPU process footprint, first of six loads (MB) | 1,399 | 1,390 |
| GPU process footprint, last of six loads (MB) | 1,445 | 1,414 |

### What is left of the bottlenecks

The switches of "Where the time went" again, on the final build: uncapped frame time with the thing switched off, against nothing switched off, original → final.

| Switched off | North view | Deck | Interior | Aerial |
|---|---:|---:|---:|---:|
| Lamps at zero intensity taken out of the light clusters | −2.6% → −0.8% | −17.0% → +0.0% | −22.0% → −1.7% | −4.8% → −1.5% |
| The sky | −16.0% → −9.1% | −8.1% → −7.6% | −2.9% → −1.8% | −12.9% → −5.2% |
| The ocean's simulation (frozen, still drawn) | −13.2% → −11.8% | −13.0% → −10.0% | −11.9% → −8.4% | −15.4% → −10.0% |
| The ocean's surface (simulation still running) | −28.7% → −33.4% | −10.6% → −11.1% | −10.5% → −10.5% | −39.2% → −39.9% |
| Glass | +0.2% → −1.0% | −11.6% → −4.0% | −10.5% → −4.7% | −4.1% → +1.1% |

The dark lamps cost nothing now, and glass costs less than half of what it did, presumably because it no longer runs them either. The sky is down to what is seen of it. The ocean's simulation still takes about a tenth of a shorter frame (its cost in ms roughly halved on the deck, indoors and from the air); what remains is the FFT itself and the mip chains of its textures. The sea's surface is now the largest single cost outdoors, and is as it was.

## Correctness

- **The delivered build is the one measured last.** `pnpm build` of the working tree is byte for byte the frozen build of the memory table and of "The ocean's buffers". It differs from the build of the other tables by that one change, seven buffers created empty.
- **Checks**, run again on the delivered build. `pnpm typecheck` passes. `pnpm test` passes: 138 tests in 19 files (the unit project in Node and the Workers project in workerd). `pnpm test:render` passes: 8 tests, every quality preset rendering with no console or WebGPU error, which is also the check that three took the buffers made for it. 
- **Every measurement watched for errors.** No page logged a console or page error in any run of any suite, the 206 results of the last change's runs included, and the canvas had the same size in both builds in every scenario. The report puts either at its top and exits with an error.
- **Pictures at matching seeds and viewpoints.** 28 views at 1536×1024, with a seeded `Math.random` and a stepped clock, taken at game frame 420: day, dusk and night, fair weather, fog, rain and a storm, the interior, the deck, the pool, the tender, under water, the moon and stars, the drone landing and parked, and the Low, Medium, High and Ultra presets.
  - *The original against itself:* identical or within 9/255 at every pixel in 25 views. In `lift`, `tender` and `ref-morning`, which show the tender, a few pixels on its outline differ by up to 78/255 (0.007% of the pixels at most): its pose follows asynchronous readbacks of the wave heights and is not frame-exact.
  - *The original against the final:* a mean difference of 0.003/255 over the 28 views and at most 0.019/255 in one. Outside the two close-ups of the tender, no view has more than seven pixels differing by more than 8/255. The lit interiors differ most evenly, by a hundredth of an 8-bit step on average and never by more than 8/255 apart from two pixels at dusk; that the lamps' cones are now evaluated in three's loop and the probes baked two at a time would account for it, but that was not isolated.
  - *The delivered build against the build before it* (the last change alone), from four sets taken one after another on mains, two of each build: between the builds 16 of the 28 views are identical and no pixel differs by more than 3/255, apart from the close-up `tender-windscreen` (25/255). Two sets of the same build differ by more: the build before, 12 views identical and up to 6/255 (`tender-windscreen` 25/255); the delivered build, 18 identical and up to 9/255. So the last change cannot be told from a second run in the pictures. Against the original, the delivered build has the same largest difference in every view as the build before it had, except `aerial-fog` (2/255 against 4) and that close-up (25/255 against 88): a mean of 0.002/255 over the 28 views. (A first set, taken on battery with Chrome holding pages at 30 fps, had differed from the morning's by up to 4/255; it is superseded by these.)
  - *Isolated pixels.* Sixteen single pixels in eight views (of 44 million compared) differ by 9–76/255 between the builds and not between runs of one build: glints and crests on the distant sea, the sea's first row under the horizon, and two pixels on a door frame at dusk. Their neighbours are identical. They are in the same places with the plain windscreen and the sky's cut both switched off (a variant built for this), so neither of those causes them. What is left, by elimination and not by test, is values that differ in their last bits: the ocean's FFT now runs as different shader code, and the lamp and probe code changed. A difference that small can tip one pixel's highlight, foam or anti-aliasing history.
  - *The tender close-ups* (`tender`, `tender-windscreen`), where the original transmissive windscreen is drawn in both builds: three more sets were taken of each build. Each build lands on one of two or three pictures from run to run, because the tender's pose depends on when the wave readbacks arrive. In the windscreen close-up the original gave one picture three times and another twice (32 pixels apart, of 1.57 million); the final gave the first twice, the second once, and in the set used above a third (421 pixels from the first, 0.027%). Where the outcomes match, the two builds have no pixel more than 8/255 apart in the windscreen close-up, and one or two in `tender`.
- **Seeded output.** Nothing that feeds the generated world changed: the layout, the seeded weather and the noise behind the ocean's spectrum are untouched, and the FFT does the same arithmetic per element in a different memory layout. The sea in the pictures agrees to a mean of 0.000/255, apart from the isolated pixels above.
- **In motion.** The 60 s flight crosses the windscreen's 40 m boundary (the frame copy for the transmissive pane appears part-way through the final's flight: 501.9 → 539.4 MB of textures). No pipeline or shader module is created after start-up in either build (169 render pipelines at frame 30 and at the end: `precompile()` shows hidden objects, so both panes are compiled at start-up), and no frame of any flight was a hitch. The sky's cut moves with the camera's height in the same flight (from 3 m above the sea to 70 m); below five standard deviations of wave height above mean sea level `Ocean.coversBelow` keeps the whole sky.

## Trade-offs, regressions and limits

### One change of fidelity: the tender's windscreen beyond 40 m

Within 40 m of the camera the pane is the original transmissive glass (42 m going away, 38 m coming back). Beyond that a plain transparent pane tinted to match stands in: it does not refract what is behind it, and three no longer copies the frame for it. At 40 m the pane is under 20 pixels wide at 1440p.

It is kept out of the comparison above. Four scenes show the tender from afar (north view, aerial, the flight, Ultra's north view, marked * in the tables); for those the tables compare the original with a variant of the final build that keeps the original pane at every distance (`nolod`). The same runs, all three builds taking turns in each, give the plain pane's own effect on the average frame time without the cap:

| Scene | Runs | Original (ms) | Final, original windscreen (ms) | Final (ms) | Original → original windscreen, paired (range) | Original windscreen → final, paired (range) |
|---|---:|---:|---:|---:|---:|---:|
| North view (`high-refn`) | 5 | 6.69 | 5.46 | 5.33 | −18.4% (−24.0 … −17.6) | −3.3% (−5.0 … +0.7) |
| Aerial (`high-aerial`) | 5 | 7.24 | 5.94 | 5.72 | −18.5% (−26.3 … −17.6) | −3.7% (−4.5 … +2.4) |
| 60 s flight (`high-path`) | 5 | 9.35 | 7.35 | 7.24 | −21.1% (−24.4 … −20.9) | −2.0% (−2.3 … −1.4) |
| Ultra, north view (`ultra-refn`) | 5 | 26.89 | 25.29 | 24.53 | −7.2% (−17.1 … −6.0) | −3.0% (−7.2 … +5.2) |

In those scenes the plain pane also takes 12 render passes and 11 one-triangle draws out of each frame (97 → 85 passes in the north view; with the original pane the final build has the original's 97) and 37.5 MB of texture (84 MB on Ultra), until the tender comes within 40 m. In the pictures it changes one or two pixels, by at most 14/255, in the three views with the tender far away (`aerial-golden`, `aerial-low`, `ref-morning`).

### One trade in pacing: two light probes per bake call

A re-bake completes in half the time and half the calls, and each call takes about as long on the main thread as before (0.72 → 0.78 ms at 60 Hz). The frames that carry a bake draw more: 599 draw calls in the busiest frame instead of 504. At 60 Hz that cost nothing measurable (no frame over budget, longest frame 16.8 ms, in both builds). Without the cap the frames during a re-bake are 1.1 ms longer than the rest instead of 0.55 ms, and the longest of them went from 18.1 to 25.7 ms. Four or eight probes per call would finish sooner still (0.57 s and 0.28 s in an experiment during this pass) at 2.3–4 ms per bake frame, so two.

### Regressions

- **Ultra, north view, without the cap: p99 up from 31.8 to 35.2 ms** (at equal fidelity; 35.9 ms with the plain windscreen) while the average fell 6%. In both builds the animation callback periodically blocks inside a WebGPU call without using the CPU (a Chrome trace of the north view on High shows callbacks of 7.1 ms wall and 2.4 ms CPU against the usual 5.1 and 2.4): it is waiting for Chrome's GPU process. On High this happens twice every 36 frames in the original and twice every 54 in the final, for 2–3.5 ms. On Ultra the final waits more than 6 ms 23–28 times in a 15 s run, each showing as a short frame followed by a long one, where the original does so one to four times. It comes with the single compute pass: a test build that submits the final's ocean kernels one by one has a p99 of 28.7 ms there against 35.0 ms, and is 9.9% slower on the deck at High, so the single pass stays ("The ocean's buffers" has the table). With one pass more of a frame's command buffers are in flight at once, by the measure given there; that the waits are the driver's limit on those is a reading, not something verified. At 60 Hz the two builds' p95, p99 and longest frame on Ultra are identical (33.4, 33.4 and 33.5 ms).
- **One category of the GPU process's memory is higher on Ultra**: `IOAccelerator (graphics)`, 112 → 149 MB, presumably the driver's storage for command buffers in flight, and the other side of the same single pass. The process as a whole is within 0.6% of the original's (1,372 → 1,378 MB and 1,332 → 1,341 MB on the deck and indoors, 2,798 → 2,812 MB on Ultra in a storm), and the renderer process is smaller than the original's everywhere (395 → 315 MB on Ultra). The larger regression that the first measurement found, memory kept from uploading the ocean's buffers, is gone: see "The ocean's buffers".
- **Longest frame during a regeneration, without the cap: 18.1 → 25.7 ms** (the trade above).
- **Main-thread time at 60 Hz on an idle machine is not lower** (2.3–2.9 ms before, 2.5–2.7 ms after) although the work is: see "Main thread". A player at 60 Hz on this machine gets the same frame pacing and a less busy main thread, not a shorter callback.
- **Two more render pipelines and three more shader modules** (the plain windscreen), with no measurable effect on start-up.

### Limits of the measurement

- **One machine, one browser.** An Apple M5 Pro (a tile-based deferred GPU) in headless Chrome 157 on Metal. The sky's cut pays here because the sea is drawn in a later pass; on an immediate-mode GPU the shares will differ, and things that gained nothing here (drawing the sky last, a depth pre-pass) may gain there.
- **The 60 Hz cap hides the gain on High.** The uncapped figures measure throughput in a browser that is not waiting for a display; they are not what a 60 Hz player sees, who was at 60 fps before. The headroom matters on slower GPUs, higher resolutions and displays above 60 Hz, none of which were measured.
- **GPU time was not measured** (see the method), and nothing here is inferred from JavaScript time.
- **Presets.** Timing covers High and Ultra. Low and Medium are in the pictures only.
- **Offline client only.** No server, no other players, no agents: the networked game's main-thread work (messages, avatars) is not in these numbers.
- **Cold start** is a warm browser with fragment shaders made new to the driver's cache, not a first install; the comparison is of the "usable" times only.
- **Memory.** GPU texture sizes are estimates from format and size; process footprints are whole-process figures from macOS and include the browser's own share. The GPU process's peak is its high-water mark since the browser started, not per scene.
- **Chrome's periodic wait** (above) is still there, less often.
- **The browser's processes hold more after reloads, in both builds.** After six loads of the world in one tab the renderer process held 17–25 MB more than after the first and the GPU process 24–46 MB more (three single runs, both builds alike), while the page's heap and GPU resources were level. Reloading is the only teardown the game has. This was there before the pass and was not explained.
- **Three things rest on measured constants or three's internals**, and say so in `CLAUDE.md`: `Ocean.coversBelow` assumes the wave heights measured for the current spectrum; `stableClusteredLighting.ts` overrides a private method of three's `ClusteredLightsNode` and writes into its lights texture, as it did before in another shape; and the ocean's work buffers reach three through its backend's data for an attribute. If three replaces one with a buffer of its own, the simulation logs an error after the first frame, which fails `pnpm test:render`, and frees its copy. If three stopped looking there at all, nothing would be logged and the buffers would exist twice; `pnpm bench count` shows that (GPU buffers alive on High should stay 65.3 MB).
- **Two sets of runs of the last change were made on battery.** The memory runs and the uncapped frame-time comparison with the build before (the rest of this report was on mains). Both compare builds taking turns in the same minutes, and the uncapped frame times are in the range of the earlier sessions' (the deck: 6.05 ms for the build before the change here, 6.37 ms in the main run). At about 20% charge Chrome began holding pages at 30 fps in every build, presumably its Energy Saver; everything run in that state was discarded and repeated on mains, after a capped run was seen at 60 fps again: the 60 Hz comparison, start-up, regeneration, reloads, the counts and the pictures. The machine was charging during those, and absolute times there are a few per cent longer than in the morning's sessions (the original's warm start-up: 1.31 s against 1.25 s); as elsewhere, only the builds within a session compare.

## Measured and left alone

- **The ocean textures' mip chains** (48 small render passes a frame). Without them the aerial view was 17% slower: far water then samples the 256² maps at full resolution. They stay.
- **The two framebuffer copies the sea makes for refraction**, each of which splits the scene's render pass. Removing both copies and their lookups saved 12% where sea fills the view but 1% indoors, where the copies still happen: the cost is the lookups per sea pixel, not the splits.
- **A sparser ocean mesh far out.** Half the triangles lie beyond 1.1 km; not drawing them saved at most 3% and would change the geometry.
- **Drawing the sky after the opaque geometry, splitting the merged structure into chunks, a depth pre-pass.** No gain here: within a pass this GPU (tile-based, deferred) shades only what stays visible, whatever the draw order. On an immediate-mode desktop GPU this may be worth measuring.
- **Shadows on the sea, the grass, the probe grid's sampling:** each within the noise.
- **three's own per-frame bookkeeping.** After the changes a frame still allocates 160–177 KB and takes 1.4–2.0 ms of main-thread CPU, nearly all inside three (render lists, bindings, cache keys, 34 command buffers); the game's own code is about 4.5 KB of the allocation. The largest item an override could reach, the lights' cache key, is 17 µs a frame.
- **Ultra's screen-space reflections and full-resolution ambient occlusion** (three's add-ons at their defaults) and **the pool's transmissive water** (one frame copy with mips when the pool is in view, about 3%): changing them changes the picture.
- **Start-up.** Generating the world takes 88 ms of the 1.27 s to a usable scene; compiling shaders takes 0.70 s warm and 5.3 s cold and is already spread over the loading screen (`docs/startup-shader-compile.md`). Neither was changed.

## Running it again

```bash
pnpm build && cp -R apps/client/dist/client bench-results/builds/new
pnpm bench timing --uncapped --runs 5 --build old=bench-results/builds/old --build new=bench-results/builds/new
pnpm bench thread --busy 8 --runs 2 --build old=bench-results/builds/old --build new=bench-results/builds/new
pnpm bench report
```

The header of `scripts/bench.ts` lists the suites. Keep builds and results out of `test-results`: Playwright empties it on every run.
