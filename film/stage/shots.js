// Framework self-test: the app background colour encodes the frame number, so a captured
// frame that lags behind the simulation would show the wrong colour.
FILM.define('selftest', {
    start: FILM.bar(13), frames: 12, preroll: 60,
    setup () { FILM.app.preset('RAINBOW'); },
    before (ctx, f) { FILM.app.set({ 'config.BACK_COLOR': { r: 20 * f, g: 0, b: 255 - 20 * f } }); },
    after (ctx, f) {
        let tag = document.getElementById('tag');
        if (!tag) { tag = document.createElement('div'); tag.id = 'tag'; tag.style.cssText = 'position:absolute;left:24px;bottom:24px;font:700 28px var(--mono);color:#fff'; document.getElementById('gfx').appendChild(tag); }
        tag.textContent = 'f=' + f;
    },
});

// Look development: one mode / material / filter with arbitrary panel settings at a chosen spot
// of the soundtrack. Configured through window.SHOTCFG (see tools/looks.py).
FILM.define('look', {
    get start () { return (window.SHOTCFG && window.SHOTCFG.start) || FILM.bar(14); },
    get frames () { return (window.SHOTCFG && window.SHOTCFG.frames) || 1; },
    get preroll () { return (window.SHOTCFG && window.SHOTCFG.preroll) != null ? window.SHOTCFG.preroll : 150; },
    setup () {
        const c = window.SHOTCFG || {};
        // raw: the mode exactly as the app ships it (its preset and nothing else), instead of the film's look
        if (c.mode && c.raw) { FILM.app.preset(c.mode); if (c.set) FILM.app.set(c.set); }
        else if (c.mode) K.look(c.mode, c.set);
        else if (c.set) FILM.app.set(c.set);
        if (c.material) FILM.app.material(c.material);
        if (c.filter) FILM.app.filter(c.filter, c.intensity, c.scale);
        FILM.app.ui(!!c.ui);
        if (c.level != null) { FILM.level = c.level; }
        if (c.eval) FILM.w.eval(c.eval);
        if (c.size) {                       // another window shape, e.g. [405, 720] for a phone held upright
            const app = document.getElementById('app');
            app.style.width = c.size[0] + 'px'; app.style.height = c.size[1] + 'px';
        }
        if (c.probe) {                      // tools/groove.js: how much the picture changes from frame to frame
            const small = document.createElement('canvas'); small.width = 96; small.height = 54;
            window.__probe = { x: small.getContext('2d', { willReadFrequently: true }), prev: null, motion: [], rise: [], snap: [], light: [], low: [], mid: [], high: [], snare: [] };
        }
    },
    tick (ctx, f) {
        const P = window.__probe;
        if (!P || f < 0) return;
        // read the frame the app has just drawn, while its buffer still holds it
        P.x.drawImage(FILM.d.querySelector('canvas'), 0, 0, 96, 54);
        const d = P.x.getImageData(0, 0, 96, 54).data, lum = new Float32Array(96 * 54);
        // light: mean brightness. motion: mean change. rise: mean new light. snap: mean squared new light,
        // which a sudden bright shape dominates and a slow drift barely touches
        let sum = 0, diff = 0, rise = 0, snap = 0;
        for (let i = 0; i < lum.length; i++) {
            lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; sum += lum[i];
            if (P.prev) { const e = lum[i] - P.prev[i]; diff += Math.abs(e); if (e > 0) { rise += e; snap += e * e; } }
        }
        P.prev = lum; P.light.push(sum / lum.length); P.motion.push(diff / lum.length); P.rise.push(rise / lum.length); P.snap.push(snap / lum.length);
        const R = FILM.app.audio().rhythm;                 // absent in builds of the app from before the rhythm analyser
        P.low.push(R && R.low.struck ? R.low.strength : 0); P.mid.push(R && R.mid.struck ? R.mid.strength : 0);
        P.high.push(R && R.high.struck ? R.high.strength : 0); P.snare.push(R ? R.snare : 0);
    },
});

// Camera raster test: a static punch-in for a few frames (SHOTCFG: s, left, top, wc, panel)
FILM.define('camtest', {
    start: 1200, frames: 24, preroll: 40,
    setup () {
        const c = window.SHOTCFG || {};
        K.look('RAINBOW');
        if (c.panel) FILM.d.getElementById('panel-toggle').click();
        if (c.wc) document.getElementById('win').style.willChange = c.wc;
        if (c.css) { const st = FILM.d.createElement('style'); st.textContent = c.css; FILM.d.head.appendChild(st); }
    },
    after (ctx, f) {
        const c = window.SHOTCFG || {};
        if (c.panel) FILM.app.el('#panel').style.transform = 'translateX(0)';
        K.place(c.s || 1.5, c.left || 0, c.top || 0);
    },
});
