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
deterministic: re-rendering reproduces the same frames. Of the frames compared, most were
identical and one differed by a single level in a dozen pixels (checked with the pinned
Playwright's Chromium on software GL; a hardware GPU may differ more).

The video that was released shows the app as it was at commit `d4efbfd`. All nine modes have
been reworked since, so rendering against today's `../public` gives them their new choreography
under look-book settings (`K.LOOKS`) and captions that were made for the old ones: Aqua, for one,
comes out overexposed, and its caption still speaks of bubbles. Before a new release of the
video, retune the looks and rewrite the captions in `stage/shots/modes.js`. To get the released
frames again, render against that build of the app:

```bash
git worktree add /tmp/swirl-d4efbfd d4efbfd
```

```bash
SWIRL_APP=/tmp/swirl-d4efbfd/public npm run render
```

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

## Measuring how a mode moves with music

The same stage is the test bench for the app's rhythm: it can run any mode, exactly as shipped,
over any analysed soundtrack, and the soundtrack generator knows where every drum hit is.

- `node tools/rhythm_eval.js` runs the app's `Rhythm` analyser over the soundtrack and reports how
  many of the kicks, claps and hats it heard, how late, and a bar-by-bar timeline.
- `python3 tools/beatstrip.py <name> <MODE>` renders a strip of frames around a beat
  (`out/stills/strip_<name>.png`): what the picture does in the half second after a kick.
- `node tools/groove.js <MODE>` watches the picture the way a beat detector listens to sound and
  prints how much new light and motion follow a kick. `--json` keeps the per-frame series.
- `node tools/drawcost.js <MODE>` counts the draw calls and pixels a mode costs per frame.
- `npm run check` loads the app on its own in WebGL 2, in WebGL 1 and as a phone held upright,
  clicks through every mode and reports page errors, shaders that failed and modes that draw
  nothing.
- `beatstrip.py`, `groove.js` and `drawcost.js` take `--app <dir>` to run another build of the app
  (an older checkout of `public/`) for a before / after pair.
- Other music: `node tools/analyze.js 1 audio/test/x.wav audio/test/x` analyses any WAV into
  `x.bin` and `x_beat.bin`. With an `x_meta.json` beside them (`{"bpm": …, "kicks": [seconds, …]}`),
  `groove.js --audio audio/test/x`, `beatstrip.py --cfg '{"audio":"audio/test/x"}'` and
  `rhythm_eval.js audio/test/x_beat.bin audio/test/x_meta.json` run on it. `audio/test/` is not
  committed.

## What is staged

- The microphone is Chromium's fake capture device, relabelled `MACBOOK PRO MICROPHONE`; the
  second source in the mixer (`FILE: LATE-NIGHT-MIX.MP3`) is a silent stand-in.
- Cuts between modes are edits: each mode runs on its own pre-rolled simulation.
- Tooltips appear once the pointer has rested on a control for 8 frames; the app shows them at once.
- Pulse is shown with a tuned splat force, radius and diffusion; with the factory values its rings
  stretch into a column.
