// U04 — bars 21-28 (frames 2400-3359). Step 03: one fluid, three materials.
//   mat1  L   0-239  AQUA     classic -> (wipe) chrome
//   mat2  L 240-479  KALEIDO  chrome -> (iris) oil
//   mat3  L 480-719  COMET    chrome: the two knobs — tint and relief
//   mat4  L 720-959  RAINBOW  triptych: the same simulation frame rendered three ways
// Wipes and the triptych draw the *same* simulation frame with several materials (K.renderAs)
// into a 2D canvas that sits between the app's WebGL canvas and its UI.
(() => {
    const { E, p, lerp, clamp } = FILM;
    const S0 = 2400, W = 1920, H = 1080;
    const cam = K.track(K.TABS(), [
        [66, 112, ...K.pose(1), E.ioCubic],
        [530, 566, ...K.pose(1.32, 0, 0), E.ioCubic],
        [694, 716, ...K.pose(1), E.ioCubic],
    ]);
    const mtab = m => K.at(`.materials button[data-material="${m}"]`, 0, 2);
    const tab = m => K.at(`.modes button[data-mode="${m}"]`, 0, 2);
    const NAMES = { CHROME: [2, '液态铬', 'CHROME', '把颜料变成流动的金属'], OIL: [3, '油膜', 'OIL', '薄膜干涉，一层会变色的油光'] };
    const WIPE = [60, 112], IRIS = [360, 410], PANEL = 526, PCLOSE = 692;

    function build (sub) {
        const G = { sub };
        const d = FILM.d;
        K.fx();
        G.hdr = K.header('03', '材质', 'materials', '同一股流体，换一种材质。');
        G.call = K.callout('材质', 'left');
        G.big = K.big();
        G.cap = K.caption('染色 · 起伏', 'tint & relief — from mirror silver to liquid gold', 'right');
        G.capSub = K.el('div', 'cap-sub', G.cap.root, '两个旋钮，从镜面银到流动的金');
        // triptych
        G.tri = K.el('div', 'tri');
        G.triTop = K.el('div', 'tri-top', G.tri, '<b>同一帧模拟，三种材质</b><span>one simulation · three materials</span>');
        G.triLab = [['默认', 'CLASSIC'], ['液态铬', 'CHROME'], ['油膜', 'OIL']].map(([zh, en]) => K.el('div', 'tri-lab', G.tri, `<b>${zh}</b><span>${en}</span>`));
        K.show(G.tri, false);
        // pointer: one path for the whole section
        const tint = () => K.range('Tint'), relief = () => K.range('Relief');
        G.ptr = K.pointer()
            .key(-2, tab('AQUA'), 1).click(0)
            .key(56, mtab('CHROME'), 44).click(60)
            .key(238, tab('KALEIDO'), 60).click(240)
            .key(356, mtab('OIL'), 50).click(360)
            .key(478, mtab('CHROME'), 46).click(480)
            .key(PANEL - 2, K.at('#panel-toggle', 6, 1), 36).click(PANEL)
            .key(572, () => K.thumb(tint())(), 26)
            .key(634, () => K.thumb(tint())(), 1)
            .key(648, () => K.thumb(relief())(), 14)
            .key(PCLOSE - 2, K.at('#panel-close'), 10).click(PCLOSE)
            .key(718, tab('RAINBOW'), 24).click(720)
            .hideFrom(728);
        G.ptr.tips = false;
        return G;
    }

    // triptych weights over time (local t = L - 720)
    const TRI = [[0, [1, 0, 0]], [44, [1 / 3, 1 / 3, 1 / 3]], [120, [1 / 3, 1 / 3, 1 / 3]], [138, [0.5, 0.25, 0.25]], [150, [0.5, 0.25, 0.25]],
                 [168, [0.25, 0.5, 0.25]], [180, [0.25, 0.5, 0.25]], [198, [0.25, 0.25, 0.5]], [210, [0.25, 0.25, 0.5]], [226, [1 / 3, 1 / 3, 1 / 3]]];
    const weights = t => {
        let w = TRI[0][1];
        for (let i = 1; i < TRI.length; i++) {
            const [f1, w1] = TRI[i], [f0, w0] = TRI[i - 1];
            if (t >= f1) { w = w1; continue; }
            if (t > f0) { const q = E.ioCubic((t - f0) / (f1 - f0)); w = w0.map((v, k) => lerp(v, w1[k], q)); }
            break;
        }
        return w;
    };

    function draw (G, L) {
        const d = FILM.d, fx = FILM.fx, x = FILM.fxc, win = document.getElementById('win');
        const [s, left, top] = cam(L);
        K.place(s, left, top);
        let comp = false;
        win.style.clipPath = '';

        // ---- mat1: wipe classic -> chrome (the line runs in frame coordinates while the camera pulls out)
        if (L >= WIPE[0] && L < WIPE[1]) {
            comp = true;
            const lx = lerp(-40, 1320, p(L, WIPE[0], WIPE[1], E.ioCubic)), ax = (lx - left) / s * 1.5, k = 70;
            K.snap();                                                   // chrome (already the app's material)
            K.renderAs({ MATERIAL: 'DEFAULT' });
            K.snap(c => { c.moveTo(ax + k, 0); c.lineTo(W, 0); c.lineTo(W, H); c.lineTo(ax - k, H); c.closePath(); });
            line(x, [[ax + k, 0], [ax - k, H]], s);
        }
        // ---- mat2: iris chrome -> oil
        if (L >= IRIS[0] && L < IRIS[1]) {
            comp = true;
            const r = 1150 * p(L, IRIS[0], IRIS[1], E.ioCubic);
            K.snap();                                                   // oil
            K.renderAs({ MATERIAL: 'CHROME', MATERIAL_TINT: 0.6 });
            K.snap(c => { c.rect(0, 0, W, H); c.arc(W / 2, H / 2, r, 0, Math.PI * 2, true); });
            x.save(); x.beginPath(); x.arc(W / 2, H / 2, r, 0, Math.PI * 2); x.lineWidth = 3; x.strokeStyle = 'rgba(253,252,252,.95)'; x.shadowColor = 'rgba(253,252,252,.8)'; x.shadowBlur = 14; x.stroke(); x.restore();
        }
        // ---- mat4: triptych
        const t = L - 720;
        K.show(G.tri, t >= 0);
        if (t >= 0) {
            comp = true;
            const [wa, wb] = weights(t), k = 64;
            const b1 = (W + 2 * k) * wa - k + (wa >= 0.999 ? 4 * k : 0), b2 = (W + 2 * k) * (wa + wb) - k + (wa + wb >= 0.999 ? 4 * k : 0);
            K.snap();                                                   // classic
            if (b1 < W + k) {
                K.renderAs({ MATERIAL: 'CHROME' });
                K.snap(c => { c.moveTo(b1 + k, 0); c.lineTo(b2 + k, 0); c.lineTo(b2 - k, H); c.lineTo(b1 - k, H); c.closePath(); });
            }
            if (b2 < W + k) {
                K.renderAs({ MATERIAL: 'OIL' });
                K.snap(c => { c.moveTo(b2 + k, 0); c.lineTo(W, 0); c.lineTo(W, H); c.lineTo(b2 - k, H); c.closePath(); });
            }
            line(x, [[b1 + k, 0], [b1 - k, H]], 1); line(x, [[b2 + k, 0], [b2 - k, H]], 1);
            // labels follow their panels
            const edges = [-k, b1, b2, W + k], vis = p(t, 30, 54);
            G.triLab.forEach((e, i) => {
                const cx = (Math.max(0, edges[i]) + Math.min(W, edges[i + 1])) / 2 / 1.5, wpx = (edges[i + 1] - edges[i]) / 1.5;
                const big = clamp((wpx - 330) / 300);
                e.style.left = (cx - 28) + 'px'; e.style.opacity = vis * clamp((wpx - 120) / 120) * (0.62 + 0.38 * big);
                e.style.transform = `translateX(-50%) scale(${(0.86 + 0.3 * big).toFixed(3)})`;
            });
            G.triTop.style.opacity = p(t, 40, 64) * (1 - p(t, 206, 216));
            // the aperture shuts just before the drop
            const shut = p(t, 214, 237, E.inQuart);
            if (shut > 0) win.style.clipPath = `inset(${(shut * 361).toFixed(2)}px 0 ${(shut * 361).toFixed(2)}px 0)`;
            G.tri.style.opacity = 1 - p(t, 214, 228);
        }
        fx.style.display = comp ? '' : 'none';
        d.querySelector('.ui').style.opacity = t >= 0 ? 1 - p(t, 4, 16) : '';

        // ---- panel (mat3)
        K.panelSlide(L, PANEL, PCLOSE);

        // ---- film graphics
        G.hdr.update(L - 104, p(L, 222, 240), S0 + L);
        G.call.update(p(L, 8, 30) * (1 - p(L, 62, 76)), K.rowRect('.materials'), 5);
        const mat = L < 410 ? 'CHROME' : 'OIL', since = L < 410 ? 114 : 410;
        G.big.set(mat, NAMES[mat][0], 3, NAMES[mat][1], NAMES[mat][2], NAMES[mat][3]);
        G.big.update(L - since, S0 + L, (L < 114 ? 0 : 1) * (1 - p(L, 348, 360)) + (L >= 410 ? 1 : 0) * (1 - p(L, 468, 480)));
        G.cap.update(L - 576, p(L, PCLOSE - 6, PCLOSE + 8));
        G.cap.root.style.visibility = L < 576 || L > PCLOSE + 10 ? 'hidden' : '';
        G.capSub.style.opacity = p(L, 596, 614) * 0.92;
        G.ptr.update(L);
    }

    function line (x, pts, s) {
        x.save(); x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); x.lineTo(pts[1][0], pts[1][1]);
        x.lineWidth = 3 / s; x.strokeStyle = 'rgba(253,252,252,.95)'; x.shadowColor = 'rgba(253,252,252,.8)'; x.shadowBlur = 14 / s; x.stroke(); x.restore();
    }

    const SUBS = [
        ['mat1', 0, 'AQUA', () => {}, (f) => { if (f === 60) FILM.app.material('CHROME'); }],
        ['mat2', 240, 'KALEIDO', () => { FILM.app.material('CHROME'); FILM.app.set({ 'config.MATERIAL_TINT': 0.6 }); },
            (f) => { if (f === 120) { FILM.app.material('OIL'); FILM.app.set({ 'config.MATERIAL_TINT': 0.4 }); } }],
        ['mat3', 480, 'COMET', () => {
            FILM.app.material('CHROME');
            const panel = FILM.app.el('#panel');                      // the panel opens already scrolled to its Material section
            panel.scrollTop = K.ctrl('Material').closest('section').offsetTop - 84;
        }, (f) => {
            const L = 480 + f;
            if (L === PANEL) FILM.d.getElementById('panel-toggle').click();
            if (L > 576 && L <= 630) K.setRange(K.range('Tint'), lerp(0.4, 0.92, E.ioCubic((L - 576) / 54)).toFixed(2));
            if (L > 650 && L <= 680) K.setRange(K.range('Relief'), lerp(5, 2.4, E.ioCubic((L - 650) / 30)).toFixed(1));
            if (L === PCLOSE) FILM.d.getElementById('panel-close').click();
        }],
        ['mat4', 720, 'RAINBOW', () => {}, () => {}],
    ];
    SUBS.forEach(([name, off, mode, init, before]) => {
        let G;
        FILM.define(name, {
            start: S0 + off, frames: 240, preroll: 200,
            setup () { K.look(mode); init(); G = build(name); },
            before (ctx, f) { if (f >= 0) before(f); },
            after (ctx, f) { draw(G, off + f); },
        });
    });
})();
