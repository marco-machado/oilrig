# Performance pass, November 2026: full results

Every table behind [performance.md](performance.md), which has the method, the definitions and the reading of these numbers. "Original" is commit `a3ca5db`; "Final" is the working tree of this pass. Both are production builds, measured on 22 November 2026 on one Apple M5 Pro in headless Chrome 157 at 2560×1440 (3840×2160 on Ultra) by `scripts/bench.ts`.

One change was made after these runs: seven of the ocean's buffers are created empty instead of uploaded. Every section is of the final build before that change except the last group, "The ocean's buffers", which has the delivered build beside the other two. The main report's memory, start-up and resource-count tables are taken from that last group, not from the sections of the same names before it.

The sections down to the reloads are the output of `pnpm bench report`. The rest are tables made for this document from the same kind of results: three-build `timing` runs (whose own summary prints the same paired changes), the `ablate` suite and the `diff` suite. The raw results (per-frame intervals included) are in `bench-results/final`, which is not tracked. `nolod` is the final build with `WINDSCREEN_NEAR_M` in `world/tender.ts` set to `Infinity`, so the original windscreen is drawn at every distance.

How to read them:

- A value is the median over runs of that run's statistic; "Runs" gives the smallest and largest run.
- **60 Hz cap** tables show what a 60 Hz display shows; frame times there are multiples of 16.7 ms. **No frame cap** tables show throughput.
- A frame is over budget above 17.2 ms and a hitch above 41.7 ms. In a scene that runs below 24 fps every frame is a "hitch" by that definition (Ultra in a storm).
- In the sections from the harness's report, "Final" is the final build as it is, with the plain windscreen beyond 40 m. Four scenes show the tender from afar (`high-refn`, `high-aerial`, `high-path`, `ultra-refn`); their comparison at equal fidelity is in the "Equal fidelity" sections, which add a third build, `nolod`: the final build with the original windscreen at every distance.
- "Time inside animation callbacks" in the capped tables is wall time on an otherwise idle machine. It is not a measure of work: see the "Main thread" sections and the method.
- Counts are counts; MB of GPU buffers are the sizes the game asked for; MB of GPU textures are an estimate from format, size and mip count; process footprints are macOS's `phys_footprint` for the whole process.

## Frame pacing, 60 Hz cap (5 runs per build, Chrome 157.0.8103.79 headless, 2560x1440 @1x)

### high-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.80 | 16.70 | -0.10 | -0.6% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.89 | 2.65 | -0.24 | -8.3% | 2.85–2.93 / 2.59–2.74 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-deck

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.61 | 2.47 | -0.14 | -5.4% | 2.55–2.67 / 2.40–2.63 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-interior

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.53 | 2.67 | +0.14 | +5.5% | 2.44–2.55 / 2.61–2.88 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-aerial

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.80 | 16.70 | -0.10 | -0.6% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.90 | 2.64 | -0.26 | -9.0% | 2.85–2.93 / 2.56–2.71 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-swim

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.33 | 2.65 | +0.32 | +13.7% | 2.32–2.40 / 2.63–2.69 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-pad

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.69 | 2.66 | -0.03 | -1.1% | 2.67–2.77 / 2.60–2.69 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### ultra-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 42.5 | 46.4 | +3.9 | +9.2% | 42.3–42.5 / 46.2–46.5 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 33.40 | 33.40 | +0.00 | +0.0% | 33.40–33.40 / 33.40–33.40 |
| frame time, p99 (ms) | 33.40 | 33.40 | +0.00 | +0.0% | 33.40–33.40 / 33.40–33.40 |
| frames over the 16.7 ms budget (%) | 41.19 | 29.35 | -11.84 | -28.7% | 41.13–41.86 / 28.98–29.87 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.30 | 1.96 | -0.34 | -14.8% | 2.20–2.35 / 1.94–1.98 |
| longest frame in any run (ms) | 33.5 | 33.5 | +0.0 | +0.0% |

### ultra-deck-storm

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 23.1 | 24.2 | +1.1 | +4.8% | 21.6–23.2 / 24.0–24.4 |
| frame time, median (ms) | 50.00 | 33.40 | -16.60 | -33.2% | 49.90–50.00 / 33.40–49.90 |
| frame time, p95 (ms) | 50.10 | 50.10 | +0.00 | +0.0% | 50.10–50.10 / 50.10–50.10 |
| frame time, p99 (ms) | 50.10 | 50.10 | +0.00 | +0.0% | 50.10–50.10 / 50.10–50.10 |
| frames over the 16.7 ms budget (%) | 100.00 | 100.00 | +0.00 | +0.0% | 100.00–100.00 / 100.00–100.00 |
| hitches over 41.7 ms (per minute) | 824.03 | 691.10 | -132.93 | -16.1% | 812.94–1003.38 / 676.78–721.64 |
| time inside animation callbacks per frame, wall clock (ms) | 1.86 | 1.55 | -0.31 | -16.7% | 1.80–1.89 / 1.52–1.57 |
| longest frame in any run (ms) | 66.7 | 50.1 | -16.6 | -24.9% |

### high-lounge-night

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.80 | 16.70 | -0.10 | -0.6% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.55 | 2.70 | +0.15 | +5.9% | 2.50–2.71 / 2.69–2.76 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-interior-night

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.58 | 2.64 | +0.06 | +2.3% | 2.44–2.65 / 2.55–2.73 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-pad-drone-rain

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.70–16.80 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.64 | 2.58 | -0.06 | -2.3% | 2.57–2.83 / 2.53–2.70 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

### high-path

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 60.0 | 60.0 | +0.0 | +0.0% | 60.0–60.0 / 60.0–60.0 |
| frame time, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.70 |
| frame time, p95 (ms) | 16.70 | 16.70 | +0.00 | +0.0% | 16.70–16.70 / 16.70–16.80 |
| frame time, p99 (ms) | 16.80 | 16.80 | +0.00 | +0.0% | 16.80–16.80 / 16.80–16.80 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| time inside animation callbacks per frame, wall clock (ms) | 2.69 | 2.58 | -0.11 | -4.1% | 2.64–2.77 / 2.55–2.62 |
| longest frame in any run (ms) | 16.8 | 16.8 | +0.0 | +0.0% |

## Frame pacing, no frame cap (5 runs per build, Chrome 157.0.8103.79 headless, 2560x1440 @1x)

### high-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 150.4 | 188.6 | +38.3 | +25.5% | 149.6–176.8 / 188.4–226.2 |
| frame time, average (ms) | 6.65 | 5.30 | -1.35 | -20.3% | 5.65–6.69 / 4.42–5.31 |
| frame time, median (ms) | 6.50 | 5.20 | -1.30 | -20.0% | 5.60–6.60 / 4.40–5.20 |
| frame time, p95 (ms) | 8.40 | 6.20 | -2.20 | -26.2% | 7.60–8.60 / 4.70–6.60 |
| frame time, p99 (ms) | 10.00 | 9.60 | -0.40 | -4.0% | 7.90–10.90 / 7.10–9.90 |
| frames over the 16.7 ms budget (%) | 0.31 | 0.11 | -0.20 | -64.5% | 0.04–0.49 / 0.00–0.21 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 35.3 | 36.1 | +0.8 | +2.3% |

Paired by run, average frame time changes by -20.8% (runs: -21.8% to -20.3%).

### high-deck

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 119.3 | 156.9 | +37.5 | +31.5% | 117.7–139.3 / 156.7–182.6 |
| frame time, average (ms) | 8.38 | 6.37 | -2.01 | -24.0% | 7.18–8.49 / 5.48–6.38 |
| frame time, median (ms) | 8.30 | 6.30 | -2.00 | -24.1% | 7.20–8.40 / 5.50–6.30 |
| frame time, p95 (ms) | 10.40 | 7.30 | -3.10 | -29.8% | 8.90–10.40 / 5.90–7.70 |
| frame time, p99 (ms) | 11.50 | 9.60 | -1.90 | -16.5% | 9.40–11.60 / 8.10–9.80 |
| frames over the 16.7 ms budget (%) | 0.06 | 0.00 | -0.06 | -100.0% | 0.00–0.50 / 0.00–0.09 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 26.1 | 24.2 | -1.9 | -7.3% |

Paired by run, average frame time changes by -23.9% (runs: -25.0% to -23.7%).

### high-interior

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 87.3 | 118.0 | +30.8 | +35.3% | 86.8–98.0 / 115.9–122.5 |
| frame time, average (ms) | 11.46 | 8.47 | -2.99 | -26.1% | 10.20–11.52 / 8.16–8.63 |
| frame time, median (ms) | 11.50 | 8.50 | -3.00 | -26.1% | 10.20–11.50 / 8.20–8.60 |
| frame time, p95 (ms) | 13.20 | 9.00 | -4.20 | -31.8% | 11.90–13.30 / 8.70–9.30 |
| frame time, p99 (ms) | 14.10 | 10.90 | -3.20 | -22.7% | 12.40–14.30 / 10.40–11.70 |
| frames over the 16.7 ms budget (%) | 0.31 | 0.11 | -0.20 | -64.5% | 0.15–0.38 / 0.00–0.12 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 32.4 | 26.0 | -6.4 | -19.8% |

Paired by run, average frame time changes by -25.5% (runs: -26.3% to -20.0%).

### high-aerial

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 138.8 | 178.0 | +39.2 | +28.2% | 131.9–140.4 / 176.3–178.8 |
| frame time, average (ms) | 7.20 | 5.62 | -1.58 | -21.9% | 7.12–7.58 / 5.59–5.67 |
| frame time, median (ms) | 7.10 | 5.60 | -1.50 | -21.1% | 7.10–7.50 / 5.50–5.60 |
| frame time, p95 (ms) | 9.30 | 6.50 | -2.80 | -30.1% | 9.00–10.00 / 6.10–7.70 |
| frame time, p99 (ms) | 10.90 | 9.50 | -1.40 | -12.8% | 9.80–11.60 / 9.00–10.70 |
| frames over the 16.7 ms budget (%) | 0.38 | 0.07 | -0.31 | -81.6% | 0.00–0.46 / 0.00–0.23 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 37.4 | 36.6 | -0.8 | -2.1% |

Paired by run, average frame time changes by -21.5% (runs: -26.0% to -21.4%).

### high-swim

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 96.6 | 116.0 | +19.4 | +20.1% | 88.9–97.4 / 105.6–116.7 |
| frame time, average (ms) | 10.35 | 8.62 | -1.73 | -16.7% | 10.26–11.25 / 8.57–9.47 |
| frame time, median (ms) | 10.20 | 8.40 | -1.80 | -17.6% | 10.10–11.00 / 8.30–9.20 |
| frame time, p95 (ms) | 12.30 | 10.00 | -2.30 | -18.7% | 12.10–13.30 / 9.90–10.90 |
| frame time, p99 (ms) | 14.00 | 11.80 | -2.20 | -15.7% | 13.50–15.10 / 11.70–12.80 |
| frames over the 16.7 ms budget (%) | 0.21 | 0.12 | -0.09 | -42.9% | 0.14–0.23 / 0.06–0.23 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 30.8 | 27.5 | -3.3 | -10.7% |

Paired by run, average frame time changes by -16.7% (runs: -16.9% to -15.8%).

### high-pad

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 106.9 | 132.6 | +25.8 | +24.1% | 100.3–108.1 / 122.9–134.1 |
| frame time, average (ms) | 9.36 | 7.54 | -1.82 | -19.4% | 9.25–9.97 / 7.45–8.14 |
| frame time, median (ms) | 9.30 | 7.50 | -1.80 | -19.4% | 9.20–9.90 / 7.40–8.10 |
| frame time, p95 (ms) | 11.10 | 8.10 | -3.00 | -27.0% | 10.90–11.60 / 8.00–8.80 |
| frame time, p99 (ms) | 12.40 | 10.20 | -2.20 | -17.7% | 12.10–13.20 / 10.00–10.90 |
| frames over the 16.7 ms budget (%) | 0.06 | 0.00 | -0.06 | -100.0% | 0.00–0.20 / 0.00–0.05 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 28.8 | 18.2 | -10.6 | -36.8% |

Paired by run, average frame time changes by -19.5% (runs: -19.6% to -18.4%).

### ultra-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 36.8 | 40.8 | +4.0 | +10.9% | 34.7–37.4 / 39.2–41.1 |
| frame time, average (ms) | 27.20 | 24.52 | -2.68 | -9.9% | 26.74–28.79 / 24.30–25.52 |
| frame time, median (ms) | 26.90 | 24.20 | -2.70 | -10.0% | 26.30–28.50 / 23.90–25.10 |
| frame time, p95 (ms) | 30.10 | 28.70 | -1.40 | -4.7% | 29.70–32.00 / 28.10–29.50 |
| frame time, p99 (ms) | 31.60 | 35.80 | +4.20 | +13.3% | 31.10–34.30 / 35.70–36.50 |
| frames over the 16.7 ms budget (%) | 99.82 | 96.56 | -3.26 | -3.3% | 99.62–100.00 / 96.26–98.02 |
| hitches over 41.7 ms (per minute) | 0.00 | 4.00 | +4.00 | n/a | 0.00–8.00 / 0.00–8.01 |
| longest frame in any run (ms) | 54.6 | 43.5 | -11.1 | -20.3% |

