// U06 — bars 37-40 (frames 4320-4799). Step 05: the settings panel — every number is a real control.
// One continuous INK simulation. The pointer hovers (real tooltips), drags two sliders, saves.
(() => {
    const { E, p, lerp, clamp } = FILM;
    const S0 = 4320;
    const OPEN = 0, CURL = [66, 146], HUE = [204, 300], SAVE = 352, CLOSE = 428;
    const cam = K.track(K.pose(1), [[4, 40, ...K.pose(1.32, 0, 0), E.ioCubic], [436, 472, ...K.pose(1), E.ioCubic]]);
    let G = {};

    FILM.define('panel', {
        start: S0, frames: 480, preroll: 200,
        setup () {
            const d = FILM.d;
            K.look('INK');
            G.panel = d.getElementById('panel');
            G.curl = K.range('Vorticity (curl)'); G.hue = K.range('Base hue');
            G.save = K.ctrl('Save as default').querySelector('button');
            const top = el => { let y = 0; for (let e = el; e && e !== G.panel; e = e.offsetParent) y += e.offsetTop; return y; };
            const max = G.panel.scrollHeight - G.panel.clientHeight;
            G.sA = clamp(top(G.curl) - 300, 0, max); G.sB = clamp(top(G.hue) - 290, 0, max); G.sC = clamp(top(G.save) - 300, 0, max);
            G.panel.scrollTop = G.sA;

            G.hdr = K.header('05', '面板', 'panel', '每个参数都能调，悬停就有说明。');
            K.css(G.hdr.root, { left: '742px', top: '168px' });
            G.caps = [
                [K.caption('涡度', 'vorticity — more curl, more swirl', 'right'), '拖一下滑块，流体立刻更卷', 58, 152],
                [K.caption('基础色相', 'base hue — the colour of the ink', 'right'), '换一种颜色，画面跟着变', 198, 306],
                [K.caption('保存为默认', 'kept in this browser — or export a file to share', 'right'), '下次打开还是这一套，也能导出文件分享', 346, 430],
            ].map(([c, sub, a, b]) => ({ c, sub: K.el('div', 'cap-sub', c.root, sub), a, b }));

            G.ptr = K.pointer()
                .key(-2, K.at('#panel-toggle', 6, 1), 1).click(OPEN)
                .key(52, K.thumb(G.curl), 34)
                .key(CURL[1] + 4, K.thumb(G.curl), 1)
                .key(HUE[0] - 6, K.thumb(G.hue), 30)
                .key(HUE[1] + 4, K.thumb(G.hue), 1)
                .key(SAVE - 4, () => { const r = G.save.getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.5 + 2]; }, 30).click(SAVE)
                .key(CLOSE - 2, K.at('#panel-close'), 26).click(CLOSE)
                .key(476, K.at('#present-toggle', 4, 1), 42);
            G.ptr.tipsFrom = 44; G.ptr.tipsUntil = 388;
        },

        before (ctx, f) {
            const d = FILM.d;
            if (f === OPEN) d.getElementById('panel-toggle').click();
            if (f > CURL[0] && f <= CURL[1]) K.setRange(G.curl, Math.round(lerp(1, 46, E.ioCubic((f - CURL[0]) / (CURL[1] - CURL[0])))));
            if (f > HUE[0] && f <= HUE[1]) K.setRange(G.hue, lerp(0.60, 0.04, E.ioQuad((f - HUE[0]) / (HUE[1] - HUE[0]))).toFixed(3));
            if (f === SAVE) G.save.click();
            if (f === CLOSE) d.getElementById('panel-close').click();
            // the panel scrolls between its sections
            if (f >= 0) G.panel.scrollTop = f < 190 ? lerp(G.sA, G.sB, p(f, 156, 188, E.ioCubic)) : f < 392 ? lerp(G.sB, G.sC, p(f, 306, 338, E.ioCubic)) : lerp(G.sC, 0, p(f, 392, 420, E.ioCubic));
        },

        after (ctx, f) {
            const [s, left, top] = cam(f);
            K.place(s, left, top);
            K.panelSlide(f, OPEN, CLOSE);
            G.hdr.update(f - 14, p(f, 150, 170), S0 + f);
            for (const { c, sub, a, b } of G.caps) {
                c.root.style.visibility = f < a || f > b + 12 ? 'hidden' : '';
                c.update(f - a, p(f, b - 2, b + 12));
                sub.style.opacity = p(f, a + 20, a + 38) * 0.92;
            }
            G.ptr.update(f);
        },
    });
})();
