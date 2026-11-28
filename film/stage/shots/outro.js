// U08 — bars 45-48 (frames 5280-5759). End card. The aperture of the cold open closes to a band of
// smoke, the card writes itself around it, then the band becomes the waveform line again and the
// line goes flat: [●] LISTENING -> [ ] OFF.
(() => {
    const { E, p, lerp, clamp } = FILM;
    const S0 = 5280, BY = 318, BH = 136;                 // band centre and height (frame px)
    let G = {};

    FILM.define('outro', {
        start: S0, frames: 480, preroll: 200,
        setup () {
            K.look('SMOKE');
            FILM.app.ui(false);
            const root = G.root = K.el('div', 'end');
            G.title = K.el('div', 'end-title', root); G.titleS = K.chars(G.title, 'SWIRL');
            G.tag = K.el('div', 'end-tag', root); G.tagS = K.chars(G.tag, '声音，看得见。');
            G.status = K.el('div', 'end-status', root);
            G.url = K.el('div', 'end-url', root, '<span class="u"></span><span class="caret">▍</span>');
            G.steps = [['01', '打开网址'], ['02', '允许麦克风'], ['03', '放一首歌']].map(([n, t], i) => {
                const e = K.el('div', 'end-step', root, `<small>${n}</small><b>${t}</b>`); e.style.left = (96 + i * 232) + 'px'; return e;
            });
            G.arrows = [0, 1].map(i => { const e = K.el('div', 'end-arrow', root, '→'); e.style.left = (96 + i * 232 + 176) + 'px'; return e; });
            G.qr = K.el('div', 'end-qr', root, '<img src="/stage/qr.svg"><small>扫码打开</small>');
            G.rule = K.el('div', 'end-rule', root);
            G.footL = K.el('div', 'end-foot', root, '52°30′N 13°24′E &nbsp;&nbsp;&nbsp;+ 2026'); G.footL.style.left = '96px';
            G.footR = K.el('div', 'end-foot', root, 'fluid engine — Pavel Dobryakov · WebGL-Fluid-Simulation (MIT)'); G.footR.style.right = '96px';
            G.wave = K.svg('svg', { class: 'op-wave', viewBox: '0 0 1280 720' }, document.getElementById('gfx'));
            G.glow = K.svg('polyline', { fill: 'none', stroke: '#fdfcfc', 'stroke-width': 5, 'stroke-linejoin': 'round', opacity: 0.16 }, G.wave);
            G.line = K.svg('polyline', { fill: 'none', stroke: '#fdfcfc', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, G.wave);
        },

        after (ctx, f) {
            const win = document.getElementById('win');
            // the window sits 42 px high so the band shows the middle of the simulation
            K.place(1, 0, BY - 360);
            const close = p(f, 0, 46, E.outExpo);                              // full frame -> band
            const thin = p(f, 372, 432, E.ioCubic);                            // band -> line
            const h = lerp(lerp(900, BH, close), 0, thin);
            const inset = Math.max(0, 360 - h / 2);
            win.style.clipPath = `inset(${inset.toFixed(2)}px 0 ${inset.toFixed(2)}px 0)`;
            win.style.opacity = 1 - p(f, 430, 440);

            const out = p(f, 400, 436), outLate = p(f, 448, 474);
            K.rise(G.titleS, p(f, 20, 56), 34); G.title.style.opacity = 1 - outLate;
            K.type(G.tagS, p(f, 52, 96)); G.tag.style.opacity = 1 - out;
            const URL = 'swirl.ilililab.de', k = Math.round(p(f, 70, 120) * URL.length);
            G.url.querySelector('.u').textContent = URL.slice(0, k);
            G.url.querySelector('.caret').style.opacity = f < 66 ? 0 : (k < URL.length || Math.floor(f / 18) % 2 === 0 ? 1 : 0);
            G.url.style.opacity = 1 - outLate;
            G.steps.forEach((e, i) => { const q = p(f, 118 + i * 14, 142 + i * 14, E.outCubic); e.style.opacity = q * (1 - out); e.style.transform = `translateY(${((1 - q) * 12).toFixed(2)}px)`; });
            G.arrows.forEach((e, i) => { e.style.opacity = p(f, 136 + i * 14, 152 + i * 14) * 0.7 * (1 - out); });
            const qq = p(f, 100, 136, E.outCubic); G.qr.style.opacity = qq * (1 - out); G.qr.style.transform = `translateY(${((1 - qq) * 12).toFixed(2)}px)`;
            G.rule.style.transform = `scaleX(${p(f, 130, 190, E.outExpo)})`; G.rule.style.opacity = 0.5 * (1 - out);
            G.footL.style.opacity = p(f, 160, 184) * (1 - out); G.footR.style.opacity = p(f, 172, 196) * (1 - out);
            // status: listening until the sound is gone
            const off = f >= 438, blink = Math.floor(f / 18) % 2 === 0;
            G.status.innerHTML = off ? `[ ]&nbsp; OFF${blink ? '_' : '&nbsp;'}` : `<b class="dot">[●]</b>&nbsp; LISTENING`;
            G.status.style.color = off ? '' : '#fdfcfc';
            G.status.style.opacity = p(f, 40, 60) * (1 - p(f, 464, 478));
            // the waveform line returns as the band closes
            const data = FILM.timeAt(S0 + f), pts = [];
            for (let i = 0; i <= 256; i++) {
                const u = i / 256, sv = (data[Math.min(2047, i * 8)] - 128) / 128, taper = Math.pow(Math.sin(Math.PI * u), 0.7);
                pts.push((u * 1280).toFixed(1) + ',' + (BY - sv * 300 * taper * 2.2).toFixed(1));
            }
            G.line.setAttribute('points', pts.join(' ')); G.glow.setAttribute('points', pts.join(' '));
            G.wave.style.opacity = p(f, 384, 426) * (1 - p(f, 462, 478));
        },
    });
})();