Paired by run, average frame time changes by -10.2% (runs: -11.4% to -8.3%).

### ultra-deck-storm

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 21.0 | 21.8 | +0.8 | +3.8% | 20.9–21.2 / 21.3–22.0 |
| frame time, average (ms) | 47.63 | 45.90 | -1.73 | -3.6% | 47.09–47.92 / 45.54–47.05 |
| frame time, median (ms) | 48.40 | 45.90 | -2.50 | -5.2% | 47.80–48.80 / 45.40–46.60 |
| frame time, p95 (ms) | 51.20 | 49.60 | -1.60 | -3.1% | 50.80–51.70 / 48.00–51.70 |
| frame time, p99 (ms) | 55.20 | 52.80 | -2.40 | -4.3% | 53.20–66.60 / 51.90–65.10 |
| frames over the 16.7 ms budget (%) | 98.41 | 99.69 | +1.28 | +1.3% | 98.10–98.43 / 99.69–99.70 |
| hitches over 41.7 ms (per minute) | 1201.98 | 1250.66 | +48.68 | +4.0% | 1177.87–1211.79 / 1183.42–1269.81 |
| longest frame in any run (ms) | 87.9 | 98.9 | +11.0 | +12.5% |

Paired by run, average frame time changes by -3.3% (runs: -4.2% to -1.3%).

### high-lounge-night

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 111.4 | 129.5 | +18.0 | +16.2% | 108.5–112.2 / 128.7–130.5 |
| frame time, average (ms) | 8.97 | 7.72 | -1.25 | -13.9% | 8.91–9.22 / 7.66–7.77 |
| frame time, median (ms) | 8.90 | 7.70 | -1.20 | -13.5% | 8.80–9.20 / 7.60–7.80 |
| frame time, p95 (ms) | 10.70 | 8.30 | -2.40 | -22.4% | 10.50–10.90 / 8.20–8.30 |
| frame time, p99 (ms) | 11.80 | 10.20 | -1.60 | -13.6% | 11.60–12.10 / 10.10–10.20 |
| frames over the 16.7 ms budget (%) | 0.12 | 0.00 | -0.12 | -100.0% | 0.00–0.24 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 29.1 | 15.9 | -13.2 | -45.4% |

Paired by run, average frame time changes by -14.1% (runs: -16.3% to -13.4%).

### high-interior-night

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 88.5 | 107.3 | +18.7 | +21.1% | 88.4–88.8 / 106.9–108.8 |
| frame time, average (ms) | 11.30 | 9.32 | -1.98 | -17.5% | 11.26–11.31 / 9.19–9.35 |
| frame time, median (ms) | 11.30 | 9.30 | -2.00 | -17.7% | 11.20–11.30 / 9.20–9.30 |
| frame time, p95 (ms) | 13.10 | 9.80 | -3.30 | -25.2% | 12.90–13.20 / 9.60–10.00 |
| frame time, p99 (ms) | 14.10 | 11.70 | -2.40 | -17.0% | 13.80–14.40 / 11.50–11.90 |
| frames over the 16.7 ms budget (%) | 0.23 | 0.18 | -0.05 | -21.7% | 0.15–0.38 / 0.06–0.25 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 30.4 | 27.9 | -2.5 | -8.2% |

Paired by run, average frame time changes by -17.5% (runs: -18.4% to -17.3%).

### high-pad-drone-rain

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 130.8 | 150.8 | +20.0 | +15.3% | 129.6–131.5 / 150.3–151.3 |
| frame time, average (ms) | 7.65 | 6.63 | -1.02 | -13.3% | 7.60–7.72 / 6.61–6.65 |
| frame time, median (ms) | 7.60 | 6.60 | -1.00 | -13.2% | 7.60–7.70 / 6.60–6.60 |
| frame time, p95 (ms) | 9.40 | 7.30 | -2.10 | -22.3% | 9.40–9.60 / 7.20–7.40 |
| frame time, p99 (ms) | 10.30 | 9.30 | -1.00 | -9.7% | 10.20–10.60 / 9.30–9.50 |
| frames over the 16.7 ms budget (%) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.05 / 0.00–0.00 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 20.4 | 16.5 | -3.9 | -19.1% |

Paired by run, average frame time changes by -13.5% (runs: -14.1% to -12.5%).

### high-path

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| average FPS | 105.9 | 137.7 | +31.7 | +30.0% | 105.4–106.7 / 136.9–138.0 |
| frame time, average (ms) | 9.44 | 7.26 | -2.18 | -23.1% | 9.37–9.49 / 7.25–7.30 |
| frame time, median (ms) | 9.00 | 7.20 | -1.80 | -20.0% | 9.00–9.10 / 7.20–7.30 |
| frame time, p95 (ms) | 13.00 | 9.90 | -3.10 | -23.8% | 12.90–13.10 / 9.90–10.00 |
| frame time, p99 (ms) | 15.00 | 11.70 | -3.30 | -22.0% | 14.50–15.10 / 11.40–11.70 |
| frames over the 16.7 ms budget (%) | 0.35 | 0.07 | -0.28 | -80.0% | 0.16–0.36 / 0.05–0.10 |
| hitches over 41.7 ms (per minute) | 0.00 | 0.00 | +0.00 | n/a | 0.00–0.00 / 0.00–0.00 |
| longest frame in any run (ms) | 37.6 | 35.2 | -2.4 | -6.4% |

Paired by run, average frame time changes by -23.0% (runs: -23.5% to -22.4%).

## Startup (cam=refn&hour=11&weather=fair&q=high; time from navigation start)

### warm start (5 runs per build)

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| usable scene: third frame (ms) | 1264 | 1234 | -30 | -2.4% | 1251–1286 / 1221–1247 |
| first frame (ms) | 1188 | 1146 | -42 | -3.5% | 1175–1192 / 1143–1160 |
| 120 frames (ms) | 3206 | 3171 | -35 | -1.1% | 3189–3222 / 3156–3189 |
| light probes all baked (ms) | 3435 | 2286 | -1149 | -33.4% | 3420–3452 / 2271–2303 |
| generating the world (ms) | 85 | 84 | -1 | -1.2% | 84–87 / 84–99 |
| compiling shaders (ms) | 676 | 673 | -3 | -0.4% | 675–678 / 659–688 |
| first frames behind the loader (ms) | 395 | 367 | -28 | -7.1% | 388–411 / 361–373 |
| main-thread blocking until usable: long tasks over 50 ms, summed excess (ms) | 330 | 300 | -30 | -9.1% | 326–345 / 298–310 |
| longest main-thread task until usable (ms) | 290 | 258 | -32 | -11.0% | 286–291 / 257–259 |

### cold start (5 runs per build)

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| usable scene: third frame (ms) | 7066 | 6993 | -73 | -1.0% | 6977–7168 / 5842–7048 |
| first frame (ms) | 5685 | 5628 | -57 | -1.0% | 5615–5790 / 5565–5644 |
| 120 frames (ms) | 9095 | 9021 | -74 | -0.8% | 9020–9205 / 8954–9077 |
| light probes all baked (ms) | 9326 | 8136 | -1190 | -12.8% | 9251–9436 / 8069–8192 |
| generating the world (ms) | 85 | 85 | +0 | +0.0% | 83–86 / 81–85 |
| compiling shaders (ms) | 5168 | 5140 | -28 | -0.5% | 5115–5294 / 5076–5158 |
| first frames behind the loader (ms) | 1684 | 1658 | -26 | -1.5% | 1663–1739 / 572–1706 |
| main-thread blocking until usable: long tasks over 50 ms, summed excess (ms) | 335 | 298 | -37 | -11.0% | 332–339 / 297–317 |
| longest main-thread task until usable (ms) | 288 | 263 | -25 | -8.7% | 283–292 / 260–270 |
| fragment shaders made new to the driver’s cache | 160 | 160 | +0 | +0.0% | 160–160 / 160–160 |

## Regeneration, 60 Hz cap (time and weather jumps; 16 per build)

### per jump: the sky’s environment map, the ocean’s spectrum and a full re-bake of the light probes

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| regeneration complete after (ms) | 2243 | 1124 | -1119 | -49.9% |
| bake() calls | 135 | 68 | -67 | -49.6% |
| main-thread time in bake(), total (ms) | 97.4 | 52.8 | -44.6 | -45.8% |
| main-thread time in bake(), longest call (ms) | 1.0 | 1.0 | +0.0 | +0.0% |
| frame time meanwhile, median (ms) | 16.70 | 16.70 | +0.00 | +0.0% |
| frame time meanwhile, median, above the median of the rest of the window (ms) | 0.00 | 0.00 | +0.00 | n/a |
| frame time meanwhile, p95 (ms) | 16.75 | 16.75 | +0.00 | +0.0% |
| frame time meanwhile, longest (ms) | 16.80 | 16.80 | +0.00 | +0.0% |
| frames over budget meanwhile | 0.0 | 0.0 | +0.0 | n/a |
| draw calls in the busiest frame | 504 | 599 | +95 | +18.8% |

### memory over the jumps (growth from the first to the last)

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| JS heap after GC (MB), at the end | 69.01 | 68.64 | -0.37 | -0.5% |
| JS heap after GC (MB), growth | 0.20 | 0.25 | +0.05 | +28.2% |
| GPU buffers alive (MB, measured sizes), at the end | 65.26 | 65.26 | -0.00 | -0.0% |
| GPU buffers alive (MB, measured sizes), growth | -0.00 | 0.00 | +0.00 | +-100.0% |
| GPU textures alive (MB, estimate from format and size), at the end | 501.9 | 501.9 | -0.0 | -0.0% |
| GPU textures alive (MB, estimate from format and size), growth | 0.0 | 0.0 | +0.0 | n/a |
| textures (three’s count), at the end | 61 | 60 | -1 | -1.6% |
| textures (three’s count), growth | 0 | 0 | +0 | n/a |
| geometries (three’s count), at the end | 132 | 132 | +0 | +0.0% |
| geometries (three’s count), growth | 0 | 0 | +0 | n/a |
| pipelines (three’s count), at the end | 348 | 160 | -188 | -54.0% |
| pipelines (three’s count), growth | 0 | 0 | +0 | n/a |

## Regeneration, no frame cap (time and weather jumps; 8 per build)

### per jump: the sky’s environment map, the ocean’s spectrum and a full re-bake of the light probes

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| regeneration complete after (ms) | 1253 | 598 | -655 | -52.3% |
| bake() calls | 135 | 68 | -67 | -49.6% |
| main-thread time in bake(), total (ms) | 248.6 | 153.8 | -94.9 | -38.2% |
| main-thread time in bake(), longest call (ms) | 5.7 | 7.2 | +1.5 | +25.4% |
| frame time meanwhile, median (ms) | 8.85 | 7.85 | -1.00 | -11.3% |
| frame time meanwhile, median, above the median of the rest of the window (ms) | 0.55 | 1.10 | +0.55 | +100.0% |
| frame time meanwhile, p95 (ms) | 13.15 | 13.00 | -0.15 | -1.1% |
| frame time meanwhile, longest (ms) | 18.15 | 25.70 | +7.55 | +41.6% |
| frames over budget meanwhile | 1.0 | 1.0 | +0.0 | +0.0% |
| draw calls in the busiest frame | 504 | 599 | +95 | +18.8% |

### memory over the jumps (growth from the first to the last)

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| JS heap after GC (MB), at the end | 69.75 | 69.47 | -0.28 | -0.4% |
| JS heap after GC (MB), growth | 0.13 | 0.30 | +0.17 | +136.0% |
| GPU buffers alive (MB, measured sizes), at the end | 65.26 | 65.26 | -0.00 | -0.0% |
| GPU buffers alive (MB, measured sizes), growth | 0.00 | 0.00 | -0.00 | -100.0% |
| GPU textures alive (MB, estimate from format and size), at the end | 501.9 | 501.9 | -0.0 | -0.0% |
| GPU textures alive (MB, estimate from format and size), growth | 0.0 | 0.0 | +0.0 | n/a |
| textures (three’s count), at the end | 61 | 60 | -1 | -1.6% |
| textures (three’s count), growth | 0 | 0 | +0 | n/a |
| geometries (three’s count), at the end | 132 | 132 | +0 | +0.0% |
| geometries (three’s count), growth | 0 | 0 | +0 | n/a |
| pipelines (three’s count), at the end | 348 | 160 | -188 | -54.0% |
| pipelines (three’s count), growth | 0 | 0 | +0 | n/a |

