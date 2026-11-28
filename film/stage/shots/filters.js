// U05 — bars 29-36 (frames 3360-4319). Step 04: twelve filters, then everything multiplied.
//   filt     L   0-599  one continuous RAINBOW simulation; a filter per two beats (the last four: one beat each)
//   combo1-6 L 600-959  mode x material x filter, a new combination every two beats; the last one carries the sum
(() => {
    const { E, p, lerp, clamp } = FILM;
    const S0 = 3360;
    // [filter, Chinese (as in the UI), descriptor, start, length, intensity]
    const SLOTS = [
        ['REEDED', '凹槽', '长虹玻璃，竖纹折射', 0, 60], ['HALFTONE', '半调', '印刷网点', 60, 60], ['ASCII', '字符画', '把流体写成字符', 120, 60], ['DITHER', '抖动', '1-bit 有序抖动', 180, 60],
        ['RIPPLE', '波纹', '水波纹玻璃', 240, 60], ['PEBBLED', '鹅卵石', '压花玻璃', 300, 60], ['DIAMOND', '菱形', '菱形切面玻璃', 360, 60], ['MOLTEN', '熔融', '熔化流淌的玻璃', 420, 60],
        ['FROST', '磨砂', '磨砂玻璃', 480, 30], ['DREAM', '梦境', '柔光与色散', 510, 30], ['GRAIN', '颗粒', '胶片颗粒', 540, 30], ['VIGNETTE', '暗角', '镜头暗角', 570, 30],
    ];
    // [intensity, scale] found by look development on this simulation
    const PARAM = { REEDED: [50, 60], HALFTONE: [50, 70], ASCII: [100, 90], DITHER: [100, 70], RIPPLE: [85, 50], PEBBLED: [85, 50], DIAMOND: [85, 50], MOLTEN: [80, 50],
                    FROST: [50, 50], DREAM: [50, 50], GRAIN: [100, 50], VIGNETTE: [100, 50] };
    const ftab = n => K.at(`.filters button[data-filter="${n}"]`, 0, 2);

    // ------------------------------------------------------------------ part A
    let A = null;
    FILM.define('filt', {
        start: S0, frames: 600, preroll: 240,
        setup () {
            K.look('RAINBOW');
            const G = A = {};
            G.hdr = K.header('04', '滤镜', 'filters', '十二种滤镜，叠在任何画面上。');
            G.call = K.callout('滤镜', 'left');
            G.big = K.big();
            G.strip = K.el('div', 'strip');
            G.segs = SLOTS.map(s => { const e = K.el('div', 'seg', G.strip, '<i></i>'); e.style.flex = String(s[4]); return e.firstChild; });
            G.ptr = K.pointer();
            SLOTS.forEach((s, i) => { G.ptr.key(s[3] - 2, ftab(s[0]), i === 0 ? 1 : (s[4] < 50 ? 14 : 24)).click(s[3]); });
            G.ptr.hideFrom(592);
        },
        before (ctx, f) {
            const s = SLOTS.find(s => s[3] === f);
            if (s) FILM.app.filter(s[0], PARAM[s[0]][0], PARAM[s[0]][1]);
        },
        after (ctx, f) {
            const G = A, i = SLOTS.findIndex(s => f >= s[3] && f < s[3] + s[4]), s = SLOTS[i];
            K.place(1, 0, 0);
            G.hdr.update(f - 8, p(f, 216, 236), S0 + f);
            G.call.update(p(f, 6, 30) * (1 - p(f, 100, 116)), K.rowRect('.filters'), 4);
            G.big.set(s[0], i + 1, 12, s[1], s[0], s[2]);
            G.big.update(f - s[3], S0 + f, 1);
            G.segs.forEach((e, k) => { e.style.transform = `scaleX(${clamp((f - SLOTS[k][3]) / SLOTS[k][4])})`; });
            G.ptr.update(f);
        },
    });

    // ------------------------------------------------------------------ part B
    // [mode, material, filter, extra look settings, filter intensity]
    const COMBOS = [
        ['AQUA', 'CHROME', 'DITHER', {}],
        ['INK', 'OIL', 'HALFTONE', {}],
        ['SMOKE', 'CHROME', 'MOLTEN', { 'config.CURL': 1, 'AUDIO.COLOR_GAIN': 0.25, 'config.MATERIAL_RELIEF': 3 }],
        ['RAINBOW', 'OIL', 'RIPPLE', {}],
        ['COMET', 'CHROME', 'REEDED', { 'config.MATERIAL_RELIEF': 2.5, 'config.MATERIAL_TINT': 0.9 }],
        ['KALEIDO', 'OIL', 'DIAMOND', {}],
    ];
    const ZH = { AQUA: '水母', INK: '墨色', SMOKE: '烟雾', RAINBOW: '彩虹', COMET: '流星', KALEIDO: '万花筒', CHROME: '液态铬', OIL: '油膜',
                 DITHER: '抖动', HALFTONE: '半调', MOLTEN: '熔融', RIPPLE: '波纹', REEDED: '凹槽', DIAMOND: '菱形', VIGNETTE: '暗角' };
    const B0 = 600;

    function buildB () {
        const G = {};
        G.shade = K.el('div', 'slot-shade');
        G.root = K.el('div', 'slot');
        G.cells = ['模式', '材质', '滤镜'].map((lab, k) => {
            if (k) K.el('div', 'slot-x', G.root, '×');
            const cell = K.el('div', 'slot-cell', G.root, `<small>${lab}</small><div class="reel"><b class="a"></b><b class="b"></b></div><em></em>`);
            return { a: cell.querySelector('.a'), b: cell.querySelector('.b'), num: cell.querySelector('em'), cell };
        });
        G.eq = K.el('div', 'slot-eq', G.root, '<span class="eqs">=</span><b>324</b><i>种画面</i>');
        return G;
    }
    function drawB (G, L) {
        const t = L - B0, i = clamp(Math.floor(t / 60), 0, 5), a = t - i * 60;
        const cur = COMBOS[i], prev = COMBOS[Math.max(0, i - 1)];
        K.place(1, 0, 0);
        const sum = i === 5 ? p(a, 14, 34, E.outExpo) : 0;                // the last combination turns into the sum
        G.cells.forEach((c, k) => {
            const q = E.outExpo(clamp((a - k * 2) / 10));
            c.a.textContent = i === 0 ? '' : ZH[prev[k]]; c.b.textContent = ZH[cur[k]];
            c.a.style.transform = `translateY(${(-q * 104).toFixed(2)}%)`;
            c.b.style.transform = `translateY(${((1 - q) * 104).toFixed(2)}%)`;
            c.a.style.opacity = 1 - sum; c.b.style.opacity = 1 - sum;
            c.num.textContent = String(Math.round([9, 3, 12][k] * p(a, 14 + k * 4, 30 + k * 4, E.outCubic)));
            c.num.style.opacity = sum; c.num.style.transform = `translateY(${((1 - sum) * 30).toFixed(2)}px)`;
            c.cell.style.width = lerp(262, 150, i === 5 ? p(a, 14, 40, E.ioCubic) : 0).toFixed(1) + 'px';   // the row tightens to make room for the sum
        });
        G.root.style.opacity = p(t, 0, 6); G.shade.style.opacity = p(t, 0, 10);
        G.eq.style.display = i === 5 && a >= 28 ? '' : 'none';
        G.eq.style.opacity = i === 5 ? p(a, 30, 40) : 0;
        G.eq.style.transform = `translateX(${(i === 5 ? (1 - p(a, 30, 48, E.outExpo)) * -24 : 0).toFixed(2)}px)`;
        G.eq.querySelector('b').textContent = String(Math.round(324 * (i === 5 ? p(a, 30, 52, E.outCubic) : 0)));
    }

    COMBOS.forEach(([mode, material, filter, extra], i) => {
        let G;
        FILM.define('combo' + (i + 1), {
            start: S0 + B0 + i * 60, frames: 60, preroll: 200,
            setup () { K.look(mode, extra); FILM.app.material(material); FILM.app.filter(filter, PARAM[filter][0], PARAM[filter][1]); G = buildB(); },
            after (ctx, f) { drawB(G, B0 + i * 60 + f); },
        });
    });
})();
