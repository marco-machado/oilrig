# Third-party notices

Oilrig's code was written for this project. It adapts the following open-source work.

## FFT ocean: owenyuwono/poseidon (MIT), after gasgiant/FFT-Ocean (MIT)

`apps/client/src/env/ocean/fft.ts`, `spectrum.ts` and `simulation.ts` port the GPU Stockham inverse FFT, the Horvath (2015) JONSWAP/TMA spectrum with directional spreading, the wavenumber-weighted choppiness, and the Jacobian foam accumulator. They follow https://github.com/owenyuwono/poseidon, which ports https://github.com/gasgiant/FFT-Ocean.

```
MIT License — Copyright (c) 2026 owenyuwono (poseidon); Copyright (c) 2020 Ivan Pensionerov (FFT-Ocean)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Sky: three.js SkyMesh (MIT)

`apps/client/src/env/sky.ts` adapts the Preetham scattering and procedural clouds from `three/examples/jsm/objects/SkyMesh.js`. It adds stars, a phase-lit moon, haze, overcast and storm handling. Copyright © 2010–2026 three.js authors, MIT License.

## Astronomy formulas

- **Sun position:** NOAA Solar Calculator equations (public domain, US Government).
- **Moon position and illumination:** the low-precision formulas from J. Meeus, *Astronomical Algorithms*, as arranged in suncalc (© Volodymyr Agafonkin, BSD-2-Clause).

Both are reimplemented in `packages/shared/src/sim/astronomy.ts`.

## Sound effects: ElevenLabs

The files in `apps/client/public/sfx` (footsteps on each surface, the drone's rotors, the elevator's motor, chime and doors, the sliding doors) were generated for this project with the ElevenLabs sound-effects API (`eleven_text_to_sound_v2`) by `scripts/sfx.ts`, which also cuts the footstep takes into single steps. Their use is governed by the ElevenLabs terms of service for the account that generated them.

## Fonts: Instrument Sans, Instrument Serif, JetBrains Mono (SIL Open Font License 1.1)

The UI's typefaces are bundled from npm (`@fontsource-variable/instrument-sans`, `@fontsource/instrument-serif`, `@fontsource-variable/jetbrains-mono`) and imported in `apps/client/src/ui/base.css`, so the game requests no fonts from other servers.

- Instrument Sans: Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans)
- Instrument Serif: Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)

All three are licensed under the SIL Open Font License, Version 1.1 (https://openfontlicense.org). The full license text ships with each package in its `LICENSE` file.
