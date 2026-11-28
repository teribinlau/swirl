# SWIRL

Audio-reactive WebGL fluid simulation. The microphone drives a real-time
Navier-Stokes solver running entirely in the browser — speak, hum or play
music and the fluid responds in colour, intensity and rhythm.

## Features

- **Real-time fluid simulation** built on Pavel Dobryakov's WebGL fluid engine
- **Microphone-driven splat injection** across 6 log-spaced frequency bands
- **Onset detection** (spectral flux) triggers bursts on transients / beats
- **Rhythm analysis** — a second, unsmoothed analyser tells kick, snare, notes
  and hats apart, sizes every hit and spots the drop after a breakdown. All
  nine modes are choreographed from those events
- **9 mode presets** — each a complete scene (physics + trajectory + palette):
  Smoke (fog cannons fired by the drums) · Ink (brush strokes written on the
  beat) · Rainbow (a rainbow on the kick, a prism on the snare) · Aqua (jellyfish
  that swim on the kick) · Blink (raindrops landing on the beat) · Vortex (a
  whirlpool that winds in a new arm on every kick) · Kaleido (a mandala drawn
  ring by ring) · Comet (a meteor shower) · Pulse (a loudspeaker: band rings
  and a wave on every kick)
- **13 trajectories**: Random · Lissajous · Orbit · Sine wave · Smoke · Ink ·
  Rainbow · Aqua · Blink · Vortex · Kaleido · Comet · Pulse
- **12 post-processing filters**: CSS (Frost, Dream, Grain, Vignette), SVG
  displacement glass (Ripple, Pebbled, Diamond, Molten) and WebGL shader
  filters (fluted Reeded glass, true Halftone, ASCII, 1-bit Dither)
- **3 materials** — Classic (glowing pigment), Chrome (liquid metal), Oil
  (thin-film iridescence); any material stacks with any filter
- **3-mode palette system**: Full rainbow / Single hue family / Mono greyscale
- **Live settings panel** — every parameter is tunable, with tooltips
- **Persistent settings** — Save as default to localStorage; Copy as JSON
  to share or commit as new factory defaults
- **OpenCode-inspired UI** — 100% monospace, cream-on-ink, hairline borders

## Running locally

The site lives in `public/`. `getUserMedia` (microphone) requires a secure
context, so `file://` doesn't work — you need a local server, started from
inside that directory:

```bash
cd public

# Python
python -m http.server 8765

# Node
npx serve -l 8765
```

Then open `http://localhost:8765` and grant microphone access on first visit.

## Tech

- **WebGL fluid**: Forked from [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT)
- **Audio**: Web Audio API — `AnalyserNode` with `fftSize=2048`, custom
  spectral-flux onset detector, and a rhythm analyser on a second analyser
  (linear, peak-normalised flux per range: kick, snare / notes, hats)
- **Design system**: [opencode.ai](https://opencode.ai/) terminal aesthetic
  applied via [getdesign](https://github.com/) tokens

## Files

- `public/` — the site. Only this directory is deployed, and everything in it
  is served publicly
  - `index.html` — UI, styling (opencode design tokens), SVG displacement filter defs
  - `script.js` — Fluid engine + audio analyser + panel + filter pipeline
  - `LDR_LLL1_0.png` — blue-noise texture that dithers the bloom pass
- `wrangler.jsonc` — Cloudflare Workers config; serves `public/` as static assets
- `DESIGN.md` — Reference design system spec (opencode.ai)
- `film/` — source of the demo video: renders the real app frame by frame
  (see `film/README.md`), which also makes it the test bench for how the modes
  move with music; not deployed

## Licence

Fluid engine derived from Pavel Dobryakov's MIT-licensed code; rest of the
project follows the same licence.
