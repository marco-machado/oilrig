# Post-mortem: multi-second freezes in the client

**Status:** fixed, verified by the in-app test runs listed below and by the reporter's own play test. Two items are still open (see the end).
**Area:** `apps/client` (three.js 0.186.1, WebGPURenderer, TSL, clustered lighting).

## Summary

The game froze for between 0.1 and 4 seconds at a time: after a time-of-day change, while the interior light probes re-baked, when the window was resized, and at startup. Almost every freeze had the same mechanism. Something changed a value that three.js folds into the **shader cache key** of every lit material, and three then rebuilt dozens or hundreds of material shaders on the main thread in one frame (about 15–30 ms per shader).

Five different triggers changed that key:

| Trigger | What changed in the key | Typical freeze |
|---|---|---|
| Night lights hidden and shown at dusk and dawn | the set of visible lights | 1–3 s |
| Sun `castShadow` switched off at night and on at dawn | the light set (shadow flag) | ~0.5 s, then a crash (below) |
| Window resize, DevTools, dynamic resolution | the clustered-lighting tile grid (NX × NY constants) | ~1 s |
| Probe bake chunks of 15 probes | GPU time, not shader builds (see below) | ~100 ms per chunk |
| First probe bake | the bake's own light set | ~1 s, merged into the startup freeze |

One trigger also caused a **crash that corrupted the rendering state** (WGSL errors, invalid pipelines). That is described separately below, because it is the most serious finding.

## How we found it

The profiler (`apps/client/src/perf.ts`, enabled with `?perf`) was extended step by step. Each step answered one question:

1. **Frame-gap log.** Any gap over 100 ms logs a `[perf] … frame gap` line with that frame's CPU time per section and the number of new GPU pipelines.
2. **Notes.** Probe bakes, resolution changes and changes in the set of visible lights tag the frame.
3. **Shader-build counter.** `renderer.debug.onNodeBuilderCreated` wraps each `NodeBuilder.build()` to count builds and their time per frame. This showed that freezes with "0 new pipelines" were still spending 0.5–3 s building node graphs. The pipeline cache hit, but the node builds did not.
4. **Light-set diff.** When a build uses a lights cache key the profiler has not seen, it logs which lights were added or removed (`new light set: +SunLight#269 −SunLight#269(shadow)`).
5. **Rebuild reasons.** When a render object's cache key changes, three disposes it and creates a new one; it does not rebuild the old object. A counter of "rebuilds of existing objects" therefore always reads 0. The profiler now matches builds by mesh, material and render context, and notes which part of the key changed (material, lights, environment, fog, context).
6. **Tab visibility.** `tab hidden`, `tab visible` and `window lost focus` notes, so a gap from the browser pausing a background tab is not mistaken for a stall.

## Root causes and fixes

### 1. Night lights toggled `visible` (fixed earlier in the session)

`world/lights.ts` hid each night light when its intensity was near zero. Visible lights are part of every lit material's shader key, so every dusk and dawn rebuilt the scene's shaders.

**Fix:** lights only change `intensity`, never `visible`.

### 2. Sun `castShadow` toggle: shader rebuilds plus a crash that corrupted the renderer

`env/atmosphere.ts` set `sun.castShadow = irradiance > 0.5`, so it switched off at night and on at dawn. That had two effects.

- **Rebuilds:** the shadow flag is part of the light-set key, so each switch rebuilt about 31 shaders (~0.5 s).
- **Crash:** when `castShadow` goes false, three 0.186's `AnalyticLightNode` disposes the light's shadow node, which sets its shadow map to null. Shaders built earlier still referenced that node. When the sun cast shadows again, the old node's `updateBefore` ran and threw: `TypeError: Cannot read properties of null (reading 'depthTexture')` in `ShadowNode.updateShadow`.

The exception was thrown inside `PassNode.updateBefore`, between `renderer.setMRT(sceneMRT)` and the call that restores the previous value. The scene pass's multiple render target (MRT: output, normal and velocity) therefore stayed active on the renderer for **every later frame**. Every other pass then saved and restored the leaked value, so the leak never cleared. Anything rendered outside the scene pass was built against that MRT:

- The PMREM environment-map render (`atmosphere.ts:225`) built the sky, PMREM background and basic materials. None of the MRT outputs matched the PMREM target's single texture, so the fragment output struct ended up empty: `structures must have at least one member … struct OutputType`.
- The output quad pipeline was created with a second colour target that the shader did not write: `Color target has no corresponding fragment stage output`.
- Every command buffer that used those pipelines was then rejected as invalid.

**How it was pinned down:**
- Turning off the profiler's build hook did not remove the errors, so the instrumentation was not the cause.
- With probes off (`?off=probes`) the errors persisted, so the probe bake was not the cause either.
- Logging `renderer.getMRT()` and the render target on every shader build showed the PMREM builds running with the scene pass's MRT (id 5995).
- `getMRT()` was non-null at the start of 300 of 300 frames.
- A temporary trace in `main.ts`, recording every `setMRT` call per frame, showed a frame where `PassNode` set the MRT and never restored it.
- A window `error` listener then caught the `depthTexture` TypeError.

**Fix (`env/atmosphere.ts`):** `castShadow` stays `true`. When the light is too dim to cast shadows, `shadow.intensity` is set to 0 (a uniform, so no rebuild) and `shadow.autoUpdate` to false (the map stops re-rendering).

