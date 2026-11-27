// SWIRL film — stage framework.
// The real app runs in an iframe. Nothing here is real-time: every video frame is produced by
// FILM.frame(f), which (1) lets the shot change app state / graphics, (2) advances the app by
// exactly one 1/60 s frame with a fake clock, (3) feeds its analyser the soundtrack's own
// analyser data for that frame. The renderer then screenshots the page.
(() => {
    const FPS = 60, PER = 3072;
    const $ = (s, r = document) => r.querySelector(s);
    const FILM = window.FILM = { FPS, shots: {}, feat: null, musicFrame: -1, t: 0 };
    FILM.define = (name, def) => { def.name = name; FILM.shots[name] = def; };

    // ---------------------------------------------------------------- music time helpers (120 BPM)
    const BEAT = 30, BAR = 120;                       // frames
    FILM.BEAT = BEAT; FILM.BAR = BAR;
    FILM.bar = (bar, beat = 0) => (bar - 1) * BAR + beat * BEAT;     // global frame of bar (1-indexed) + beats

    // ---------------------------------------------------------------- easing
    const E = FILM.E = {
        lin: x => x,
        inQuad: x => x * x, outQuad: x => 1 - (1 - x) * (1 - x), ioQuad: x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2,
        inCubic: x => x * x * x, outCubic: x => 1 - Math.pow(1 - x, 3), ioCubic: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
        outQuart: x => 1 - Math.pow(1 - x, 4), inQuart: x => x * x * x * x, ioQuart: x => x < .5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2,
        outExpo: x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x), inExpo: x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10),
        ioExpo: x => x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
        outBack: x => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
        // the app's own panel curve: cubic-bezier(0.22, 1, 0.36, 1)
        panel: x => bezier(0.22, 1, 0.36, 1)(x),
    };
    function bezier (x1, y1, x2, y2) {
        const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
        const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t;
        return x => { let t = x; for (let i = 0; i < 8; i++) { const d = sx(t) - x; if (Math.abs(d) < 1e-5) break; t -= d / ((3 * ax * t + 2 * bx) * t + cx || 1e-6); } return sy(Math.max(0, Math.min(1, t))); };
    }
    FILM.bezier = bezier;
    // progress of frame f through [a, b], clamped 0..1, eased
    FILM.p = (f, a, b, ease = E.lin) => ease(Math.max(0, Math.min(1, (f - a) / Math.max(1e-6, b - a))));
    FILM.lerp = (a, b, x) => a + (b - a) * x;
    FILM.clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

    // ---------------------------------------------------------------- soundtrack analysis
    async function loadFeatures () {
        FILM.feat = new Uint8Array(await (await fetch('/audio/features.bin')).arrayBuffer());
        FILM.featFrames = FILM.feat.length / PER;
        FILM.kicks = (await (await fetch('/audio/music_meta.json')).json()).kicks;      // kick drum times, seconds
    }
    const SILENT_T = new Uint8Array(2048).fill(128), SILENT_F = new Uint8Array(1024);
    const valid = i => i >= 0 && i < FILM.featFrames - 1;
    FILM.freqAt = i => valid(i) ? FILM.feat.subarray(i * PER, i * PER + 1024) : SILENT_F;
    FILM.timeAt = i => valid(i) ? FILM.feat.subarray(i * PER + 1024, i * PER + PER) : SILENT_T;

    // ---------------------------------------------------------------- app boot
    const wait = ms => new Promise(r => setTimeout(r, ms));
    async function until (fn, ms = 60000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + fn); await wait(50); } }

    FILM.boot = async function ({ lang = 'zh', width = 1280, height = 720 } = {}) {
        localStorage.setItem('swirl-lang', lang);
        localStorage.removeItem('swirl-settings-v1');
        const iframe = $('#app');
        iframe.style.width = width + 'px'; iframe.style.height = height + 'px';
        await new Promise(r => { iframe.onload = r; iframe.src = '/app/index.html'; });
        const w = FILM.w = iframe.contentWindow, d = FILM.d = w.document;
        // local fonts for the app UI (the film machine has no network fonts) + no real-time CSS transitions
        for (const css of ['jetbrains-mono/400.css', 'jetbrains-mono/500.css', 'jetbrains-mono/700.css', 'noto-sans-sc/400.css', 'noto-sans-sc/500.css', 'noto-sans-sc/700.css']) {
            const l = d.createElement('link'); l.rel = 'stylesheet'; l.href = '/node_modules/@fontsource/' + css; d.head.appendChild(l);
        }
        const st = d.createElement('style');
        st.textContent = `:root { --font-mono: 'JetBrains Mono', 'Noto Sans SC', ui-monospace, monospace; }
            *, *::before, *::after { transition: none !important; }
            html, body { cursor: none !important; }
            /* Chromium's occlusion culling drops part of the WebGL canvas when the window is scaled and an
               opaque scroller sits over it; a hair of transparency keeps these surfaces out of that pass */
            .panel, .tooltip.visible { opacity: 0.999; }`;
        d.head.appendChild(st);
        await until(() => w.__audio && w.__audio.ready);
        // take over the frame loop
        w.__frame = w.update; w.update = function () {};
        await new Promise(r => w.requestAnimationFrame(() => w.requestAnimationFrame(() => w.requestAnimationFrame(r))));
        // the analyser now returns the soundtrack's data for FILM.musicFrame
        const an = w.__audio.analyser;
        an.getByteFrequencyData = arr => arr.set(FILM.freqAt(FILM.musicFrame));
        an.getByteTimeDomainData = arr => arr.set(FILM.timeAt(FILM.musicFrame));
        FILM.resetFluid();
        // every glyph the UI can show, so no text pops in mid-shot
        const zh = w.eval('STRINGS').zh;
        const all = Object.values(zh).join('') + Object.keys(zh).join('') + (FILM.extraGlyphs || '');
        for (const fam of ['Noto Sans SC', 'JetBrains Mono']) for (const wt of [400, 500, 700]) {
            await d.fonts.load(`${wt} 14px "${fam}"`, all).catch(() => {});
        }
        await d.fonts.ready;
        // a believable input device name instead of Chrome's fake capture device
        const src = w.__audio.sources[0];
        if (src) { src.label = FILM.micLabel || 'MACBOOK PRO MICROPHONE'; w.__audio.onSourcesChanged(); }
        // every :hover rule gets a .film-hover twin, so the film's pointer can light up controls
        for (const sheet of d.styleSheets) {
            let rules; try { rules = [...sheet.cssRules]; } catch (e) { continue; }
            for (const r of rules) if (r.selectorText && r.selectorText.includes(':hover')) {
                try { sheet.insertRule(r.cssText.replace(r.selectorText, r.selectorText.replace(/:hover/g, '.film-hover')), sheet.cssRules.length); } catch (e) {}
            }
        }
        w.__filmTimers = true;             // from here on the app's setTimeout runs on film time
        return w;
    };

    FILM.resetFluid = function (seed = 12345) {
        const w = FILM.w, gl = w.eval('gl');
        for (const f of w.eval('[dye.read, dye.write, velocity.read, velocity.write, pressure.read, pressure.write]')) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        }
        w.__seed(seed);
        const a = w.__audio;
        a.smoothedBands.fill(0); a.bands.fill(0); a.smoothedVolume = 0; a.volume = 0; a.onset = false;
        a.fluxHistory.length = 0; a.prevSpectrum.fill(0); a.lastOnsetTime = 0;
    };

    // one simulation + render step of the app, driven by soundtrack frame `musicFrame`
    FILM.step = function (musicFrame) {
        const w = FILM.w;
        FILM.musicFrame = musicFrame;
        w.__now += 1000 / FPS;
        w.__runTimers();
        w.__frame();
        // CSS animations inside the app (grain jitter, dream hue) follow film time, not wall time
        const tms = (musicFrame / FPS) * 1000 + 600000;
        for (const an of FILM.d.getAnimations()) { an.pause(); an.currentTime = tms; }
    };

    // ---------------------------------------------------------------- app helpers for shots
    FILM.app = {
        preset (name) { FILM.w.applyPreset(name); },
        material (name) { FILM.w.eval('config').MATERIAL = name; FILM.w.applyMaterial(); FILM.w.refreshPanel(); },
        filter (name, intensity, scale) {
            const fs = FILM.w.eval('filterState');
            fs.name = name; if (FILM.w.isGlassFilter(name)) FILM.w.loadGlassPreset(name);
            if (intensity != null) fs.intensity = intensity; if (scale != null) fs.scale = scale;
            FILM.w.applyFilter(); FILM.w.refreshPanel();
        },
        set (obj) {                       // { 'config.CURL': 12, 'AUDIO.COLOR_GAIN': 0.8, 'PALETTE.mode': 'MONO' }
            for (const k in obj) { const [root, key] = k.split('.'); FILM.w.eval(root)[key] = obj[k]; }
            FILM.w.updateKeywords(); FILM.w.refreshPanel();
        },
        get (path) { const [root, key] = path.split('.'); return FILM.w.eval(root)[key]; },
        audio () { return FILM.w.__audio; },
        el (sel) { return FILM.d.querySelector(sel); },
        rect (sel) { const e = typeof sel === 'string' ? FILM.d.querySelector(sel) : sel; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; },
        ui (visible) { FILM.d.querySelector('.ui').style.display = visible ? '' : 'none'; },
    };

    // ---------------------------------------------------------------- shot lifecycle
    // from: first frame that will be rendered. Everything before it (the shot's own preroll plus
    // frames 0..from-1) is simulated without being captured, replaying the shot's state changes,
    // so any range of a shot can be rendered on its own and still match a full render.
    FILM.init = async function (name, from = 0) {
        const shot = FILM.shot = FILM.shots[name];
        if (!shot) throw new Error('no shot ' + name);
        await loadFeatures();
        const ctx = FILM.ctx = { shot, f: -1 };
        if (shot.boot !== false) await FILM.boot(shot.bootOptions || {});
        if (shot.setup) await shot.setup(ctx);
        const pre = shot.preroll || 0;
        for (let i = -pre; i < from; i++) {
            ctx.f = i; ctx.g = shot.start + i; ctx.pre = true;
            if (shot.before) shot.before(ctx, i);
            if (shot.boot !== false && shot.step !== false) FILM.step(shot.start + i);
            if (shot.tick) shot.tick(ctx, i);
        }
        ctx.pre = false; ctx.f = from - 1;
        await document.fonts.ready;
        return { name, frames: shot.frames, start: shot.start };
    };

    FILM.frame = function (f) {
        const shot = FILM.shot, ctx = FILM.ctx;
        if (f !== ctx.f + 1) throw new Error(`frames must be sequential: got ${f} after ${ctx.f}`);
        ctx.f = f; ctx.t = f / FPS; ctx.g = shot.start + f;
        if (shot.before) shot.before(ctx, f);                 // app state changes (clicks, presets…)
        if (shot.boot !== false && shot.step !== false) FILM.step(shot.start + f);
        if (shot.tick) shot.tick(ctx, f);                     // state tracking that must also run in preroll
        if (shot.after) shot.after(ctx, f);                   // graphics that read the freshly rendered frame
        return new Promise(r => requestAnimationFrame(() => r(f)));
    };
})();