## Work per frame and resources (WebGPU calls counted in the page; medians over the frames of the window)

### high-refn

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 326 | 315 | -11 | -3.4% |
| triangles per frame, all passes | 970813 | 970802 | -11 | -0.0% |
| render passes per frame | 97 | 85 | -12 | -12.4% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 213 | 211 | -2 | -0.9% |
| buffer uploads per frame (KB) | 14.9 | 14.9 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 539.4 | 501.9 | -37.5 | -7.0% |
| GPU textures, peak (MB, estimate) | 539.4 | 501.9 | -37.5 | -7.0% |
| GPU buffers alive (MB, measured sizes) | 65.31 | 65.31 | -0.00 | -0.0% |
| JS heap after GC (MB) | 82.8 | 81.8 | -1.1 | -1.3% |
| renderer process footprint (MB) | 279 | 283 | +4 | +1.4% |
| renderer process footprint, peak (MB) | 428 | 423 | -5 | -1.2% |
| GPU process footprint (MB) | 1380 | 1352 | -28 | -2.0% |
| GPU process footprint, peak since the browser started (MB) | 1470 | 1478 | +8 | +0.5% |

### high-deck

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 289 | 289 | +0 | +0.0% |
| triangles per frame, all passes | 969008 | 969008 | +0 | +0.0% |
| render passes per frame | 85 | 85 | +0 | +0.0% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 118 | 116 | -2 | -1.7% |
| buffer uploads per frame (KB) | 9.2 | 9.2 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 501.9 | 501.9 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 501.9 | 501.9 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.26 | 65.26 | -0.00 | -0.0% |
| JS heap after GC (MB) | 68.6 | 68.2 | -0.4 | -0.6% |
| renderer process footprint (MB) | 269 | 279 | +10 | +3.7% |
| renderer process footprint, peak (MB) | 393 | 401 | +8 | +2.0% |
| GPU process footprint (MB) | 1365 | 1391 | +26 | +1.9% |
| GPU process footprint, peak since the browser started (MB) | 1510 | 1494 | -16 | -1.1% |

### high-interior

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 264 | 264 | +0 | +0.0% |
| triangles per frame, all passes | 964737 | 964737 | +0 | +0.0% |
| render passes per frame | 73 | 73 | +0 | +0.0% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 101 | 99 | -2 | -2.0% |
| buffer uploads per frame (KB) | 8.2 | 8.2 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.25 | 65.25 | -0.00 | -0.0% |
| JS heap after GC (MB) | 64.9 | 64.5 | -0.3 | -0.5% |
| renderer process footprint (MB) | 256 | 267 | +11 | +4.3% |
| renderer process footprint, peak (MB) | 391 | 400 | +9 | +2.3% |
| GPU process footprint (MB) | 1327 | 1349 | +22 | +1.7% |
| GPU process footprint, peak since the browser started (MB) | 1510 | 1494 | -16 | -1.1% |

### high-aerial

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 336 | 325 | -11 | -3.3% |
| triangles per frame, all passes | 994547 | 994536 | -11 | -0.0% |
| render passes per frame | 97 | 85 | -12 | -12.4% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 213 | 211 | -2 | -0.9% |
| buffer uploads per frame (KB) | 14.9 | 14.9 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 539.4 | 501.9 | -37.5 | -7.0% |
| GPU textures, peak (MB, estimate) | 539.4 | 501.9 | -37.5 | -7.0% |
| GPU buffers alive (MB, measured sizes) | 65.31 | 65.31 | -0.00 | -0.0% |
| JS heap after GC (MB) | 82.8 | 81.8 | -1.1 | -1.3% |
| renderer process footprint (MB) | 288 | 282 | -6 | -2.1% |
| renderer process footprint, peak (MB) | 424 | 420 | -4 | -0.9% |
| GPU process footprint (MB) | 1393 | 1367 | -26 | -1.9% |
| GPU process footprint, peak since the browser started (MB) | 1510 | 1508 | -2 | -0.1% |

### high-swim

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 246 | 246 | +0 | +0.0% |
| triangles per frame, all passes | 964089 | 964089 | +0 | +0.0% |
| render passes per frame | 73 | 73 | +0 | +0.0% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 98 | 96 | -2 | -2.0% |
| buffer uploads per frame (KB) | 8.0 | 8.0 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.24 | 65.24 | -0.00 | -0.0% |
| JS heap after GC (MB) | 64.0 | 63.7 | -0.3 | -0.5% |
| renderer process footprint (MB) | 264 | 263 | -1 | -0.4% |
| renderer process footprint, peak (MB) | 390 | 386 | -4 | -1.0% |
| GPU process footprint (MB) | 1339 | 1357 | +18 | +1.3% |
| GPU process footprint, peak since the browser started (MB) | 1510 | 1508 | -2 | -0.1% |

### high-pad

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 282 | 282 | +0 | +0.0% |
| triangles per frame, all passes | 1038115 | 1038115 | +0 | +0.0% |
| render passes per frame | 73 | 73 | +0 | +0.0% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 141 | 139 | -2 | -1.4% |
| buffer uploads per frame (KB) | 10.5 | 10.5 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.26 | 65.26 | -0.00 | -0.0% |
| JS heap after GC (MB) | 73.0 | 72.5 | -0.6 | -0.8% |
| renderer process footprint (MB) | 269 | 275 | +6 | +2.2% |
| renderer process footprint, peak (MB) | 404 | 400 | -4 | -1.0% |
| GPU process footprint (MB) | 1338 | 1368 | +30 | +2.2% |
| GPU process footprint, peak since the browser started (MB) | 1510 | 1508 | -2 | -0.1% |

### ultra-refn

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 380 | 369 | -11 | -2.9% |
| triangles per frame, all passes | 1605515 | 1605504 | -11 | -0.0% |
| render passes per frame | 109 | 97 | -12 | -11.0% |
| compute passes per frame | 22 | 2 | -20 | -90.9% |
| compute dispatches per frame | 235 | 23 | -212 | -90.2% |
| command buffers submitted per frame | 58 | 38 | -20 | -34.5% |
| buffer uploads per frame (calls) | 218 | 216 | -2 | -0.9% |
| buffer uploads per frame (KB) | 15.0 | 15.0 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 0.20 | 0.00 | -0.20 | -100.0% |
| render pipelines created (GPU) | 176 | 178 | +2 | +1.1% |
| compute pipelines created (GPU) | 246 | 34 | -212 | -86.2% |
| shader modules created (GPU) | 303 | 306 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 233 | 236 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 64 | 63 | -1 | -1.6% |
| GPU textures alive (count) | 66 | 65 | -1 | -1.5% |
| GPU textures alive (MB, estimate from format and size) | 1597.6 | 1513.2 | -84.4 | -5.3% |
| GPU textures, peak (MB, estimate) | 1597.6 | 1513.2 | -84.4 | -5.3% |
| GPU buffers alive (MB, measured sizes) | 164.81 | 164.81 | -0.00 | -0.0% |
| JS heap after GC (MB) | 83.1 | 82.0 | -1.1 | -1.3% |
| renderer process footprint (MB) | 434 | 438 | +4 | +0.9% |
| renderer process footprint, peak (MB) | 556 | 559 | +3 | +0.5% |
| GPU process footprint (MB) | 2900 | 2873 | -27 | -0.9% |
| GPU process footprint, peak since the browser started (MB) | 3003 | 2964 | -39 | -1.3% |

### ultra-deck-storm

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 302 | 302 | +0 | +0.0% |
| triangles per frame, all passes | 1593492 | 1593492 | +0 | +0.0% |
| render passes per frame | 97 | 97 | +0 | +0.0% |
| compute passes per frame | 22 | 2 | -20 | -90.9% |
| compute dispatches per frame | 235 | 23 | -212 | -90.2% |
| command buffers submitted per frame | 58 | 38 | -20 | -34.5% |
| buffer uploads per frame (calls) | 146 | 144 | -2 | -1.4% |
| buffer uploads per frame (KB) | 9.4 | 9.4 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 0.20 | 0.00 | -0.20 | -100.0% |
| render pipelines created (GPU) | 176 | 178 | +2 | +1.1% |
| compute pipelines created (GPU) | 246 | 34 | -212 | -86.2% |
| shader modules created (GPU) | 303 | 306 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 233 | 236 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 64 | 63 | -1 | -1.6% |
| GPU textures alive (count) | 66 | 65 | -1 | -1.5% |
| GPU textures alive (MB, estimate from format and size) | 1513.2 | 1513.2 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 1513.2 | 1513.2 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 164.76 | 164.76 | -0.00 | -0.0% |
| JS heap after GC (MB) | 68.8 | 68.3 | -0.5 | -0.7% |
| renderer process footprint (MB) | 405 | 442 | +37 | +9.1% |
| renderer process footprint, peak (MB) | 518 | 553 | +35 | +6.8% |
| GPU process footprint (MB) | 2792 | 2872 | +80 | +2.9% |
| GPU process footprint, peak since the browser started (MB) | 3003 | 2968 | -35 | -1.2% |

### high-lounge-night

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 273 | 273 | +0 | +0.0% |
| triangles per frame, all passes | 965197 | 965197 | +0 | +0.0% |
| render passes per frame | 73 | 73 | +0 | +0.0% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 115 | 113 | -2 | -1.7% |
| buffer uploads per frame (KB) | 8.7 | 8.7 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.26 | 65.25 | -0.00 | -0.0% |
| JS heap after GC (MB) | 66.2 | 65.9 | -0.4 | -0.5% |
| renderer process footprint (MB) | 262 | 271 | +9 | +3.4% |
| renderer process footprint, peak (MB) | 398 | 395 | -3 | -0.8% |
| GPU process footprint (MB) | 1335 | 1356 | +21 | +1.6% |
| GPU process footprint, peak since the browser started (MB) | 3003 | 2968 | -35 | -1.2% |

### high-interior-night

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 264 | 264 | +0 | +0.0% |
| triangles per frame, all passes | 964737 | 964737 | +0 | +0.0% |
| render passes per frame | 73 | 73 | +0 | +0.0% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 101 | 99 | -2 | -2.0% |
| buffer uploads per frame (KB) | 8.2 | 8.2 | -0.0 | -0.1% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.25 | 65.25 | -0.00 | -0.0% |
| JS heap after GC (MB) | 64.9 | 64.5 | -0.3 | -0.5% |
| renderer process footprint (MB) | 267 | 269 | +2 | +0.7% |
| renderer process footprint, peak (MB) | 395 | 395 | +0 | +0.0% |
| GPU process footprint (MB) | 1330 | 1344 | +14 | +1.1% |
| GPU process footprint, peak since the browser started (MB) | 3003 | 2968 | -35 | -1.2% |

### high-pad-drone-rain

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 271 | 271 | +0 | +0.0% |
| triangles per frame, all passes | 1070267 | 1070267 | +0 | +0.0% |
| render passes per frame | 73 | 73 | +0 | +0.0% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 287 | 285 | -2 | -0.7% |
| buffer uploads per frame (KB) | 20.7 | 20.7 | -0.0 | -0.0% |
| texture uploads per frame (KB) | 80.4 | 64.4 | -16.0 | -19.9% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 464.4 | 464.4 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.26 | 65.26 | -0.00 | -0.0% |
| JS heap after GC (MB) | 73.0 | 72.5 | -0.6 | -0.8% |
| renderer process footprint (MB) | 267 | 275 | +8 | +3.0% |
| renderer process footprint, peak (MB) | 385 | 396 | +11 | +2.9% |
| GPU process footprint (MB) | 1356 | 1369 | +13 | +1.0% |
| GPU process footprint, peak since the browser started (MB) | 3003 | 2968 | -35 | -1.2% |

### high-path

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| draw calls per frame, all passes | 312 | 301 | -11 | -3.5% |
| triangles per frame, all passes | 987339 | 987328 | -11 | -0.0% |
| render passes per frame | 97 | 85 | -12 | -12.4% |
| compute passes per frame | 21 | 3 | -18 | -85.7% |
| compute dispatches per frame | 212 | 22 | -190 | -89.6% |
| command buffers submitted per frame | 52 | 34 | -18 | -34.6% |
| buffer uploads per frame (calls) | 334 | 332 | -2 | -0.6% |
| buffer uploads per frame (KB) | 24.7 | 23.9 | -0.9 | -3.5% |
| texture uploads per frame (KB) | 83.4 | 65.6 | -17.8 | -21.3% |
| GPU buffers created per frame | 1.00 | 0.00 | -1.00 | -100.0% |
| render pipelines created (GPU) | 167 | 169 | +2 | +1.2% |
| compute pipelines created (GPU) | 222 | 32 | -190 | -85.6% |
| shader modules created (GPU) | 289 | 292 | +3 | +1.0% |
| shader programs (three: vertex + fragment + compute) | 227 | 230 | +3 | +1.3% |
| geometries (three’s count) | 132 | 132 | +0 | +0.0% |
| textures (three’s count) | 61 | 60 | -1 | -1.6% |
| GPU textures alive (count) | 63 | 62 | -1 | -1.6% |
| GPU textures alive (MB, estimate from format and size) | 539.4 | 539.4 | -0.0 | -0.0% |
| GPU textures, peak (MB, estimate) | 539.4 | 539.4 | -0.0 | -0.0% |
| GPU buffers alive (MB, measured sizes) | 65.31 | 65.31 | +0.00 | +0.0% |
| JS heap after GC (MB) | 83.4 | 83.9 | +0.5 | +0.6% |
| renderer process footprint (MB) | 261 | 274 | +13 | +5.0% |
| renderer process footprint, peak (MB) | 412 | 418 | +6 | +1.5% |
| GPU process footprint (MB) | 1403 | 1419 | +16 | +1.1% |
| GPU process footprint, peak since the browser started (MB) | 3003 | 2968 | -35 | -1.2% |