**Verified:** four time changes (20:00, 09:00, 02:00, 13:00) with probes on produced no errors, `getMRT()` was null between frames, and there were no frame gaps over 100 ms. Before the fix, each change froze for 480–540 ms and the second one produced the WGSL errors.

### 3. Clustered lighting rebuilt every lit shader on any resize

three's `ClusteredLightsNode` compiles the cluster grid size (NX × NY tiles of 32 px, from the drawing-buffer size) into every lit shader as constants. Whenever the drawing buffer changed size it rebuilt the grid and its compute node, which changed the lights cache key. A window resize, opening DevTools, or a dynamic-resolution step (1 → 0.9) therefore rebuilt every lit shader. Measured: 968 ms of CPU and 35 shader builds for one resize, with the notes `clustered-lighting compute recreated` and `new light set: same lights, other order`.

**Fix (`render/stableClusteredLighting.ts`, used in `main.ts`):** a subclass that:
- builds the grid once, from the first drawing-buffer size, and ignores later `updateProgram` and `setSize` size changes;
- finds each fragment's tile by `screenUV × (NX, NY)` instead of `screenCoordinate / 32`.

The compute side already mapped clusters to NDC through NX and NY alone, so tiles now stretch with the screen and the shaders stay valid at any size. At very different sizes, tiles are larger or smaller than 32 px. That only changes how many lights each cluster tests.

**Verified:** a resize to 700×500 caused no gap over 100 ms and no errors. Point lights still light the interior at 22:00 with no tile seams.

**Related:** the dynamic-resolution setting (`autoResolution`) was turned off by default earlier in the session for this reason (`ui/ui.ts`). With the stable grid it may be safe to turn back on. That has not been tested.

### 4. Probe bake chunk too large for the GPU

`world/interiorLight.ts` re-bakes the interior light-probe grid (135 probes) a chunk per frame. After the fixes above, a chunk of 15 probes cost only 15–20 ms of CPU and 0 shader builds, but the frame gap was still ~100 ms. Each probe renders the scene six times (a cube map), so the remaining time was GPU work. This is inferred from the CPU/gap difference; it was not measured with GPU timestamps.

**Fix:** `PER_FRAME` from 15 to 4. A full re-bake now spans about 34 frames.

**Verified:** after the change, bake chunks no longer appeared in the over-100 ms log, except one chunk right after startup (196 ms, CPU 20 ms) while the GPU was still busy.

## Mistakes made during the investigation

- **An instrumentation probe was blamed for the WGSL errors.** Reading `_compute.getCacheKey()` in the build hook was assumed to corrupt shaders, and the probe was removed. The errors continued. Only a test with the hook turned off settled it. Lesson: confirm a suspected cause by removing it and re-running before changing course.
- **The "rebuilds of existing objects" counter was wrong** (always 0), because three replaces render objects instead of rebuilding them. Fixed in `perf.ts`; see step 5 above.
- **A file was edited while the reporter was testing.** Vite reloads the page on any client source change, and the test session was lost. Rule: never edit client files while a test run is in progress.
- **The in-app browser was left open, and stuck.** After scripted tests, a leftover tab kept the desktop app's browser pane open. It was "closed" without checking `tabs_context`. In that pane Chromium also refused pointer lock with `SecurityError: The root document of this element is not valid for pointer lock.`, even on trusted clicks with focus, so the game could not be played there. That rejection comes from Chromium on macOS when the native view is not focused. It is a property of the pane, not of the game; see [playwright#20956](https://github.com/microsoft/playwright/issues/20956). A mouse-drag fallback was added without being asked for and was removed at the reporter's request.

## Files changed

- `apps/client/src/env/atmosphere.ts`: sun `castShadow` stays on; shadow intensity and auto-update instead.
- `apps/client/src/render/stableClusteredLighting.ts` (new): clustered lighting with a fixed grid size.
- `apps/client/src/main.ts`: uses `StableClusteredLighting`; profiler notes for probe bakes, resolution changes and the light set.
- `apps/client/src/world/interiorLight.ts`: 4 probes per frame; `update()` returns a description of the chunk for the profiler.
- `apps/client/src/world/lights.ts`: night lights change intensity only.
- `apps/client/src/perf.ts`: shader-build counter and time, light-set diff, rebuild reasons, compute recreation, tab visibility notes.
- `apps/client/src/ui/ui.ts`: `autoResolution` off by default; the GPU readout is labelled as a lower bound.
- `tests/e2e/perf.spec.ts`: the GPU readout is labelled as a lower bound.

## Still open

1. **Startup freeze.** One startup frame built 389 shaders and created 361 pipelines (4.2 s), including the first probe bake (1 s). The first bake uses a different light set: it swaps the sun for a temporary DirectionalLight and includes about 70 point lights the normal render leaves out. In a later run a 15.7 s gap appeared during startup with only 7 ms of CPU. It is not yet known whether that was the GPU compiling pipelines or the tab being in the background; the new visibility notes will tell. Likely fix: compile the bake's light set and the pipelines behind the loading screen.
2. **Steady-state frame time.** About 17 ms average, with a 95th percentile of 43 ms. The GPU takes about 11 ms to render and 6 ms for compute at 2490×1838 and pixel ratio 2. This is a GPU-load question, not a freeze.


Fixed after this write-up: `[perf]` lines used `console.warn`, so Chrome attached a long stack trace and printed the CPU sections as a separate collapsed array. They now use `console.log`, with the sections inline on one line (`CPU 104.1 ms [render 98.2, ocean 0.8, …]`).
