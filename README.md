# SWIRL

Audio-reactive WebGL fluid simulation. The microphone drives a real-time
Navier-Stokes solver running entirely in the browser — speak, hum or play
music and the fluid responds in colour, intensity and rhythm.

## Features

- **Real-time fluid simulation** built on Pavel Dobryakov's WebGL fluid engine
- **Microphone-driven splat injection** across 6 log-spaced frequency bands
- **Onset detection** (spectral flux) triggers bursts on transients / beats
- **5 mode presets**: Default · Smoke · Ink · Rainbow · Aqua (rising bubbles)
- **5 trajectories**: Random · Lissajous · Orbit · Sine wave · Aqua
- **11 post-processing filters**, including SVG displacement glass effects
  (Reeded, Ripple, Pebbled, Diamond, Molten)
- **3-mode palette system**: Full rainbow / Single hue family / Mono greyscale
- **Live settings panel** — every parameter is tunable, with tooltips
- **Persistent settings** — Save as default to localStorage; Copy as JSON
  to share or commit as new factory defaults
- **OpenCode-inspired UI** — 100% monospace, cream-on-ink, hairline borders

## Running locally

`getUserMedia` (microphone) requires a secure context, so `file://` doesn't
work — you need a local server:

```bash
# Python
python -m http.server 8765

# Node
npx serve .
```

Then open `http://localhost:8765` and grant microphone access on first visit.

## Tech

- **WebGL fluid**: Forked from [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT)
- **Audio**: Web Audio API — `AnalyserNode` with `fftSize=2048`, custom
  spectral-flux onset detector
- **Design system**: [opencode.ai](https://opencode.ai/) terminal aesthetic
  applied via [getdesign](https://github.com/) tokens

## Files

- `index.html` — UI, styling (opencode design tokens), SVG displacement filter defs
- `script.js` — Fluid engine + audio analyser + panel + filter pipeline
- `DESIGN.md` — Reference design system spec (opencode.ai)

## Licence

Fluid engine derived from Pavel Dobryakov's MIT-licensed code; rest of the
project follows the same licence.