## Memory, repeated (4 runs per build, the builds taking turns to go first)

### high-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| JS heap after GC (MB) | 82.8 | 81.8 | -1.1 | -1.3% | 82.8–82.8 / 81.8–81.8 |
| renderer process footprint (MB) | 284 | 286 | +2 | +0.7% | 279–288 / 280–288 |
| renderer process footprint, peak (MB) | 424 | 421 | -3 | -0.7% | 421–430 / 414–426 |
| GPU process footprint (MB) | 1380 | 1377 | -3 | -0.2% | 1377–1381 / 1352–1383 |
| GPU textures alive (MB, estimate from format and size) | 539.4 | 501.9 | -37.5 | -7.0% | 539.4–539.4 / 501.9–501.9 |
| GPU buffers alive (MB, measured sizes) | 65.31 | 65.31 | -0.00 | -0.0% | 65.31–65.31 / 65.31–65.31 |

### high-deck

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| JS heap after GC (MB) | 68.6 | 68.2 | -0.4 | -0.6% | 68.6–68.6 / 68.2–68.2 |
| renderer process footprint (MB) | 267 | 272 | +5 | +1.9% | 266–268 / 263–277 |
| renderer process footprint, peak (MB) | 406 | 401 | -6 | -1.4% | 403–408 / 399–410 |
| GPU process footprint (MB) | 1367 | 1386 | +19 | +1.4% | 1363–1372 / 1381–1391 |
| GPU textures alive (MB, estimate from format and size) | 501.9 | 501.9 | -0.0 | -0.0% | 501.9–501.9 / 501.9–501.9 |
| GPU buffers alive (MB, measured sizes) | 65.26 | 65.26 | -0.00 | -0.0% | 65.26–65.26 / 65.26–65.26 |

### high-interior

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| JS heap after GC (MB) | 64.9 | 64.5 | -0.3 | -0.5% | 64.9–65.0 / 64.5–64.5 |
| renderer process footprint (MB) | 262 | 265 | +3 | +1.1% | 260–271 / 260–271 |
| renderer process footprint, peak (MB) | 394 | 399 | +5 | +1.1% | 386–401 / 397–399 |
| GPU process footprint (MB) | 1330 | 1346 | +16 | +1.2% | 1328–1333 / 1344–1347 |
| GPU textures alive (MB, estimate from format and size) | 464.4 | 464.4 | -0.0 | -0.0% | 464.4–464.4 / 464.4–464.4 |
| GPU buffers alive (MB, measured sizes) | 65.25 | 65.25 | -0.00 | -0.0% | 65.25–65.25 / 65.25–65.25 |

### ultra-deck-storm

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| JS heap after GC (MB) | 68.7 | 68.3 | -0.4 | -0.6% | 68.5–68.8 / 68.0–68.3 |
| renderer process footprint (MB) | 387 | 443 | +56 | +14.3% | 362–403 / 435–465 |
| renderer process footprint, peak (MB) | 501 | 551 | +50 | +10.0% | 483–520 / 546–565 |
| GPU process footprint (MB) | 2808 | 2882 | +74 | +2.6% | 2791–2818 / 2870–2896 |
| GPU textures alive (MB, estimate from format and size) | 1513.2 | 1513.2 | -0.0 | -0.0% | 1513.2–1513.2 / 1513.2–1513.2 |
| GPU buffers alive (MB, measured sizes) | 164.76 | 164.76 | -0.00 | -0.0% | 164.76–164.76 / 164.76–164.76 |

## JavaScript allocated per frame (V8 sampling heap profiler)

### allocation

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| high-refn: allocated per frame (KB) | 232.6 | 176.6 | -55.9 | -24.0% |
| high-deck: allocated per frame (KB) | 211.2 | 162.3 | -48.9 | -23.1% |
| high-interior: allocated per frame (KB) | 206.2 | 159.6 | -46.6 | -22.6% |

## Self time of JavaScript and WebGPU calls per frame (V8 sampling CPU profiler, 60 Hz cap; native time the profiler cannot attribute is left out)

### self time

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| high-refn: self time per frame (ms) | 2.41 | 1.97 | -0.44 | -18.3% |
| high-deck: self time per frame (ms) | 2.03 | 1.54 | -0.49 | -24.0% |
| high-interior: self time per frame (ms) | 1.77 | 1.36 | -0.41 | -23.4% |

## Main thread inside the animation callbacks, 60 Hz cap, 8 other cores kept busy (Chrome trace, 2 runs per build)

### high-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.58 | 1.95 | -0.63 | -24.5% | 2.37–2.78 / 1.93–1.97 |
| wall time per frame (ms) | 2.58 | 1.95 | -0.63 | -24.5% | 2.38–2.79 / 1.93–1.97 |
| minor garbage collections per minute | 30.0 | 24.0 | -6.0 | -20.0% | 30.0–30.0 / 24.0–24.0 |
| minor GC pause, total (ms per second) | 0.45 | 0.34 | -0.11 | -24.7% | 0.42–0.49 / 0.34–0.34 |
| minor GC pause, longest (ms) | 0.97 | 0.92 | -0.05 | -5.2% | 0.87–1.07 / 0.91–0.93 |
| major garbage collections per minute | 0.0 | 6.0 | +6.0 | n/a | 0.0–0.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 0.00 | 3.29 | +3.29 | n/a | 0.00–0.00 / 3.03–3.54 |

### high-deck

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.14 | 1.56 | -0.58 | -27.0% | 1.95–2.34 / 1.50–1.62 |
| wall time per frame (ms) | 2.15 | 1.57 | -0.58 | -26.9% | 1.95–2.35 / 1.51–1.63 |
| minor garbage collections per minute | 30.0 | 18.0 | -12.0 | -40.0% | 30.0–30.0 / 18.0–18.0 |
| minor GC pause, total (ms per second) | 0.48 | 0.43 | -0.05 | -10.4% | 0.45–0.51 / 0.29–0.57 |
| minor GC pause, longest (ms) | 1.05 | 2.39 | +1.34 | +127.1% | 0.97–1.13 / 1.03–3.74 |
| major garbage collections per minute | 6.0 | 0.0 | -6.0 | -100.0% | 6.0–6.0 / 0.0–0.0 |
| major GC pause on the main thread, longest (ms) | 3.56 | 0.00 | -3.56 | -100.0% | 3.08–4.05 / 0.00–0.00 |

### high-interior

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.02 | 1.57 | -0.46 | -22.6% | 1.74–2.30 / 1.52–1.61 |
| wall time per frame (ms) | 2.03 | 1.57 | -0.46 | -22.5% | 1.74–2.31 / 1.53–1.61 |
| minor garbage collections per minute | 30.0 | 24.0 | -6.0 | -20.0% | 30.0–30.0 / 24.0–24.0 |
| minor GC pause, total (ms per second) | 0.47 | 0.39 | -0.08 | -16.7% | 0.44–0.50 / 0.37–0.41 |
| minor GC pause, longest (ms) | 1.02 | 1.14 | +0.12 | +11.2% | 0.94–1.11 / 1.01–1.27 |
| major garbage collections per minute | 6.0 | 6.0 | +0.0 | +0.0% | 6.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 3.08 | 2.77 | -0.31 | -9.9% | 2.31–3.85 / 2.75–2.80 |

### high-swim

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 1.95 | 1.43 | -0.52 | -26.7% | 1.73–2.17 / 1.39–1.47 |
| wall time per frame (ms) | 1.96 | 1.43 | -0.52 | -26.7% | 1.73–2.18 / 1.40–1.47 |
| minor garbage collections per minute | 24.0 | 24.0 | +0.0 | +0.0% | 24.0–24.0 / 24.0–24.0 |
| minor GC pause, total (ms per second) | 0.40 | 0.39 | -0.00 | -0.8% | 0.38–0.41 / 0.39–0.39 |
| minor GC pause, longest (ms) | 1.04 | 1.08 | +0.04 | +3.3% | 1.04–1.05 / 1.06–1.10 |
| major garbage collections per minute | 0.0 | 6.0 | +6.0 | n/a | 0.0–0.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 0.00 | 2.69 | +2.69 | n/a | 0.00–0.00 / 2.65–2.73 |

## Main thread inside the animation callbacks, 60 Hz cap, machine otherwise idle (Chrome trace, 3 runs per build)

### high-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.93 | 2.65 | -0.29 | -9.8% | 2.90–2.97 / 2.61–2.68 |
| wall time per frame (ms) | 2.94 | 2.65 | -0.29 | -9.7% | 2.91–2.98 / 2.61–2.68 |
| minor garbage collections per minute | 36.0 | 24.0 | -12.0 | -33.4% | 30.0–36.0 / 18.0–24.0 |
| minor GC pause, total (ms per second) | 0.62 | 0.42 | -0.21 | -33.2% | 0.53–0.67 / 0.33–0.43 |
| minor GC pause, longest (ms) | 1.20 | 1.20 | +0.00 | +0.0% | 1.16–1.54 / 1.17–1.25 |
| major garbage collections per minute | 6.0 | 6.0 | -0.0 | -0.1% | 0.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 3.82 | 3.94 | +0.12 | +3.1% | 0.00–3.84 / 3.74–4.88 |

### high-deck

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.65 | 2.58 | -0.07 | -2.7% | 2.64–2.68 / 2.58–2.59 |
| wall time per frame (ms) | 2.65 | 2.58 | -0.07 | -2.6% | 2.65–2.68 / 2.58–2.60 |
| minor garbage collections per minute | 30.0 | 18.0 | -12.0 | -40.0% | 30.0–30.0 / 18.0–18.0 |
| minor GC pause, total (ms per second) | 0.56 | 0.42 | -0.14 | -24.6% | 0.53–0.59 / 0.39–0.43 |
| minor GC pause, longest (ms) | 1.20 | 1.51 | +0.31 | +25.8% | 1.17–1.39 / 1.46–1.55 |
| major garbage collections per minute | 6.0 | 0.0 | -6.0 | -100.0% | 0.0–6.0 / 0.0–6.0 |
| major GC pause on the main thread, longest (ms) | 3.80 | 0.00 | -3.80 | -100.0% | 0.00–3.86 / 0.00–3.69 |

### high-interior

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.55 | 2.63 | +0.08 | +3.2% | 2.47–2.56 / 2.61–2.67 |
| wall time per frame (ms) | 2.56 | 2.63 | +0.08 | +3.1% | 2.48–2.56 / 2.61–2.68 |
| minor garbage collections per minute | 30.0 | 24.0 | -6.0 | -20.0% | 30.0–30.0 / 24.0–24.0 |
| minor GC pause, total (ms per second) | 0.58 | 0.52 | -0.07 | -11.3% | 0.57–0.62 / 0.50–0.53 |
| minor GC pause, longest (ms) | 1.31 | 1.42 | +0.11 | +8.4% | 1.22–1.46 / 1.30–1.65 |
| major garbage collections per minute | 6.0 | 6.0 | +0.0 | +0.0% | 6.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 3.37 | 3.39 | +0.02 | +0.6% | 3.13–3.60 / 2.82–3.48 |

### high-swim

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.52 | 2.61 | +0.09 | +3.4% | 2.40–2.54 / 2.58–2.63 |
| wall time per frame (ms) | 2.53 | 2.61 | +0.09 | +3.5% | 2.40–2.55 / 2.59–2.63 |
| minor garbage collections per minute | 24.0 | 24.0 | +0.0 | +0.0% | 24.0–30.0 / 24.0–24.0 |
| minor GC pause, total (ms per second) | 0.52 | 0.52 | -0.00 | -0.6% | 0.47–0.64 / 0.51–0.53 |
| minor GC pause, longest (ms) | 1.40 | 1.39 | -0.01 | -0.7% | 1.40–1.43 / 1.34–1.75 |
| major garbage collections per minute | 0.0 | 6.0 | +6.0 | n/a | 0.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 0.00 | 3.44 | +3.44 | n/a | 0.00–3.34 / 3.31–3.53 |

