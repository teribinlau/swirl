// U01 — bars 1-8 (frames 0-959), one continuous simulation:
//   0-479   cold open: [ ] OFF -> [●] LISTENING, a waveform line, the line opens into smoke
//   480-719 title: cream card, the fluid shows through the letters, then we fly through the "I"
//   720-959 how it works: six bands -> six streams
(() => {
    const { E, p, lerp, clamp } = FILM;
    const BANDS = [['SUB', '60–200 Hz', 0.00, 0.18, 0.55], ['BASS', '200–500', 0.08, 0.32, 0.45], ['LOW-MID', '500–1.5k', 0.55, 0.46, 0.58],
                   ['MID', '1.5–3k', 0.66, 0.60, 0.42], ['HIGH-MID', '3–6k', 0.78, 0.74, 0.55], ['AIR', '6–12k', 0.92, 0.88, 0.45]];
    let G = {};

    FILM.define('open', {
        start: 0, frames: 960, preroll: 0,
        setup () {
            K.look('SMOKE');
            FILM.app.ui(false);

            // ---- cold open
            G.wave = K.svg('svg', { class: 'op-wave', viewBox: '0 0 1280 720' }, document.getElementById('gfx'));
            G.glow = K.svg('polyline', { fill: 'none', stroke: '#fdfcfc', 'stroke-width': 5, 'stroke-linejoin': 'round', opacity: 0.16 }, G.wave);
            G.line = K.svg('polyline', { fill: 'none', stroke: '#fdfcfc', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, G.wave);
            G.status = K.el('div', 'op-status');
            G.tag = K.el('div', 'op-tag'); G.tagS = K.chars(G.tag, '声音，看得见。');
            G.tagEn = K.el('div', 'op-tag-en'); G.tagEn.textContent = 'sound, made visible';

            // ---- title card: cream page with SWIRL knocked out
            G.tc = K.el('div', 'tc');
            G.tc.innerHTML = `<svg viewBox="0 0 1280 720">
                <defs><mask id="ko" maskUnits="userSpaceOnUse" x="0" y="0" width="1280" height="720">
                    <rect width="1280" height="720" fill="#fff"/>
                    <g id="ko-g"></g>
                </mask></defs>
                <rect width="1280" height="720" fill="#fdfcfc" mask="url(#ko)"/></svg>`;
            G.ko = G.tc.querySelector('#ko-g');
            // one <text> per letter: while flying through the "I" the other letters are far outside
            // the frame, and glyph outlines tens of thousands of px away break the rasteriser
            G.letters = [...'SWIRL'].map((ch, i) => {
                const x = 640 + (i - 2) * 190;
                const t = K.svg('text', { x, y: 452, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono', 'font-weight': 800, 'font-size': 330, fill: '#000' }, G.ko);
                t.textContent = ch;
                return { t, x };
            });
            G.tcBits = [
                K.css(K.el('div', 'tc-ink', G.tc, 'audio-reactive fluid'), { left: '64px', top: '56px' }),
                K.css(K.el('div', 'tc-ink', G.tc, 'swirl.ilililab.de'), { right: '64px', top: '56px' }),
                K.css(K.el('div', 'tc-rule', G.tc), { top: '92px' }),
                K.css(K.el('div', 'tc-rule', G.tc), { bottom: '110px' }),
                K.el('div', 'tc-zh', G.tc, '声音，看得见。'),
                K.css(K.el('div', 'tc-ink', G.tc, '52°30′N 13°24′E &nbsp;&nbsp;&nbsp;+ 2026'), { right: '64px', bottom: '66px' }),
            ];
            K.show(G.tc, false);

            // ---- how it works: live spectrum -> six bands -> six streams
            G.how = K.el('div', 'how'); K.css(G.how, { position: 'absolute', inset: '0' });
            G.spec = K.el('canvas', 'how-spec', G.how); G.spec.width = 1920; G.spec.height = 300;
            G.sx = G.spec.getContext('2d'); G.sx.scale(1.5, 1.5);
            G.leads = K.svg('svg', { class: 'op-wave', viewBox: '0 0 1280 720' }, G.how);
            G.bands = BANDS.map(([name, hz, hue], i) => {
                const col = K.hsv(hue, 0.85, 1);
                const under = K.svg('polyline', { fill: 'none', stroke: '#000', 'stroke-width': 3.5, opacity: 0.35 }, G.leads);
                const ring = K.svg('circle', { fill: 'none', stroke: col, 'stroke-width': 1.4 }, G.leads);
                const lead = K.svg('polyline', { fill: 'none', stroke: col, 'stroke-width': 1.5 }, G.leads);
                const node = K.svg('circle', { r: 2.5, fill: col }, G.leads);
                const ret = K.el('div', 'how-ret', G.how, '[+]');
                const lab = K.el('div', 'how-band', G.how, `<b>${name}</b><span class="v">0.00</span><small>${hz}</small>`);
                return { col, lead, under, ring, node, ret, lab, val: lab.querySelector('.v') };
            });
            G.howHdr = K.header('00', '原理', 'how it works', '声音被拆成 6 个频段，每个频段推动一股流体。');
            G.howHdr.root.querySelector('.hdr-idx').style.visibility = 'hidden';
            G.onset = K.el('div', 'how-onset', G.how, 'ONSET<span class="lamp">[ ]</span><small>鼓点触发一次爆发</small>');
            K.show(G.how, false); K.show(G.howHdr.root, false);
        },

        before (ctx, f) {
            if (f === 716) K.look('RAINBOW');         // colour arrives: smoke morphs into the six band hues
        },
        tick (ctx, f) { if (FILM.app.audio().onset) G.lastOnset = f; },

        after (ctx, f) {
            const win = document.getElementById('win');
            // ------------------------------------------------ cold open (0-479)
            if (f < 480) {
                const data = FILM.timeAt(f);
                const pts = [];
                const amp = 300 * p(f, 40, 130, E.outCubic);
                for (let i = 0; i <= 256; i++) {
                    const u = i / 256, s = (data[Math.min(2047, i * 8)] - 128) / 128;
                    const taper = Math.pow(Math.sin(Math.PI * u), 0.7);
                    pts.push((u * 1280).toFixed(1) + ',' + (360 - s * amp * taper * 1.8).toFixed(1));
                }
                G.line.setAttribute('points', pts.join(' ')); G.glow.setAttribute('points', pts.join(' '));
                const lineIn = p(f, 34, 70) * (1 - p(f, 400, 460));
                G.wave.style.opacity = lineIn;
                // the aperture: a slit at the waveform that opens into the whole picture
                const h = f < 236 ? 0 : f < 360 ? lerp(2, 132, p(f, 236, 360, E.ioCubic)) : lerp(132, 724, p(f, 360, 476, E.inQuart));
                win.style.clipPath = `inset(${Math.max(0, 360 - h / 2)}px 0 ${Math.max(0, 360 - h / 2)}px 0)`;
                // status line
                const on = f >= 78;
                const blink = Math.floor(f / 18) % 2 === 0;
                G.status.innerHTML = on ? `<b class="dot">[●]</b>&nbsp; LISTENING` : `[ ]&nbsp; OFF${blink ? '_' : '&nbsp;'}`;
                G.status.style.opacity = p(f, 22, 34) * (1 - p(f, 404, 440));
                G.status.style.color = on ? '#fdfcfc' : '';
                K.type(G.tagS, p(f, 150, 222));
                G.tag.style.opacity = 1 - p(f, 410, 452);
                G.tagEn.style.opacity = p(f, 226, 262) * (1 - p(f, 404, 440));
                K.show(G.tc, false);
                return;
            }
            win.style.clipPath = '';
            K.show(G.wave, false); K.show(G.status, false); K.show(G.tag, false); K.show(G.tagEn, false);

            // ------------------------------------------------ title (480-719)
            if (f < 720) {
                const g = f - 480;
                K.show(G.tc, true);
                const zoom = p(g, 122, 226, E.inCubic);
                const s = Math.exp(zoom * Math.log(70)) * (1 + 0.014 * K.beat(f) * (1 - zoom));
                G.ko.setAttribute('transform', `translate(640 334) scale(${s.toFixed(4)}) translate(-640 -334)`);
                for (const L of G.letters) { const a = 640 + (L.x - 100 - 640) * s, b = 640 + (L.x + 100 - 640) * s; L.t.style.display = b < -60 || a > 1340 ? 'none' : ''; }
                const bits = 1 - p(g, 116, 136);
                G.tcBits.forEach((e, i) => { e.style.opacity = bits * p(g, 4 + i * 3, 22 + i * 3); });
                // the stem of the "I" is 34 px wide: past 38x the whole frame is inside it, the card is gone
                if (s >= 38) K.show(G.tc, false);
                return;
            }
            K.show(G.tc, false);

            // ------------------------------------------------ how it works (720-959)
            const g = f - 720, out = p(g, 200, 228);
            // the aperture of the cold open closes again: cut to black on the bar line
            const shut = p(f, 934, 958, E.inCubic);
            win.style.clipPath = shut > 0 ? `inset(${(shut * 360).toFixed(2)}px 0 ${(shut * 360).toFixed(2)}px 0)` : '';
            K.show(G.how, true); K.show(G.howHdr.root, true);
            G.howHdr.update(g - 8, out, f);
            const a = FILM.app.audio(), t = FILM.w.__now * 0.001, wob = FILM.app.get('AUDIO.ANCHOR_WOBBLE');
            // spectrum: 136 log-spaced bars from 60 Hz to 12 kHz, coloured by the band they belong to
            const X0 = 96, X1 = 1184, BASE = 150, HMAX = 96, N = 136, LO = 60, HI = 12000, EDGES = [60, 200, 500, 1500, 3000, 6000, 12000];
            const fx = hz => X0 + (X1 - X0) * Math.log(hz / LO) / Math.log(HI / LO);
            const spec = FILM.freqAt(f), x = G.sx;
            x.clearRect(0, 0, 1280, 200);
            const vis = 1 - out;
            for (let k = 0; k < N; k++) {
                const hz = LO * Math.pow(HI / LO, (k + 0.5) / N), b = hz / 23.4375, b0 = Math.floor(b), fr = b - b0;
                const v = Math.pow((spec[b0] * (1 - fr) + spec[Math.min(1023, b0 + 1)] * fr) / 255, 1.6);
                const band = EDGES.findIndex((e, n) => hz < EDGES[n + 1]);
                const grow = p(g, 10 + k * 0.32, 30 + k * 0.32, E.outCubic);
                const h = Math.max(1.5, v * HMAX) * grow;
                x.globalAlpha = vis * (0.35 + 0.65 * grow);
                x.fillStyle = G.bands[band].col;
                x.fillRect(X0 + (X1 - X0) * k / N + 1.5, BASE - h, (X1 - X0) / N - 3, h);
            }
            x.globalAlpha = vis * p(g, 20, 50) * 0.55; x.fillStyle = '#fdfcfc';
            for (const e of EDGES) x.fillRect(Math.round(fx(e)) - 0.5, BASE - HMAX - 8, 1, HMAX + 16);
            x.globalAlpha = vis * p(g, 14, 40) * 0.5; x.fillRect(X0, BASE + 0.5, X1 - X0, 1);
            G.bands.forEach((o, i) => {
                const [, , , bx, by] = BANDS[i];
                const cx = (fx(EDGES[i]) + fx(EDGES[i + 1])) / 2, topY = 520 + BASE - HMAX - 16;
                const ax = (bx + Math.sin(t + i * 1.3) * wob) * 1280, ay = (1 - (by + Math.cos(t * 0.9 + i * 0.7) * wob)) * 720;
                const v = a.smoothedBands[i];
                const q = p(g, 26 + i * 6, 52 + i * 6, E.outCubic) * vis;
                o.lab.style.left = cx + 'px'; o.lab.style.opacity = q; o.val.textContent = v.toFixed(2);
                // leader: up from the band, an elbow, then to the stream's anchor
                const d = p(g, 44 + i * 6, 86 + i * 6, E.ioCubic), elbowY = topY - 26;
                const pts = [[cx, topY], [cx, elbowY], [ax, ay + 14]];
                const len = [0, elbowY < topY ? topY - elbowY : 0]; len.push(len[1] + Math.hypot(ax - cx, ay + 14 - elbowY));
                const upto = d * len[2], out2 = [pts[0]];
                for (let n = 1; n < 3; n++) { if (upto >= len[n]) out2.push(pts[n]); else { const u = (upto - len[n - 1]) / (len[n] - len[n - 1]); out2.push([lerp(pts[n - 1][0], pts[n][0], u), lerp(pts[n - 1][1], pts[n][1], u)]); break; } }
                o.lead.setAttribute('points', out2.map(q2 => q2[0].toFixed(1) + ',' + q2[1].toFixed(1)).join(' '));
                o.under.setAttribute('points', o.lead.getAttribute('points')); o.under.setAttribute('opacity', 0.35 * vis * clamp(d * 8));
                o.lead.setAttribute('opacity', (0.5 + 0.5 * v) * vis * clamp(d * 8));
                const tip = out2[out2.length - 1];
                o.node.setAttribute('cx', tip[0]); o.node.setAttribute('cy', tip[1]); o.node.setAttribute('opacity', vis * clamp(d * 8) * (d < 1 ? 1 : 0));
                const r = p(g, 78 + i * 6, 92 + i * 6) * vis;
                o.ret.style.transform = `translate(${ax}px, ${ay}px) scale(${1 + 0.5 * (1 - p(g, 78 + i * 6, 96 + i * 6, E.outCubic))})`; o.ret.style.opacity = r;
                o.ret.style.color = o.col;
                // a ring at the emitter breathing with the band's level
                o.ring.setAttribute('cx', ax); o.ring.setAttribute('cy', ay); o.ring.setAttribute('r', (9 + 30 * v).toFixed(2)); o.ring.setAttribute('opacity', (0.25 + 0.6 * v) * r);
            });
            // onset lamp: lights on the frame the app's own detector fires, then decays
            const lit = G.lastOnset != null ? Math.max(0, 1 - (f - G.lastOnset) / 10) : 0;
            G.onset.querySelector('.lamp').textContent = lit > 0 ? '[●]' : '[ ]';
            G.onset.querySelector('.lamp').style.color = lit > 0 ? '#30d158' : '';
            G.onset.style.opacity = p(g, 96, 120) * (1 - out);
        },
    });
})();
