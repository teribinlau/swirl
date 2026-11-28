// U02 — bars 9-12 (frames 960-1439). Step 01: open the page, give it a sound.
//   0-119    a browser window on black, the URL types itself, the camera pushes into the source chooser
//   120      click "麦克风": the cream page fades, the fluid blooms out of black
//   240      [+] 设置: the mixer — add a second source, pull its fader
//   404-479  panel closes, the camera travels to the mode tabs for the next step
(() => {
    const { E, p, lerp, clamp } = FILM;
    const CLICK = 120, PANEL = 240, ADD = 322, CLOSE = 408;
    let G = {};
    const W0 = [0.72, 322, 118];                       // the window as first seen: scale, left, top
    let cam = null;

    FILM.define('sources', {
        start: 960, frames: 480, preroll: 0,
        setup () {
            const w = FILM.w, d = FILM.d;
            K.look('RAINBOW');
            // a first visit: the chooser is up, nothing is listening yet
            w.__showSourceOverlay();
            G.micLabel = d.getElementById('mic-label'); G.micDot = d.getElementById('mic-dot');
            G.micLabel.textContent = K.zh('OFF'); G.micDot.classList.remove('active');
            G.overlay = d.getElementById('overlay');
            // the chooser's content block, to frame the push-in on it
            const r1 = FILM.app.rect('#overlay h1'), r2 = FILM.app.rect('.source-buttons');
            cam = K.track(W0, [
                [76, 116, ...K.pose(1.5, 640, (r1.y + r2.y + r2.h) / 2 + 6), E.ioCubic],
                [128, 182, ...K.pose(1, 640, 360), E.ioCubic],
                [246, 288, ...K.pose(1.5, 0, 0), E.ioCubic],
                [418, 476, ...K.TABS(), E.ioCubic],
            ]);

            // window chrome (stage level, so its type stays readable at any window scale)
            const world = document.getElementById('world');
            G.bar = K.el('div', 'winbar', world, '<i></i><i></i><i></i><div class="url"><span class="lock"></span><span class="u"></span><span class="caret">▍</span></div>');
            G.edge = K.el('div', 'winedge', world);
            G.url = G.bar.querySelector('.u'); G.caret = G.bar.querySelector('.caret');

            G.hdr = K.header('01', '音源', 'sources', '打开网页，先给它一个声音。');
            K.css(G.hdr.root, { top: '236px' }); G.hdr.root.querySelector('.hdr-note').style.maxWidth = '236px';
            G.hdr.root.querySelector('.hdr-rule').style.width = '216px';
            G.num = K.el('div', 'ghostnum', null, '01');
            // header and numeral live behind the window: it simply covers them as it comes forward
            const bg = document.getElementById('bg'); bg.appendChild(G.num); bg.appendChild(G.hdr.root);

            G.listen = K.callout('正在聆听', 'top');
            G.cap = K.caption('麦克风 · 系统声音 · 音频文件', 'stack as many sources as you like — they mix', 'right');
            G.capZh2 = K.el('div', 'cap-sub', G.cap.root, '可以同时叠加，每一路单独调音量');

            G.ptr = K.pointer()
                .key(64, [930, 690], 1)
                .key(112, () => { const r = FILM.app.rect('.src-btn[data-source="mic"]'); return [r.x + 82, r.y + r.h / 2 + 4]; }, 44).click(CLICK)
                .key(PANEL - 2, K.at('#panel-toggle', 6, 1), 46).click(PANEL)
                .key(ADD - 2, () => { const b = d.querySelectorAll('.mixer-add-btn')[2]; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2 + 1]; }, 38).click(ADD)
                .key(352, () => { const fd = d.querySelectorAll('.mixer-fader')[1]; return fd ? K.thumb(fd)() : [140, 250]; }, 22)
                .key(CLOSE - 2, K.at('#panel-close'), 16).click(CLOSE)
                .key(476, K.at('.modes button[data-mode="SMOKE"]', 0, 2), 58);
        },

        before (ctx, f) {
            const w = FILM.w, d = FILM.d;
            if (f === CLICK) {                                   // the click on "麦克风"
                G.overlay.classList.add('hidden');
                w.__audio.onSourcesChanged();                    // status + mixer show the microphone
                FILM.resetFluid(2025);
            }
            if (f === PANEL) d.getElementById('panel-toggle').click();
            if (f === ADD) {                                     // "+ 文件": a second source joins the mix
                const a = w.__audio;
                a._registerSource({ kind: 'file', node: a.ctx.createGain(), label: 'FILE: LATE-NIGHT-MIX.MP3' });
            }
            if (f > 356 && f <= 392) {                           // drag its fader down
                const fd = d.querySelectorAll('.mixer-fader')[1];
                if (fd) K.setRange(fd, lerp(1, 0.62, E.ioCubic((f - 356) / 36)).toFixed(2));
            }
            if (f === CLOSE) d.getElementById('panel-close').click();
        },

        after (ctx, f) {
            const d = FILM.d, world = document.getElementById('world'), win = document.getElementById('win');
            // ---- camera / window
            const [s, left, top] = cam(f);
            K.place(s, left, top);
            const rise = p(f, 0, 44, E.outExpo);
            world.style.transform = `translateY(${((1 - rise) * 46).toFixed(2)}px)`; world.style.opacity = p(f, 0, 16);
            const framed = s < 0.999, R = framed ? 11 : 0;
            win.style.clipPath = framed ? `inset(0 round 0 0 ${R / s}px ${R / s}px)` : '';
            K.show(G.bar, framed); K.show(G.edge, framed);
            if (framed) {
                K.css(G.bar, { left: left + 'px', top: (top - 36) + 'px', width: (1280 * s) + 'px' });
                K.css(G.edge, { left: left + 'px', top: (top - 36) + 'px', width: (1280 * s) + 'px', height: (720 * s + 36) + 'px' });
                const URL = 'swirl.ilililab.de', k = Math.round(p(f, 14, 48) * URL.length);
                G.url.textContent = URL.slice(0, k);
                G.caret.style.opacity = k < URL.length ? 1 : (Math.floor(f / 16) % 2 ? 0 : 1) * (1 - p(f, 70, 80));
            }
            // ---- overlay fade (the app's own 0.4 s ease)
            G.overlay.style.opacity = f < CLICK ? 1 : 1 - p(f, CLICK, CLICK + 24, E.ioQuad);
            // ---- panel slide
            K.panelSlide(f, PANEL, CLOSE);
            // ---- film graphics
            const hout = p(f, 112, 122);
            G.hdr.update(f - 6, hout, f);
            G.num.style.opacity = 0.9 * p(f, 4, 30) * (1 - hout);
            G.num.style.transform = `translateY(${((1 - p(f, 0, 44, E.outExpo)) * 30).toFixed(2)}px)`;
            const lq = p(f, 186, 214) * (1 - p(f, 232, 244));
            G.listen.update(lq, FILM.app.rect('.mic-status'), 7);
            const co = p(f, CLOSE - 8, CLOSE + 8);
            G.cap.update(f - (ADD + 6), co);
            G.cap.root.style.visibility = f < ADD + 6 ? 'hidden' : '';
            G.capZh2.style.opacity = p(f, ADD + 26, ADD + 44) * 0.92;
            G.ptr.update(f);
        },
    });
})();