### ultra-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| CPU time per frame: the thread’s own clock (ms) | 2.31 | 2.03 | -0.29 | -12.4% | 2.23–2.32 / 2.01–2.07 |
| wall time per frame (ms) | 2.32 | 2.03 | -0.29 | -12.4% | 2.23–2.33 / 2.01–2.08 |
| minor garbage collections per minute | 24.0 | 24.0 | +0.0 | +0.0% | 24.0–24.0 / 24.0–24.0 |
| minor GC pause, total (ms per second) | 0.30 | 0.28 | -0.02 | -5.0% | 0.29–0.31 / 0.28–0.29 |
| minor GC pause, longest (ms) | 0.87 | 0.77 | -0.10 | -11.5% | 0.81–0.89 / 0.74–0.82 |
| major garbage collections per minute | 6.0 | 6.0 | +0.0 | +0.0% | 6.0–12.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 4.63 | 4.50 | -0.13 | -2.8% | 3.67–5.34 / 4.04–4.51 |

## Main thread inside the animation callbacks, no frame cap (Chrome trace, 3 runs per build)

Garbage collections only: without the cap the callbacks wait for the GPU process, sometimes polling, so neither their wall time nor their CPU time measures the work.

### high-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| minor garbage collections per minute | 59.9 | 54.0 | -5.9 | -9.9% | 53.9–71.9 / 53.9–59.9 |
| minor GC pause, total (ms per second) | 1.45 | 1.10 | -0.35 | -24.1% | 1.36–1.61 / 1.01–1.23 |
| minor GC pause, longest (ms) | 1.87 | 1.52 | -0.35 | -18.7% | 1.40–1.91 / 1.35–2.19 |
| major garbage collections per minute | 0.0 | 6.0 | +6.0 | n/a | 0.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 0.00 | 5.57 | +5.57 | n/a | 0.00–6.90 / 5.09–7.43 |

### high-deck

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| minor garbage collections per minute | 42.0 | 42.0 | +0.0 | +0.0% | 42.0–42.0 / 42.0–42.0 |
| minor GC pause, total (ms per second) | 0.85 | 0.85 | +0.00 | +0.4% | 0.75–0.94 / 0.71–0.92 |
| minor GC pause, longest (ms) | 1.49 | 1.69 | +0.20 | +13.4% | 1.32–1.79 / 1.21–1.70 |
| major garbage collections per minute | 0.0 | 12.0 | +12.0 | n/a | 0.0–6.0 / 0.0–12.0 |
| major GC pause on the main thread, longest (ms) | 0.00 | 3.46 | +3.46 | n/a | 0.00–3.08 / 0.00–4.53 |

### high-interior

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| minor garbage collections per minute | 35.9 | 30.0 | -6.0 | -16.6% | 29.9–42.0 / 30.0–36.0 |
| minor GC pause, total (ms per second) | 0.63 | 0.58 | -0.05 | -7.7% | 0.56–0.66 / 0.51–0.68 |
| minor GC pause, longest (ms) | 1.46 | 1.31 | -0.15 | -10.3% | 0.90–2.11 / 1.18–1.34 |
| major garbage collections per minute | 6.0 | 6.0 | +0.0 | +0.1% | 0.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 2.88 | 3.37 | +0.49 | +17.0% | 0.00–3.85 / 2.47–3.79 |

### high-swim

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| minor garbage collections per minute | 36.0 | 30.0 | -6.0 | -16.7% | 36.0–36.0 / 30.0–36.0 |
| minor GC pause, total (ms per second) | 0.79 | 0.55 | -0.24 | -30.2% | 0.66–0.83 / 0.54–0.60 |
| minor GC pause, longest (ms) | 1.61 | 1.35 | -0.26 | -16.1% | 1.31–1.63 / 1.29–1.36 |
| major garbage collections per minute | 6.0 | 6.0 | +0.0 | +0.0% | 6.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 4.03 | 3.36 | -0.67 | -16.6% | 3.22–4.21 / 2.76–3.51 |

### ultra-refn

| Metric | Original | Final | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---|
| minor garbage collections per minute | 18.0 | 18.0 | +0.0 | +0.0% | 18.0–24.0 / 18.0–18.0 |
| minor GC pause, total (ms per second) | 0.49 | 0.38 | -0.11 | -21.7% | 0.46–0.59 / 0.34–0.41 |
| minor GC pause, longest (ms) | 1.81 | 1.73 | -0.08 | -4.4% | 1.81–1.89 / 1.41–1.75 |
| major garbage collections per minute | 6.0 | 6.0 | +0.0 | +0.1% | 6.0–6.0 / 6.0–6.0 |
| major GC pause on the main thread, longest (ms) | 4.97 | 4.96 | -0.01 | -0.2% | 4.70–5.04 / 3.63–5.15 |

## Tearing the page down and building the world again (reloads in one tab)

### memory after the first and the last load

| Metric | Original | Final | Absolute change | Percentage change |
|---|---:|---:|---:|---:|
| JS heap after GC (MB), first load | 81.8 | 80.7 | -1.1 | -1.3% |
| JS heap after GC (MB), last load | 81.8 | 80.7 | -1.1 | -1.3% |
| JS heap after GC (MB), growth | 0.0 | 0.0 | -0.0 | -0.0% |
| renderer process footprint (MB), first load | 267.0 | 275.0 | +8.0 | +3.0% |
| renderer process footprint (MB), last load | 292.0 | 292.0 | +0.0 | +0.0% |
| renderer process footprint (MB), growth | 25.0 | 17.0 | -8.0 | -32.0% |
| GPU process footprint (MB), first load | 1399.0 | 1398.0 | -1.0 | -0.1% |
| GPU process footprint (MB), last load | 1423.0 | 1429.0 | +6.0 | +0.4% |
| GPU process footprint (MB), growth | 24.0 | 31.0 | +7.0 | +29.2% |

## Equal fidelity: north view and aerial, three builds (no frame cap)

`nolod` is the final build with the original transmissive windscreen at every distance, so `base` against `nolod` is the comparison at equal fidelity for the scenes that show the tender from afar. The three builds take turns within each run.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `base`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| high-refn | base | 5 | 149.4 | 6.69 | 8.6 | 10.2 |  |
| high-refn | nolod | 5 | 183.3 | 5.46 | 6.4 | 10.0 | -18.4% (-24.0 … -17.6) |
| high-refn | final | 5 | 187.8 | 5.33 | 6.4 | 9.6 | -21.2% (-26.0 … -20.0) |
| high-aerial | base | 5 | 138.2 | 7.24 | 9.4 | 10.3 |  |
| high-aerial | nolod | 5 | 168.4 | 5.94 | 7.5 | 11.1 | -18.5% (-26.3 … -17.6) |
| high-aerial | final | 5 | 174.8 | 5.72 | 6.6 | 10.3 | -21.3% (-24.5 … -20.1) |

| Scenario | Runs | Average frame time, `final` against `nolod`, paired by run (range) |
|---|---:|---:|
| high-refn | 5 | -3.3% (-5.0 … +0.7) |
| high-aerial | 5 | -3.7% (-4.5 … +2.4) |

## Equal fidelity: the 60 s flight, three builds (no frame cap)

`nolod` is the final build with the original transmissive windscreen at every distance, so `base` against `nolod` is the comparison at equal fidelity for the scenes that show the tender from afar. The three builds take turns within each run.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `base`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| high-path | base | 5 | 106.9 | 9.35 | 13.0 | 14.8 |  |
| high-path | nolod | 5 | 136.1 | 7.35 | 10.2 | 12.3 | -21.1% (-24.4 … -20.9) |
| high-path | final | 5 | 138.2 | 7.24 | 10.0 | 11.7 | -22.6% (-26.1 … -22.2) |

| Scenario | Runs | Average frame time, `final` against `nolod`, paired by run (range) |
|---|---:|---:|
| high-path | 5 | -2.0% (-2.3 … -1.4) |

## Equal fidelity: Ultra’s north view, three builds (no frame cap)

`nolod` is the final build with the original transmissive windscreen at every distance, so `base` against `nolod` is the comparison at equal fidelity for the scenes that show the tender from afar. The three builds take turns within each run.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `base`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| ultra-refn | base | 5 | 37.2 | 26.89 | 29.7 | 31.8 |  |
| ultra-refn | nolod | 5 | 39.5 | 25.29 | 30.2 | 35.2 | -7.2% (-17.1 … -6.0) |
| ultra-refn | final | 5 | 40.8 | 24.53 | 28.8 | 35.9 | -11.8% (-13.0 … -8.8) |

| Scenario | Runs | Average frame time, `final` against `nolod`, paired by run (range) |
|---|---:|---:|
| ultra-refn | 5 | -3.0% (-7.2 … +5.2) |

## Equal fidelity: Ultra’s north view, three builds (60 Hz cap)

`nolod` is the final build with the original transmissive windscreen at every distance, so `base` against `nolod` is the comparison at equal fidelity for the scenes that show the tender from afar. The three builds take turns within each run.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `base`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| ultra-refn | base | 5 | 38.1 | 26.21 | 33.4 | 33.4 |  |
| ultra-refn | nolod | 5 | 41.7 | 23.96 | 33.4 | 33.4 | -8.5% (-9.1 … -7.7) |
| ultra-refn | final | 5 | 42.6 | 23.49 | 33.4 | 33.4 | -10.1% (-10.7 … -9.7) |

| Scenario | Runs | Average frame time, `final` against `nolod`, paired by run (range) |
|---|---:|---:|
| ultra-refn | 5 | -2.2% (-2.4 … -1.3) |

## Equal fidelity: start-up, the original against `nolod` (north view, 5 runs each)

| Metric | Original | Final, original windscreen | Absolute change | Percentage change | Runs: original / final (min–max) |
|---|---:|---:|---:|---:|---:|
| warm: usable scene: third frame (ms) | 1246 | 1252 | +6 | +0.5% | 1239–1266 / 1211–1257 |
| warm: first frame (ms) | 1168 | 1175 | +7 | +0.6% | 1160–1188 / 1133–1179 |
| warm: light probes all baked (ms) | 3420 | 2299 | -1121 | -32.8% | 3406–3436 / 2259–2317 |
| warm: main-thread blocking until usable (ms) | 328 | 298 | -30 | -9.1% | 320–339 / 296–319 |
| warm: longest main-thread task until usable (ms) | 285 | 257 | -28 | -9.8% | 281–288 / 256–263 |
| cold: usable scene: third frame (ms) | 7044 | 6935 | -109 | -1.5% | 6987–7186 / 5888–6975 |
| cold: first frame (ms) | 5685 | 5614 | -71 | -1.2% | 5626–5823 / 5563–5665 |
| cold: light probes all baked (ms) | 9304 | 8102 | -1202 | -12.9% | 9237–9452 / 8070–8168 |
| cold: main-thread blocking until usable (ms) | 337 | 305 | -32 | -9.5% | 332–344 / 302–323 |
| cold: longest main-thread task until usable (ms) | 290 | 262 | -28 | -9.7% | 288–302 / 260–265 |

## Noise floor: the original against itself (no frame cap)

`base` and `base2` are the same build served twice, measured and paired as in the comparison.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `base`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| high-refn | base | 3 | 161.5 | 6.19 | 8.2 | 8.6 |  |
| high-refn | base2 | 3 | 168.8 | 5.92 | 7.9 | 8.4 | -0.5% (-4.4 … +2.1) |
| high-deck | base | 3 | 124.8 | 8.01 | 9.9 | 10.3 |  |
| high-deck | base2 | 3 | 124.4 | 8.04 | 9.8 | 10.2 | -0.1% (-0.3 … +0.4) |
| high-interior | base | 3 | 86.9 | 11.50 | 13.2 | 14.5 |  |
| high-interior | base2 | 3 | 90.1 | 11.10 | 12.8 | 13.4 | -0.9% (-3.5 … +0.0) |

## Ablation: uncapped frame time with one thing switched off, inside one running page

Four rounds per scene; each cell is the median of the per-round changes against nothing switched off in the same round, with the smallest and largest round. "Nothing switched off" is the median frame time of those rounds in ms. These pages run for minutes, so their frame times are not comparable with the timing tables.

### Original

