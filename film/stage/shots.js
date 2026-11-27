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
        if (c.mode) K.look(c.mode, c.set); else if (c.set) FILM.app.set(c.set);
        if (c.material) FILM.app.material(c.material);
        if (c.filter) FILM.app.filter(c.filter, c.intensity, c.scale);
        FILM.app.ui(!!c.ui);
        if (c.level != null) { FILM.level = c.level; }
        if (c.eval) FILM.w.eval(c.eval);
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
