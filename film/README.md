# SWIRL demo video

Source of the 96-second demo video (1080p60). It is not a screen recording: the real app in
`../public` is rendered frame by frame in headless Chromium, driven by the film's own soundtrack,
with the titles, pointer and transitions drawn on a stage around it.

## Render it

Needs Node 18+, Python 3 with `numpy`, `scipy` and `Pillow`, and `ffmpeg` with libx264.

```bash
cd film
npm ci
npx playwright install chromium
npm run audio     # soundtrack, its per-frame analyser data, effects track and final mix (~1 min)
npm run render    # 32 chunks, 3 at a time -> lossless intermediates in out/shots (~7.5 GB)
npm run encode    # out/SWIRL-demo-1080p60.mp4 (CRF 18, ~310 MB)
```

`npm run render` took 31 minutes on 4 cores with Chromium's software GL. Everything is
deterministic: re-rendering reproduces the same frames, pixel for pixel (checked with the pinned
Playwright's Chromium on software GL; a hardware GPU may differ in the last bits).

Re-render only what changed, then encode again:

```bash
python3 tools/render_all.py --only mode2,panel --force mode2,panel
```

Smaller encodes:

```bash
bash tools/assemble.sh 24 out/SWIRL-demo-1080p60-web.mp4
```

```bash
bash tools/assemble.sh 27 out/SWIRL-demo-720p60-small.mp4 "scale=1280:720:flags=lanczos"
```

## How it works

- `stage/index.html` hosts the app in an iframe. `stage/appinit.js` gives it a fake clock, a seeded
  `Math.random` and film-time timers; `stage/film.js` takes over its frame loop, so one call to
  `FILM.frame(f)` advances the app by exactly 1/60 s.
- The app's `AnalyserNode` returns the soundtrack's own analyser data for that frame.
  `tools/analyze.js` computes it offline with Chrome's AnalyserNode at the app's settings, so the
  fluid reacts to the music exactly as it would live.
- `tools/render.js` screenshots each frame through the DevTools protocol and pipes the PNGs into
  ffmpeg. A shot replays its state changes before the first captured frame, so any frame range of
  any shot can be rendered on its own; `tools/render_all.py` uses that to render chunks in parallel.
- The pointer is drawn by the film but drives the real UI: hover styles, tooltips, clicks and
  slider `input` events all go through the app's own handlers.
- The material wipes and the triptych render the same simulation frame several times with
  different materials and composite them under the app's UI.

## Timeline

120 BPM at 60 fps, so one bar is 120 frames. Cuts land on bar lines.

| bars  | frames    | shots               | section                                        |
|-------|-----------|---------------------|------------------------------------------------|
| 1–8   | 0–959     | `open`              | cold open, title card, how it works            |
| 9–12  | 960–1439  | `sources`           | 01 sources                                     |
| 13–20 | 1440–2399 | `mode1`…`mode9`     | 02 modes                                       |
| 21–28 | 2400–3359 | `mat1`…`mat4`       | 03 materials                                   |
| 29–36 | 3360–4319 | `filt`, `combo1`…`6`| 04 filters, then mode × material × filter      |
| 37–40 | 4320–4799 | `panel`             | 05 settings panel                              |
| 41–44 | 4800–5279 | `pres1`…`pres5`     | 06 present mode                                |
| 45–48 | 5280–5759 | `outro`             | end card                                       |

## Editing

- Texts and timing live in `stage/shots/*.js`, one file per section. Shared components (headers,
  big names, pointer, camera) are in `stage/kit.js`, styles in `stage/film.css`.
- The look of each mode is a set of real panel settings: `K.LOOKS` in `stage/kit.js`.
- The soundtrack is `audio/synth.py`. Changing it changes the analyser data, and with it every
  frame of fluid.
- Preview without rendering a whole shot:

  ```bash
  node tools/render.js mode3 --stills 0,60
  ```

  Stills go to `out/stills`. `tools/looks.py` renders a batch of settings into one contact sheet,
  `tools/sheet.py` and `tools/filmsheet.py` build contact sheets from stills or from a video.
- Checks on a finished video: `tools/motioncheck.py` reports frozen frames and unexpected
  single-frame jumps, `tools/qrcheck.js` decodes the QR code of the end card from a frame.
- The shots click controls by selector and label. If the app's UI changes, the shots that use those
  controls need the same change.

## What is staged

- The microphone is Chromium's fake capture device, relabelled `MACBOOK PRO MICROPHONE`; the
  second source in the mixer (`FILE: LATE-NIGHT-MIX.MP3`) is a silent stand-in.
- Cuts between modes are edits: each mode runs on its own pre-rolled simulation.
- Tooltips appear once the pointer has rested on a control for 8 frames; the app shows them at once.
- Pulse is shown with a tuned splat force, radius and diffusion; with the factory values its rings
  stretch into a column.
