# Startup: shader and pipeline compilation

**Status:** on. three is r187 since 21 Nov 2026, and `main.ts` runs the precompile when `REVISION` is 187 or later. Of the checklist at the end, steps 1 and 2 are done; the precompile match, `PER_FRAME` and the startup timings (steps 3 to 5) have not been measured on r187.
**Area:** `apps/client` startup: the loading screen's "Compiling shaders" and "Warming up the ocean and lighting" steps.

## Summary

The "Warming up the ocean and lighting" step is the game's first frame. On three r186 that frame builds every material's shader (396 node graphs, about 3 s of CPU) and creates 367 GPU pipelines one at a time. Chrome compiles each pipeline on its GPU process's main thread and shows no frames meanwhile. When the browser has those pipelines cached from an earlier visit, that costs nothing. When it doesn't (a first visit, and after any change to the shaders), it took 15–20 s more, partly after the loading screen had gone, with the game frozen.

| Build (High, 2560×1440) | Warm: loader gone / 120 frames | Cold: loader gone / 120 frames |
|---|---|---|
| three r186, as shipped | 3.8 / 5.8 s | 7.8 / 25.4 s |
| three dev, code unchanged | 0.6 / 2.7 s | 21.7 / 23.7 s |
| three dev (+ two open PRs, below), scene pass precompiled | 0.9 / 2.85 s | 5.3 / 24.4 s |
| three dev, everything precompiled (this fix) | 1.0–1.1 / 3.0 s | 4.1–4.3 / 6.0–6.3 s |

Times drifted up by as much as 20% over the hours of measuring as the machine warmed up, so compare rows measured together. Run alternately, the shipped code and the code with the fix (switched off) loaded in the same time on r186, and the committed fix matched the prototype on three dev.

## How it was measured

- Headless Chrome with Playwright's own profile, `--enable-unsafe-webgpu --use-angle=metal`, on an Apple M5 Pro. The production build was served from disk, with `?offline&q=high` at 2560×1440.
- The time of each loading step came from the loader's text, and frame counts from `__oilrig.stats.frames`. The profiler (`perf.ts`) gave each frame's CPU time and gap.
- **Cold** runs changed a constant in the fog shader (`fogFactor` in `env/atmosphere.ts`) for every run. That makes every lit material's shader new to the GPU, the way a first visit or a shader edit does. Post-processing and compute shaders don't use fog, so they stayed cached: a real first visit is somewhat slower than "cold" here.
- **three dev** builds pointed Vite aliases for `three`, `three/webgpu`, `three/tsl` and `three/addons/*` at a checkout of three's dev branch (commit `087f01f`, 22 Oct 2026). None of this changed the repo.

## Why the first frame did all the work

1. **`renderer.compileAsync(scene, camera)` was wasted (0.7 s).** It compiles for the plain screen. Every frame renders through the post-processing scene pass, which renders one call depth deeper, and r186 keeps shader builds per call depth. So the first frame built everything again. Calling `PassNode.compileAsync()` instead doesn't help on r186: the first frame still rebuilt all 396, and the loading screen stayed up for 6.4 s instead of 3.8 s (warm).
2. **r186 compiles one object at a time.** `compileAsync()` waits for each object's pipelines before starting the next, so the GPU never compiles in parallel.
3. **The drone starts hidden** (`world/drone.ts`) until its first update, so no precompile saw its ~30 materials.
4. **The light-probe bake needs its own pipelines.** `LightProbeGrid.bake()` swaps the sun for a `DirectionalLight`, hides the grid and adds an unlit copy of it for bounce light. That makes a different light set, so the scene needs a second set of pipelines, and nothing precompiles them. Cold, that alone was about 17 s (24.4 s against 7.7 s with `?off=probes`).
5. **The first bake changes every lit shader.** Once it has baked, the grid takes part in the lighting of every lit material. A precompile run before any bake therefore compiled shaders the first frame no longer uses.

## Upstream (three r187)

Merged into three's dev branch for r187:

- [#34816](https://github.com/mrdoob/three.js/pull/34816): `compileAsync()` creates pipelines in parallel (up to 16 at a time).
- [#35014](https://github.com/mrdoob/three.js/pull/35014): shader builds are shared across call depths, so a pass reuses what `compileAsync()` built.
- [#35019](https://github.com/mrdoob/three.js/pull/35019): the cache key of shadow-casting lights no longer changes between `compileAsync()` and the first render.
- [#34909](https://github.com/mrdoob/three.js/pull/34909), [#35145](https://github.com/mrdoob/three.js/pull/35145), [#35150](https://github.com/mrdoob/three.js/pull/35150): faster probe bakes. The bake now captures 8 probes per render, through an `ArrayCamera`.

Still open, and not needed here: [#35168](https://github.com/mrdoob/three.js/pull/35168) (`PassNode.compileAsync()` with the pass's render settings) and [#35092](https://github.com/mrdoob/three.js/pull/35092) (shadow pipelines in `compileAsync()`). Without them a cold start took 6.2–6.3 s, the same as with them.

## The fix

`precompile()` in `main.ts` runs during "Compiling shaders", when three is r187 or later. Each step fixes one of the mismatches above:

1. It updates the atmosphere and lights once, so the environment map, sun and lamps are as the first frame will have them.
2. It makes every object visible and turns frustum culling off, so the hidden drone and objects outside the boot camera are compiled too.
3. `InteriorLight.compileAsync()` compiles the bake's pipelines. It copies the bake's setup: the same hidden objects, the grid hidden, its bounce grid added, the sun swapped, a half-float target, and an `ArrayCamera` of 8 probes × 6 faces.
4. It bakes the first probe, so the grid is part of the lighting the way it is in the first frame.
5. It compiles the scene pass (`pipeline.scenePass.compileAsync()`), then restores visibility and culling.

Afterwards the first frame creates 36 render pipelines. 16 of them are identical to precompiled ones (the browser has them already), and 20 are post-processing passes. The game looks the same: screenshots of four views at day and night differ from the build without the fix by at most 0.12/255 on average.

## Upgrade checklist (three r187)

1. Update `three` and `@types/three`. The precompile turns on by itself.
2. **Port `render/stableClusteredLighting.ts`.** Done: it overrides `_updateLightsTexture` and `_getLightData` (renamed in r187; a stale override stops running with no error, and the aimed downlights then light the ceiling). The fixed cluster grid is gone, since r187 keeps the grid's dimensions in uniforms and a resize no longer rebuilds lit shaders. r187's clustered lighting also reads spot-light data (`spotDirection`), so it may be able to replace the aimed point lights. That hasn't been checked. r187 also dropped `LightProbeGrid.falloff` and moved the probes half a cell inside the grid's box, so the pavilion's grid now spans the whole room, at half the intensity (the floor and ceiling used to sit halfway through the falloff). And r187 clusters lights for the bake's `ArrayCamera` itself, not for its sub-cameras, so the bake lost the downlights and the room its bounce light: in an `ArrayCamera` render, `StableClusteredLightsNode` loops over every light instead. With both, night screenshots match r186 (mean brightness 71.0 against 71.1 in the interior, 52.0 against 51.9 on the terrace).
3. **Check that the precompile still matches.** `InteriorLight.compileAsync()` depends on the bake's internals: `_updateBounceGrid()`, `_bounceGrid`, 8 probes × 6 faces per capture, and a half-float target. If three changes them, the bake builds its own pipelines again. That means a slow cold start, but no error. In the profiler, the first frame should create about 36 render pipelines, and a cold start should take about 6–7 s here, not 25.
4. **Revisit `PER_FRAME`** in `world/interiorLight.ts`. r187 renders 8 probes per capture, so baking 1 probe per frame leaves 7 slots of each capture empty, and #34909 reports bakes about 4× faster.
5. Measure cold and warm startup again, and compare night screenshots with r186.

## Limits

- One machine (Apple M5 Pro), headless Chrome on macOS (Metal). Other GPUs and browsers weren't measured.
- In the cold runs, post-processing and compute pipelines stayed cached (see above).
- The fix was verified against three's dev branch of 22 Oct 2026, and r187 may differ.