| Switched off | high-refn | high-deck | high-interior | high-aerial |
|---|---:|---:|---:|---:|
| Nothing switched off (ms) | 5.89 | 9.20 | 11.33 | 7.04 |
| Lamps at zero intensity taken out of the light clusters | -2.6% (-3.8 … -1.3) | -17.0% (-17.8 … -15.0) | -22.0% (-23.3 … -21.0) | -4.8% (-6.1 … -3.7) |
| The sky | -16.0% (-17.9 … -7.4) | -8.1% (-9.0 … -7.4) | -2.9% (-3.0 … -1.7) | -12.9% (-14.1 … -12.7) |
| The ocean’s simulation (frozen, still drawn) | -13.2% (-18.2 … -9.0) | -13.0% (-13.9 … -10.6) | -11.9% (-13.1 … -10.6) | -15.4% (-16.0 … -13.4) |
| The ocean’s surface (simulation still running) | -28.7% (-30.4 … -24.9) | -10.6% (-11.1 … -8.1) | -10.5% (-12.2 … -9.5) | -39.2% (-40.3 … -37.7) |
| Glass | +0.2% (-3.3 … +7.3) | -11.6% (-12.4 … -11.1) | -10.5% (-12.1 … -10.2) | -4.1% (-5.0 … -3.3) |
| Grass | +5.3% (+1.2 … +8.7) | -0.8% (-3.9 … -0.6) | -1.3% (-3.1 … -0.9) | -0.5% (-1.3 … +11.3) |
| The sky drawn last instead of first | +1.4% (-1.0 … +6.4) | +0.5% (-0.6 … +1.6) | -0.3% (-1.6 … +2.0) | +0.6% (-1.0 … +2.4) |

### Final

| Switched off | high-refn | high-deck | high-interior | high-aerial |
|---|---:|---:|---:|---:|
| Nothing switched off (ms) | 5.26 | 6.26 | 8.46 | 5.58 |
| Lamps at zero intensity taken out of the light clusters | -0.8% (-2.8 … +2.0) | +0.0% (-1.3 … +1.3) | -1.7% (-2.8 … -0.4) | -1.5% (-3.3 … +0.9) |
| The sky | -9.1% (-14.6 … -6.8) | -7.6% (-8.1 … -7.2) | -1.8% (-4.1 … -0.7) | -5.2% (-6.8 … -4.3) |
| The ocean’s simulation (frozen, still drawn) | -11.8% (-14.6 … -8.8) | -10.0% (-11.5 … -8.5) | -8.4% (-9.4 … -7.1) | -10.0% (-12.2 … -9.2) |
| The ocean’s surface (simulation still running) | -33.4% (-36.6 … -30.8) | -11.1% (-11.5 … -10.3) | -10.5% (-11.6 … -9.4) | -39.9% (-45.6 … -36.5) |
| Glass | -1.0% (-4.3 … +2.2) | -4.0% (-6.4 … -3.7) | -4.7% (-5.5 … -3.5) | +1.1% (-0.5 … +1.8) |
| Grass | -0.9% (-3.5 … +2.3) | -0.6% (-1.9 … +2.4) | -1.2% (-2.3 … -0.7) | -1.9% (-2.6 … -1.1) |
| The sky drawn last instead of first | -0.1% (-2.1 … +2.9) | +1.3% (+0.5 … +3.2) | -1.8% (-3.5 … +0.1) | -1.2% (-2.8 … +0.9) |

## Pictures: pixel differences between screenshot sets

28 views at 1536×1024, seeded `Math.random`, a clock that steps 1/60 s per frame, taken at game frame 420. Per view: the mean absolute difference per channel (of 255), the largest difference of any channel of any pixel, and the share of pixels where a channel differs by more than 8 and by more than 32.

### The original against itself (two runs)

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 4 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 0 | 0.000% | 0.000% |
| `deck-night` | 0.000 | 1 | 0.000% | 0.000% |
| `deck-rain` | 0.000 | 2 | 0.000% | 0.000% |
| `deck-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `doors-dusk` | 0.000 | 1 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 0 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 0 | 0.000% | 0.000% |
| `helipad` | 0.000 | 0 | 0.000% | 0.000% |
| `interior-night` | 0.000 | 1 | 0.000% | 0.000% |
| `interior` | 0.000 | 0 | 0.000% | 0.000% |
| `lift` | 0.002 | 78 | 0.007% | 0.000% |
| `living` | 0.000 | 0 | 0.000% | 0.000% |
| `lounge-dusk` | 0.000 | 0 | 0.000% | 0.000% |
| `moon` | 0.000 | 0 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 0 | 0.000% | 0.000% |
| `pool` | 0.000 | 1 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 29 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 1 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 9 | 0.000% | 0.000% |
| `swim` | 0.000 | 0 | 0.000% | 0.000% |
| `tender-windscreen` | 0.000 | 0 | 0.000% | 0.000% |
| `tender` | 0.003 | 77 | 0.005% | 0.000% |
| `underwater` | 0.000 | 2 | 0.000% | 0.000% |
| `walkway` | 0.000 | 0 | 0.000% | 0.000% |

### The original against the final

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 4 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 10 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 10 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 59 | 0.000% | 0.000% |
| `deck-night` | 0.002 | 6 | 0.000% | 0.000% |
| `deck-rain` | 0.003 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.006 | 8 | 0.000% | 0.000% |
| `doors-dusk` | 0.007 | 40 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 76 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 39 | 0.000% | 0.000% |
| `helipad` | 0.000 | 2 | 0.000% | 0.000% |
| `interior-night` | 0.014 | 1 | 0.000% | 0.000% |
| `interior` | 0.009 | 7 | 0.000% | 0.000% |
| `lift` | 0.000 | 60 | 0.000% | 0.000% |
| `living` | 0.010 | 8 | 0.000% | 0.000% |
| `lounge-dusk` | 0.001 | 3 | 0.000% | 0.000% |
| `moon` | 0.000 | 1 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 2 | 0.000% | 0.000% |
| `pool` | 0.000 | 4 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 29 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 2 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 2 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 17 | 0.000% | 0.000% |
| `swim` | 0.000 | 50 | 0.000% | 0.000% |
| `tender-windscreen` | 0.019 | 88 | 0.027% | 0.004% |
| `tender` | 0.003 | 77 | 0.005% | 0.000% |
| `underwater` | 0.000 | 1 | 0.000% | 0.000% |
| `walkway` | 0.000 | 3 | 0.000% | 0.000% |

### The original against the final with the original windscreen at every distance (`nolod`)

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 1 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 4 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 9 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 59 | 0.000% | 0.000% |
| `deck-night` | 0.002 | 6 | 0.000% | 0.000% |
| `deck-rain` | 0.003 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.006 | 8 | 0.000% | 0.000% |
| `doors-dusk` | 0.007 | 40 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 76 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 39 | 0.000% | 0.000% |
| `helipad` | 0.000 | 2 | 0.000% | 0.000% |
| `interior-night` | 0.014 | 1 | 0.000% | 0.000% |
| `interior` | 0.009 | 7 | 0.000% | 0.000% |
| `lift` | 0.000 | 60 | 0.000% | 0.000% |
| `living` | 0.010 | 8 | 0.000% | 0.000% |
| `lounge-dusk` | 0.001 | 3 | 0.000% | 0.000% |
| `moon` | 0.000 | 1 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 2 | 0.000% | 0.000% |
| `pool` | 0.000 | 4 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 29 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 1 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 2 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 17 | 0.000% | 0.000% |
| `swim` | 0.000 | 50 | 0.000% | 0.000% |
| `tender-windscreen` | 0.000 | 1 | 0.000% | 0.000% |
| `tender` | 0.003 | 77 | 0.005% | 0.000% |
| `underwater` | 0.000 | 1 | 0.000% | 0.000% |
| `walkway` | 0.000 | 3 | 0.000% | 0.000% |

### The plain windscreen alone: `nolod` against the final

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 3 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 10 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 9 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 7 | 0.000% | 0.000% |
| `deck-night` | 0.000 | 0 | 0.000% | 0.000% |
| `deck-rain` | 0.000 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `doors-dusk` | 0.000 | 1 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 0 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 0 | 0.000% | 0.000% |
| `helipad` | 0.000 | 1 | 0.000% | 0.000% |
| `interior-night` | 0.004 | 1 | 0.000% | 0.000% |
| `interior` | 0.000 | 0 | 0.000% | 0.000% |
| `lift` | 0.000 | 4 | 0.000% | 0.000% |
| `living` | 0.000 | 4 | 0.000% | 0.000% |
| `lounge-dusk` | 0.000 | 2 | 0.000% | 0.000% |
| `moon` | 0.000 | 0 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 0 | 0.000% | 0.000% |
| `pool` | 0.000 | 1 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 14 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 2 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `swim` | 0.000 | 0 | 0.000% | 0.000% |
| `tender-windscreen` | 0.019 | 88 | 0.027% | 0.004% |
| `tender` | 0.000 | 0 | 0.000% | 0.000% |
| `underwater` | 0.000 | 0 | 0.000% | 0.000% |
| `walkway` | 0.000 | 0 | 0.000% | 0.000% |

### The original against the final with neither the plain windscreen nor the sky’s cut

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 1 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 4 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 9 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 59 | 0.000% | 0.000% |
| `deck-night` | 0.002 | 6 | 0.000% | 0.000% |
| `deck-rain` | 0.003 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.006 | 8 | 0.000% | 0.000% |
| `doors-dusk` | 0.007 | 40 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 76 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 39 | 0.000% | 0.000% |
| `helipad` | 0.000 | 2 | 0.000% | 0.000% |
| `interior-night` | 0.014 | 1 | 0.000% | 0.000% |
| `interior` | 0.009 | 7 | 0.000% | 0.000% |
| `lift` | 0.000 | 60 | 0.000% | 0.000% |
| `living` | 0.011 | 16 | 0.000% | 0.000% |
| `lounge-dusk` | 0.001 | 3 | 0.000% | 0.000% |
| `moon` | 0.000 | 1 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 2 | 0.000% | 0.000% |
| `pool` | 0.000 | 4 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 29 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 1 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 2 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 17 | 0.000% | 0.000% |
| `swim` | 0.000 | 50 | 0.000% | 0.000% |
| `tender-windscreen` | 0.006 | 25 | 0.002% | 0.000% |
| `tender` | 0.003 | 77 | 0.005% | 0.000% |
| `underwater` | 0.000 | 1 | 0.000% | 0.000% |
| `walkway` | 0.000 | 3 | 0.000% | 0.000% |

The isolated pixels of the tables above are in the same places here, so neither the plain windscreen nor the cut causes them. The six pixels of `living` in this table are this variant’s alone: the original and the final agree there.

### The views with the tender, repeated

Three more sets of each build (`base2-*`, `final2-*`) for the three views that show the tender close by. Each cell is the number of pixels, of 1,572,864, where a channel differs by more than 8/255 between two sets. The tender's pose follows asynchronous readbacks of the wave heights, so each build lands on one of two or three pictures; the builds share them.

```text
tender-windscreen: pixels over 8/255 (of 1,572,864)
             base-0   base-1  base2-0  base2-1  base2-2    final final2-0 final2-1 final2-2
base-0            0        0        0       32       32      421        0        0       32
base-1            0        0        0       32       32      421        0        0       32
base2-0           0        0        0       32       32      421        0        0       32
base2-1          32       32       32        0        0      428       32       32        0
base2-2          32       32       32        0        0      428       32       32        0
final           421      421      421      428      428        0      421      421      428
final2-0          0        0        0       32       32      421        0        0       32
final2-1          0        0        0       32       32      421        0        0       32
final2-2         32       32       32        0        0      428       32       32        0

tender: pixels over 8/255 (of 1,572,864)
             base-0   base-1  base2-0  base2-1  base2-2    final final2-0 final2-1 final2-2
base-0            0       74       74        0        0       75       75       76       75
base-1           74        0        0       74       74        1        1        2        1
base2-0          74        0        0       74       74        1        1        2        1
base2-1           0       74       74        0        0       75       75       76       75
base2-2           0       74       74        0        0       75       75       76       75
final            75        1        1       75       75        0        0        1        0
final2-0         75        1        1       75       75        0        0        1        0
final2-1         76        2        2       76       76        1        1        0        1
final2-2         75        1        1       75       75        0        0        1        0

lift: pixels over 8/255 (of 1,572,864)
             base-0   base-1  base2-0  base2-1  base2-2    final final2-0 final2-1 final2-2
