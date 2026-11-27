// U03 — bars 13-20 (frames 1440-2399). Step 02: nine modes, one click each.
// Nine sub-shots (mode1..mode9), each its own pre-rolled simulation; the cut lands on the click.
// Everything drawn here is a function of the section frame L, so the sub-shots join seamlessly.
(() => {
    const { E, p, lerp, clamp } = FILM;
    const S0 = 1440, END = 960;
    const SLOTS = [['SMOKE', 0, 120], ['INK', 120, 120], ['RAINBOW', 240, 120], ['AQUA', 360, 120], ['BLINK', 480, 60],
                   ['VORTEX', 540, 60], ['KALEIDO', 600, 120], ['COMET', 720, 120], ['PULSE', 840, 120]];
    const TXT = {
        SMOKE: ['烟雾', '单色烟柱，最安静的一种'], INK: ['墨色', '靛蓝墨丝，在水里化开'], RAINBOW: ['彩虹', '六个频段，六种颜色'],
        AQUA: ['水母', '气泡从底部升起'], BLINK: ['涟漪', '雨滴落下的圆环'], VORTEX: ['漩涡', '所有声音卷进中心'],
        KALEIDO: ['万花筒', '六重对称的曼陀罗'], COMET: ['流星', '拖着尾巴划过画面'], PULSE: ['脉冲', '每一拍一次冲击波'],
    };
    const cam = K.track(K.TABS(), [[8, 56, ...K.pose(1), E.ioCubic], [914, 956, ...K.TABS(), E.ioCubic]]);
    const tab = m => K.at(`.modes button[data-mode="${m}"]`, 0, 2);

    function build () {
        const G = {};
        G.hdr = K.header('02', '模式', 'modes', '九种模式，各有各的流动方式。点一下就换。');
        G.call = K.callout('模式', 'left');
        G.big = K.big();
        G.strip = K.el('div', 'strip');
        G.segs = SLOTS.map(([, , len]) => { const e = K.el('div', 'seg', G.strip, '<i></i>'); e.style.flex = String(len); return e.firstChild; });
        G.ptr = K.pointer();
        SLOTS.forEach(([m, off, len], i) => { G.ptr.key(off - 2, tab(m), i === 0 ? 1 : (len < 100 ? 24 : 36)).click(off); });
        G.ptr.key(END - 4, tab('AQUA'), 46);
        return G;
    }

    function draw (G, L) {
        const [s, left, top] = cam(L);
        K.place(s, left, top);
        const i = SLOTS.findIndex(([, off, len]) => L >= off && L < off + len), [mode, off, len] = SLOTS[i];
        G.hdr.update(L - 38, p(L, 200, 220), S0 + L);
        G.call.update(p(L, 2, 26) * (1 - p(L, 40, 56)), K.rowRect('.modes'), 5);
        G.big.set(mode, i + 1, 9, TXT[mode][0], mode, TXT[mode][1]);
        // the first name waits for the camera to pull out of the tabs; the last one leaves before the push-in
        const a = L - off - (i === 0 ? 30 : 0);
        G.big.update(a, S0 + L, (i === 0 ? p(L, 30, 34) : 1) * (1 - p(L, 908, 920)));
        G.segs.forEach((e, k) => { const [, o, n] = SLOTS[k]; e.style.transform = `scaleX(${clamp((L - o) / n)})`; });
        G.strip.style.opacity = p(L, 30, 50) * (1 - p(L, 908, 920));
        G.ptr.update(L);
    }

    SLOTS.forEach(([mode, off, len], i) => {
        let G;
        FILM.define('mode' + (i + 1), {
            start: S0 + off, frames: len, preroll: 200,
            setup () { K.look(mode, mode === 'INK' ? { 'AUDIO.COLOR_GAIN': 0.40 } : null); G = build(); },
            after (ctx, f) { draw(G, off + f); },
        });
    });
})();
