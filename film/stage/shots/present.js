// U07 — bars 41-44 (frames 4800-5279). Step 06: present mode — one click hides the interface.
// Five sub-shots (pres1..5), each its own pre-rolled simulation, cut on the bar (the last bar on the half).
(() => {
    const { E, p, lerp, clamp } = FILM;
    const S0 = 4800;
    // [mode, material, extra look settings, start, length, label]
    const LOOKS = [
        ['KALEIDO', 'CHROME', { 'config.MATERIAL_TINT': 0.6 }, 0, 120, ['万花筒', '液态铬']],
        ['AQUA', 'CHROME', {}, 120, 120, ['水母', '液态铬']],
        ['COMET', 'CHROME', { 'config.MATERIAL_RELIEF': 2.5, 'config.MATERIAL_TINT': 0.9 }, 240, 120, ['流星', '液态铬']],
        ['RAINBOW', 'OIL', {}, 360, 60, ['彩虹', '油膜']],
        ['KALEIDO', 'OIL', {}, 420, 60, ['万花筒', '油膜']],
    ];

    function build () {
        const G = {};
        G.hdr = K.header('06', '展示', 'present', '一键隐藏界面，只留下画面。');
        G.tag = K.el('div', 'look-tag');
        G.ptr = K.pointer().key(-2, K.at('#present-toggle', 4, 1), 1).click(0).hideFrom(16);
        return G;
    }
    function draw (G, L) {
        const i = LOOKS.findIndex(l => L >= l[3] && L < l[3] + l[4]), look = LOOKS[i], a = L - look[3];
        K.place(1, 0, 0);
        G.hdr.update(L - 12, p(L, 150, 172), S0 + L);
        G.tag.innerHTML = `<b>${look[5][0]}</b><i>×</i><b>${look[5][1]}</b>`;
        G.tag.style.opacity = (i === 0 ? p(L, 30, 46) : p(a, 4, 16)) * (1 - p(L, 468, 478));
        G.tag.style.transform = `translateY(${((1 - p(a, 4, 20, E.outCubic)) * 8).toFixed(2)}px)`;
        G.ptr.update(L);
    }

    LOOKS.forEach(([mode, material, extra, off, len], i) => {
        let G;
        FILM.define('pres' + (i + 1), {
            start: S0 + off, frames: len, preroll: 200,
            setup () {
                K.look(mode, extra); FILM.app.material(material);
                if (i > 0) FILM.d.getElementById('present-toggle').click();      // already presenting
                G = build();
            },
            before (ctx, f) { if (i === 0 && f === 0) FILM.d.getElementById('present-toggle').click(); },
            after (ctx, f) { draw(G, off + f); },
        });
    });
})();