base-0            0      109        0       86        0        2        2        2        2
base-1          109        0      109       37      109      111      111      111      111
base2-0           0      109        0       86        0        2        2        2        2
base2-1          86       37       86        0       86       88       88       88       88
base2-2           0      109        0       86        0        2        2        2        2
final             2      111        2       88        2        0        0        0        0
final2-0          2      111        2       88        2        0        0        0        0
final2-1          2      111        2       88        2        0        0        0        0
final2-2          2      111        2       88        2        0        0        0        0
```

## The ocean's buffers: the original, the final build before the change, and the delivered build

Measured on 22 November 2026 after everything above, on the same machine; the builds take turns within every run. The memory runs, the category and region samples and the uncapped frame-time comparisons were made on battery, the rest on mains while the battery charged. `before` is the final build of the sections above, `final` here is the delivered build, which creates seven of the ocean's buffers on the device instead of uploading zeros into them. Raw results are in `bench-results/memfix`.

### Memory, four runs per build (the `count` suite)

| Metric | Original | Final before this change | Final | Runs (min–max): original / before / final |
|---|---:|---:|---:|---:|
| Buffer contents uploaded at creation, deck (MB) | 65.2 | 65.2 | 45.7 | |
| GPU buffers alive, deck (MB) | 65.3 | 65.3 | 65.3 | |
| Buffer contents uploaded at creation, Ultra, deck in a storm (MB) | 164.7 | 164.7 | 86.7 | |
| GPU buffers alive, Ultra, deck in a storm (MB) | 164.8 | 164.8 | 164.8 | |
| Renderer process footprint, north view (MB) | 280 | 283 | 252 | 264–280 / 281–284 / 252–255 |
| Renderer process footprint, deck (MB) | 264 | 270 | 243 | 264–264 / 268–271 / 240–244 |
| Renderer process footprint, interior (MB) | 262 | 267 | 237 | 260–264 / 267–306 / 232–240 |
| Renderer process footprint, Ultra, deck in a storm (MB) | 395 | 440 | 315 | 388–397 / 410–447 / 310–319 |
| GPU process footprint, north view (MB) | 1,387 | 1,375 | 1,365 | 1376–1398 / 1350–1377 / 1344–1371 |
| GPU process footprint, deck (MB) | 1,372 | 1,389 | 1,378 | 1368–1375 / 1389–1390 / 1378–1380 |
| GPU process footprint, interior (MB) | 1,332 | 1,350 | 1,341 | 1331–1335 / 1344–1362 / 1339–1345 |
| GPU process footprint, Ultra, deck in a storm (MB) | 2,798 | 2,876 | 2,812 | 2796–2819 / 2870–2900 / 2811–2814 |
| Renderer process footprint, peak, north view (MB) | 428 | 422 | 392 | 410–429 / 420–424 / 390–394 |
| Renderer process footprint, peak, deck (MB) | 400 | 408 | 378 | 392–406 / 398–411 / 374–380 |
| Renderer process footprint, peak, interior (MB) | 400 | 396 | 370 | 396–402 / 383–402 / 362–371 |
| Renderer process footprint, peak, Ultra, deck in a storm (MB) | 506 | 554 | 428 | 502–511 / 527–560 / 416–432 |
| GPU process footprint, peak since the browser started, north view (MB) | 1,489 | 1,478 | 1,459 | 1471–1499 / 1458–1485 / 1440–1484 |
| GPU process footprint, peak since the browser started, deck (MB) | 1,501 | 1,494 | 1,518 | 1491–1511 / 1493–1548 / 1507–1543 |
| GPU process footprint, peak since the browser started, interior (MB) | 1,501 | 1,494 | 1,518 | 1491–1511 / 1493–1548 / 1513–1543 |
| GPU process footprint, peak since the browser started, Ultra, deck in a storm (MB) | 2,910 | 2,977 | 2,904 | 2904–2930 / 2964–2994 / 2903–2908 |

### Process memory by category (macOS `footprint`), Ultra, deck in a storm

Four runs per build on pages without the harness's counters, one scene per browser: median (smallest–largest), MB. Categories under 8 MB are left out. The renderer is the page's own process.

| Category | Original | Final before the change | Final |
|---|---:|---:|---:|
| GPU process: TOTAL | 2800 (2782–2821) | 2858 (2855–2860) | 2800 (2795–2819) |
| GPU process: Owned physical footprint (unmapped) (graphics) baseline: 1902 / 1902 / 1902 / 1902 |  | 1902 (1898–1902) | 1902 (1902–1902) |
| Renderer: TOTAL | 508 (500–512) | 552 (548–554) | 417 (416–421) |
| Renderer: app-specific tag 16 | 347 (336–348) | 344 (343–347) | 274 (273–276) |
| GPU process: app-specific tag 14 | 326 (308–343) | 302 (302–304) | 304 (302–329) |
| GPU process: IOSurface | 266 (266–271) | 266 (266–267) | 266 (263–271) |
| GPU process: IOAccelerator (graphics) | 112 (112–112) | 149 (149–149) | 149 (149–149) |
| Renderer: untagged (VM_ALLOCATE) | 92 (92–94) | 138 (137–139) | 77 (77–77) |
| GPU process: untagged (VM_ALLOCATE) | 92 (92–94) | 138 (137–139) | 77 (77–77) |
| GPU process: Owned physical footprint (unmapped) | 92 (91–94) | 92 (91–93) | 92 (91–92) |
| Renderer: app-specific tag 14 | 64 (61–65) | 64 (62–64) | 61 (61–62) |

### Process memory by category (macOS `footprint`), High, deck

Four runs per build on pages without the harness's counters, one scene per browser: median (smallest–largest), MB. Categories under 8 MB are left out. The renderer is the page's own process.

| Category | Original | Final before the change | Final |
|---|---:|---:|---:|
| GPU process: TOTAL | 1345 (1339–1354) | 1342 (1324–1358) | 1340 (1315–1341) |
| GPU process: Owned physical footprint (unmapped) (graphics) baseline: 754 / 754 / 754 / 754 |  | 754 (754–754) | 754 (754–754) |
| Renderer: TOTAL | 392 (388–394) | 388 (381–393) | 366 (364–369) |
| GPU process: app-specific tag 14 | 333 (327–340) | 318 (315–326) | 316 (316–317) |
| Renderer: app-specific tag 16 | 276 (273–278) | 268 (262–270) | 254 (252–254) |
| GPU process: IOAccelerator (graphics) | 68 (62–86) | 76 (61–83) | 82 (60–83) |
| GPU process: IOSurface | 76 (76–76) | 76 (76–76) | 76 (76–76) |
| Renderer: app-specific tag 14 | 68 (68–68) | 65 (63–67) | 66 (64–68) |
| GPU process: Owned physical footprint (unmapped) | 62 (60–65) | 61 (60–62) | 61 (60–63) |
| Renderer: untagged (VM_ALLOCATE) | 41 (41–41) | 50 (48–50) | 41 (41–41) |
| GPU process: untagged (VM_ALLOCATE) | 41 (41–41) | 50 (48–50) | 41 (41–41) |

### Process memory by category (macOS `footprint`), High, interior

Four runs per build on pages without the harness's counters, one scene per browser: median (smallest–largest), MB. Categories under 8 MB are left out. The renderer is the page's own process.

| Category | Original | Final before the change | Final |
|---|---:|---:|---:|
| GPU process: TOTAL | 1297 (1292–1306) | 1274 (1273–1334) | 1272 (1265–1281) |
| GPU process: Owned physical footprint (unmapped) (graphics) baseline: 716 / 716 / 716 / 716 |  | 716 (716–716) | 716 (712–716) |
| Renderer: TOTAL | 386 (384–387) | 384 (361–388) | 357 (356–360) |
| GPU process: app-specific tag 14 | 324 (322–325) | 303 (301–329) | 301 (299–303) |
| Renderer: app-specific tag 16 | 270 (269–272) | 264 (245–268) | 248 (243–249) |
| GPU process: IOSurface | 76 (76–76) | 76 (76–90) | 76 (76–90) |
| GPU process: IOAccelerator (graphics) | 70 (65–81) | 61 (60–81) | 61 (61–81) |
| Renderer: app-specific tag 14 | 68 (67–69) | 64 (62–66) | 64 (63–67) |
| GPU process: Owned physical footprint (unmapped) | 62 (60–62) | 62 (61–62) | 61 (61–65) |
| Renderer: untagged (VM_ALLOCATE) | 41 (41–41) | 50 (48–50) | 41 (38–41) |
| GPU process: untagged (VM_ALLOCATE) | 41 (41–41) | 50 (48–50) | 41 (38–41) |

### The GPU process by category with the scenes opened one after another in one browser (no counters)

North view, then the deck, then the interior, as the `count` suite opens them; three runs per build, median (smallest–largest), MB. "Command storage pairs dirty" counts the 1 MiB regions of `IOAccelerator (graphics)` that are in use.

| Scene: category | Original | Final |
|---|---:|---:|
| refn: command storage pairs dirty | 20 (20–20) | 20 (20–20) |
| refn: Owned physical footprint (unmapped) (graphics) | 793 (793–793) | 754 (754–754) |
| refn: app-specific tag 14 | 324 (324–327) | 304 (304–304) |
| refn: IOSurface | 76 (76–76) | 76 (76–76) |
| refn: IOAccelerator (graphics) | 64 (63–65) | 60 (60–60) |
| refn: Owned physical footprint (unmapped) | 62 (39–62) | 41 (40–64) |
| refn: untagged (VM_ALLOCATE) | 41 (39–41) | 41 (41–41) |
| refn: TOTAL | 1368 (1344–1370) | 1284 (1283–1307) |
| deck: command storage pairs dirty | 20 (20–21) | 20 (20–20) |
| deck: Owned physical footprint (unmapped) (graphics) | 754 (754–754) | 754 (754–754) |
| deck: app-specific tag 14 | 326 (324–341) | 318 (317–319) |
| deck: IOSurface | 76 (76–76) | 76 (76–76) |
| deck: IOAccelerator (graphics) | 66 (65–67) | 61 (60–61) |
| deck: Owned physical footprint (unmapped) | 59 (59–60) | 60 (60–62) |
| deck: untagged (VM_ALLOCATE) | 41 (41–41) | 41 (39–41) |
| deck: TOTAL | 1331 (1328–1346) | 1318 (1318–1319) |
| interior: command storage pairs dirty | 39 (39–39) | 22 (21–48) |
| interior: Owned physical footprint (unmapped) (graphics) | 716 (716–716) | 716 (716–716) |
| interior: app-specific tag 14 | 323 (321–326) | 377 (313–378) |
| interior: IOAccelerator (graphics) | 114 (114–115) | 65 (62–128) |
| interior: IOSurface | 76 (76–76) | 76 (76–76) |
| interior: Owned physical footprint (unmapped) | 60 (60–61) | 60 (60–60) |
| interior: untagged (VM_ALLOCATE) | 41 (41–41) | 39 (39–39) |
| interior: TOTAL | 1339 (1337–1342) | 1339 (1338–1342) |

### `IOAccelerator (graphics)` in the GPU process: region pairs in use

From `footprint -v`: pairs of regions of 1 MiB and 0.75 MiB, each wholly dirty or untouched. `final-split` is a test build that submits the ocean's kernels one by one.

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

### The single compute pass against the kernels submitted one by one

| Without the cap, median of five runs | Before this change | Final | Kernels submitted one by one | One by one against final, paired (range) |
|---|---:|---:|---:|---:|
| Deck: average frame time (ms) | 6.05 | 6.04 | 6.63 | +9.9% (+9.1 … +10.2) |
| Deck: p95 (ms) | 6.7 | 6.6 | 7.0 | |
| Deck: p99 (ms) | 9.0 | 9.0 | 8.0 | |
| Ultra, north view: average frame time (ms) | 23.52 | 23.55 | 23.68 | +0.4% (+0.1 … +0.9) |
| Ultra, north view: p95 (ms) | 27.7 | 27.9 | 26.9 | |
| Ultra, north view: p99 (ms) | 35.0 | 35.0 | 28.7 | |

### Frame time: the delivered build against the build before it (no frame cap)

Five runs per build, the builds taking turns within each run.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `before`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| high-interior | before | 5 | 112.7 | 8.87 | 10.7 | 12.5 |  |
| high-interior | final | 5 | 114.0 | 8.77 | 10.5 | 12.1 | +0.1% (-4.4 … +1.2) |
| high-swim | before | 5 | 112.0 | 8.93 | 11.2 | 12.4 |  |
| high-swim | final | 5 | 110.8 | 9.02 | 11.2 | 12.5 | +0.9% (-5.1 … +1.0) |
| ultra-deck-storm | before | 5 | 20.8 | 48.06 | 53.7 | 66.6 |  |
| ultra-deck-storm | final | 5 | 20.4 | 48.95 | 53.3 | 67.2 | +0.7% (-0.3 … +4.5) |

### Frame time: the build before, the delivered build and the test build with the kernels submitted one by one (no frame cap)

Five runs per build, the builds taking turns within each run.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `before`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| high-deck | before | 5 | 165.2 | 6.05 | 6.7 | 9.0 |  |
| high-deck | final | 5 | 165.4 | 6.04 | 6.6 | 9.0 | -0.2% (-0.3 … +0.3) |
| high-deck | split | 5 | 150.9 | 6.63 | 7.0 | 8.0 | +9.8% (+8.9 … +10.3) |
| ultra-refn | before | 5 | 42.5 | 23.52 | 27.7 | 35.0 |  |
| ultra-refn | final | 5 | 42.5 | 23.55 | 27.9 | 35.0 | +0.3% (-0.7 … +0.9) |
| ultra-refn | split | 5 | 42.2 | 23.68 | 26.9 | 28.7 | +0.9% (+0.1 … +1.3) |

### Frame time: the delivered build against the build before it (60 Hz cap)

Five runs per build on mains, after a capped run was seen at 60 fps.

| Scenario | Build | Runs | Average FPS | Frame time, average (ms) | p95 (ms) | p99 (ms) | Average frame time against `before`, paired by run (range) |
|---|---:|---:|---:|---:|---:|---:|---:|
| high-deck | before | 5 | 60.0 | 16.67 | 16.7 | 16.8 |  |
| high-deck | final | 5 | 60.0 | 16.67 | 16.7 | 16.8 | +0.0% (+0.0 … +0.0) |
| ultra-refn | before | 5 | 43.5 | 23.02 | 33.4 | 33.4 |  |
| ultra-refn | final | 5 | 43.5 | 22.96 | 33.4 | 33.4 | -0.1% (-0.7 … +0.1) |
| ultra-deck-storm | before | 5 | 22.6 | 44.28 | 50.1 | 50.1 |  |
| ultra-deck-storm | final | 5 | 22.5 | 44.46 | 50.1 | 50.1 | +0.4% (-1.1 … +1.6) |

### Start-up: the original, the build before the change and the delivered build, each with the original windscreen (north view, five runs each)

| Metric | Original | Final before this change | Final | Runs (min–max): original / before / final |
|---|---:|---:|---:|---:|
| Warm: usable scene (ms) | 1,308 | 1,274 | 1,270 | 1289–1315 / 1255–1298 / 1252–1296 |
| Warm: first frame (ms) | 1,217 | 1,180 | 1,191 | 1212–1233 / 1178–1204 / 1173–1196 |
| Warm: main-thread blocking until usable (ms) | 343 | 317 | 310 | 340–366 / 306–330 / 306–334 |
| Warm: longest main-thread task until usable (ms) | 295 | 264 | 261 | 294–302 / 262–271 / 260–268 |
| Cold: usable scene (ms) | 7,327 | 7,236 | 7,241 | 7244–7468 / 6078–7272 / 7228–7275 |
| Cold: first frame (ms) | 5,902 | 5,828 | 5,818 | 5836–6062 / 5796–5861 / 5799–5842 |
| Cold: main-thread blocking until usable (ms) | 360 | 331 | 338 | 337–364 / 312–342 / 307–343 |
| Cold: longest main-thread task until usable (ms) | 303 | 274 | 275 | 292–310 / 264–289 / 263–281 |

### Regeneration, reloads and counts, repeated with the delivered build

The original taking turns with the delivered build: regeneration at 60 Hz (two runs of eight jumps per build; medians over the 16 jumps, growth as the median of the two runs), six loads of the world in one tab (one run), and the `count` suite (one run per scene).

| Measured again with the delivered build | Original | Final |
|---|---:|---:|
| Regeneration complete after, 60 Hz (ms) | 2,240 | 1,122 |
| `bake()` calls per regeneration | 135 | 68 |
| Main-thread time in `bake()` per regeneration (ms) | 98.1 | 53.0 |
| Longest frame during a regeneration, 60 Hz (ms) | 16.8 | 16.8 |
| Frames over budget during a regeneration, 60 Hz | 0 | 0 |
| Pipelines created by a regeneration | 0 | 0 |
| JS heap, highest over 8 regenerations above the first (MB) | 0.19 | 0.26 |
| JS heap, last of 8 regenerations above the first (MB): one of the original's two runs ended 4.1 MB lower, after a larger collection | −1.96 | 0.26 |
| Renderer process footprint, last of 8 regenerations above the first (MB) | −15.0 | −11.5 |
| GPU process footprint, last of 8 regenerations above the first (MB) | 2.5 | −8.0 |
| GPU buffers and textures, growth over 8 regenerations (MB) | 0.00 | 0.00 |
| Geometries, textures and pipelines (three), growth over 8 regenerations | 0 | 0 |
| JS heap growth over six loads of the world in one tab (MB) | 0.04 | 0.05 |
| Renderer process footprint, first of six loads (MB) | 268 | 249 |
| Renderer process footprint, last of six loads (MB) | 289 | 266 |
| GPU process footprint, first of six loads (MB) | 1,399 | 1,390 |
| GPU process footprint, last of six loads (MB) | 1,445 | 1,414 |
| Draw calls per frame, all passes (deck) | 289 | 289 |
| Triangles per frame, all passes (deck) | 969,008 | 969,008 |
| Render passes per frame (deck) | 85 | 85 |
| Compute passes per frame (deck) | 21 | 3 |
| Compute dispatches per frame (deck) | 212 | 22 |
| Command buffers submitted per frame (deck) | 52 | 34 |
| Render pipelines (deck) | 167 | 169 |
| Compute pipelines (deck) | 222 | 32 |
| Shader modules (deck) | 289 | 292 |
| GPU buffers created since the page opened (deck) | 2,638 | 1,013 |
| GPU buffers alive (deck, MB) | 65.3 | 65.3 |
| GPU textures alive (deck, MB, estimate) | 501.9 | 501.9 |
| Draw calls per frame, all passes (Ultra, deck in a storm) | 302 | 302 |
| Triangles per frame, all passes (Ultra, deck in a storm) | 1,593,492 | 1,593,492 |
| Render passes per frame (Ultra, deck in a storm) | 97 | 97 |
| Compute passes per frame (Ultra, deck in a storm) | 22 | 2 |
| Compute dispatches per frame (Ultra, deck in a storm) | 235 | 23 |
| Command buffers submitted per frame (Ultra, deck in a storm) | 58 | 38 |
| Render pipelines (Ultra, deck in a storm) | 176 | 178 |
| Compute pipelines (Ultra, deck in a storm) | 246 | 34 |
| Shader modules (Ultra, deck in a storm) | 303 | 306 |
| GPU buffers created since the page opened (Ultra, deck in a storm) | 1,400 | 1,025 |
| GPU buffers alive (Ultra, deck in a storm, MB) | 164.8 | 164.8 |
| GPU textures alive (Ultra, deck in a storm, MB, estimate) | 1,513.2 | 1,513.2 |

### Pictures of the delivered build

Four sets taken one after another on mains: the build before the change and the delivered build, twice each.

#### Pictures: the build before the change against the delivered build

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 1 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 0 | 0.000% | 0.000% |
| `deck-night` | 0.000 | 0 | 0.000% | 0.000% |
| `deck-rain` | 0.000 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `doors-dusk` | 0.001 | 1 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 1 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 0 | 0.000% | 0.000% |
| `helipad` | 0.000 | 1 | 0.000% | 0.000% |
| `interior-night` | 0.000 | 0 | 0.000% | 0.000% |
| `interior` | 0.000 | 0 | 0.000% | 0.000% |
| `lift` | 0.000 | 0 | 0.000% | 0.000% |
| `living` | 0.000 | 2 | 0.000% | 0.000% |
| `lounge-dusk` | 0.000 | 1 | 0.000% | 0.000% |
| `moon` | 0.000 | 0 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 3 | 0.000% | 0.000% |
| `pool` | 0.000 | 0 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 1 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `swim` | 0.000 | 0 | 0.000% | 0.000% |
| `tender-windscreen` | 0.006 | 25 | 0.002% | 0.000% |
| `tender` | 0.000 | 0 | 0.000% | 0.000% |
| `underwater` | 0.000 | 0 | 0.000% | 0.000% |
| `walkway` | 0.000 | 0 | 0.000% | 0.000% |

#### Pictures: the build before the change against itself

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 1 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 1 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 1 | 0.000% | 0.000% |
| `deck-night` | 0.000 | 3 | 0.000% | 0.000% |
| `deck-rain` | 0.000 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `doors-dusk` | 0.001 | 1 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 1 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 0 | 0.000% | 0.000% |
| `helipad` | 0.000 | 1 | 0.000% | 0.000% |
| `interior-night` | 0.000 | 0 | 0.000% | 0.000% |
| `interior` | 0.000 | 0 | 0.000% | 0.000% |
| `lift` | 0.000 | 2 | 0.000% | 0.000% |
| `living` | 0.000 | 0 | 0.000% | 0.000% |
| `lounge-dusk` | 0.000 | 1 | 0.000% | 0.000% |
| `moon` | 0.000 | 0 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 3 | 0.000% | 0.000% |
| `pool` | 0.000 | 0 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 1 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 1 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 6 | 0.000% | 0.000% |
| `swim` | 0.000 | 0 | 0.000% | 0.000% |
| `tender-windscreen` | 0.006 | 25 | 0.002% | 0.000% |
| `tender` | 0.000 | 0 | 0.000% | 0.000% |
| `underwater` | 0.000 | 0 | 0.000% | 0.000% |
| `walkway` | 0.000 | 0 | 0.000% | 0.000% |

#### Pictures: the delivered build against itself

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 0 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 0 | 0.000% | 0.000% |
| `deck-night` | 0.000 | 0 | 0.000% | 0.000% |
| `deck-rain` | 0.000 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `doors-dusk` | 0.000 | 0 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 0 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 0 | 0.000% | 0.000% |
| `helipad` | 0.000 | 9 | 0.000% | 0.000% |
| `interior-night` | 0.000 | 0 | 0.000% | 0.000% |
| `interior` | 0.000 | 0 | 0.000% | 0.000% |
| `lift` | 0.000 | 4 | 0.000% | 0.000% |
| `living` | 0.000 | 2 | 0.000% | 0.000% |
| `lounge-dusk` | 0.000 | 1 | 0.000% | 0.000% |
| `moon` | 0.000 | 0 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 1 | 0.000% | 0.000% |
| `pool` | 0.000 | 0 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 0 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 1 | 0.000% | 0.000% |
| `swim` | 0.000 | 9 | 0.000% | 0.000% |
| `tender-windscreen` | 0.000 | 0 | 0.000% | 0.000% |
| `tender` | 0.000 | 0 | 0.000% | 0.000% |
| `underwater` | 0.000 | 9 | 0.000% | 0.000% |
| `walkway` | 0.000 | 0 | 0.000% | 0.000% |

#### Pictures: the original (the morning's set) against the delivered build

| View | Mean difference (/255) | Largest difference (/255) | Pixels over 8/255 | Pixels over 32/255 |
|---|---:|---:|---:|---:|
| `aerial-fog` | 0.000 | 2 | 0.000% | 0.000% |
| `aerial-golden` | 0.000 | 10 | 0.000% | 0.000% |
| `aerial-low` | 0.000 | 10 | 0.000% | 0.000% |
| `aerial-medium` | 0.000 | 59 | 0.000% | 0.000% |
| `deck-night` | 0.002 | 6 | 0.000% | 0.000% |
| `deck-rain` | 0.003 | 1 | 0.000% | 0.000% |
| `deck-ultra` | 0.006 | 8 | 0.000% | 0.000% |
| `doors-dusk` | 0.007 | 40 | 0.000% | 0.000% |
| `drone-parked` | 0.000 | 76 | 0.000% | 0.000% |
| `hammocks` | 0.000 | 39 | 0.000% | 0.000% |
| `helipad` | 0.000 | 2 | 0.000% | 0.000% |
| `interior-night` | 0.014 | 1 | 0.000% | 0.000% |
| `interior` | 0.009 | 7 | 0.000% | 0.000% |
| `lift` | 0.000 | 60 | 0.000% | 0.000% |
| `living` | 0.010 | 8 | 0.000% | 0.000% |
| `lounge-dusk` | 0.001 | 3 | 0.000% | 0.000% |
| `moon` | 0.000 | 1 | 0.000% | 0.000% |
| `pad-drone-landing` | 0.000 | 2 | 0.000% | 0.000% |
| `pool` | 0.000 | 4 | 0.000% | 0.000% |
| `ref-morning` | 0.000 | 29 | 0.000% | 0.000% |
| `refn-noon` | 0.000 | 2 | 0.000% | 0.000% |
| `refn-storm` | 0.000 | 2 | 0.000% | 0.000% |
| `refn-ultra` | 0.000 | 17 | 0.000% | 0.000% |
| `swim` | 0.000 | 50 | 0.000% | 0.000% |
| `tender-windscreen` | 0.006 | 25 | 0.002% | 0.000% |
| `tender` | 0.003 | 77 | 0.005% | 0.000% |
| `underwater` | 0.000 | 1 | 0.000% | 0.000% |
| `walkway` | 0.000 | 3 | 0.000% | 0.000% |

### Runs that were discarded

The charge fell to about 20% during a first 60 Hz comparison, after which Chrome held every page at 30 fps, presumably its Energy Saver (both builds, from the third of five runs on; the render suite then measured 33.4 ms per frame on every preset). That comparison, the start-up and regeneration runs that followed and a set of pictures taken in that state are in no table; the first three are kept in `bench-results/memfix/onbattery`. All of them were repeated on mains, above.
