// SWIRL film — graphics kit. Everything is a pure function of the frame number: no CSS
// transitions, no timers. Components are built once in a shot's setup() and re-styled per frame.
(() => {
    const { E, p, lerp, clamp } = FILM;
    const K = window.K = {};
    const gfx = () => document.getElementById('gfx');

    K.el = (tag, cls, parent, html) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        (parent || gfx()).appendChild(e);
        return e;
    };
    K.svg = (tag, attrs, parent) => {
        const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    };
    K.css = (e, s) => { for (const k in s) e.style[k] = s[k]; return e; };
    K.show = (e, v) => { e.style.display = v ? '' : 'none'; };

    // ------------------------------------------------------------ the film's look-book:
    // panel settings per mode, found by look development against this soundtrack. Every key is a
    // real control in the app's settings panel.
    K.LOOKS = {
        SMOKE:   { 'AUDIO.COLOR_GAIN': 0.22, 'config.CURL': 9 },
        INK:     { 'AUDIO.COLOR_GAIN': 0.30, 'AUDIO.ENERGY_CURVE': 2.5 },
        RAINBOW: { 'AUDIO.COLOR_GAIN': 0.22, 'AUDIO.ENERGY_CURVE': 2.0 },
        AQUA:    { 'AUDIO.COLOR_GAIN': 1.60, 'AUDIO.SPLAT_FORCE': 4000, 'config.VELOCITY_DISSIPATION': 0.2, 'config.BLOOM': true, 'config.BLOOM_INTENSITY': 0.4, 'config.BLOOM_THRESHOLD': 0.5 },
        BLINK:   { 'AUDIO.COLOR_GAIN': 1.20, 'AUDIO.SPLAT_FORCE': 150, 'config.SPLAT_RADIUS': 0.12 },
        VORTEX:  { 'AUDIO.COLOR_GAIN': 0.30 },
        KALEIDO: { 'AUDIO.COLOR_GAIN': 0.35, 'AUDIO.SPLAT_FORCE': 600, 'config.SPLAT_RADIUS': 0.08, 'config.DENSITY_DISSIPATION': 4, 'config.BLOOM': true, 'config.BLOOM_INTENSITY': 0.3, 'config.BLOOM_THRESHOLD': 0.5 },
        COMET:   { 'AUDIO.COLOR_GAIN': 0.30, 'AUDIO.ENERGY_CURVE': 2.5, 'config.SPLAT_RADIUS': 0.12, 'config.DENSITY_DISSIPATION': 3, 'config.VELOCITY_DISSIPATION': 2, 'config.BLOOM': true, 'config.BLOOM_INTENSITY': 0.5, 'config.BLOOM_THRESHOLD': 0.3 },
        PULSE:   { 'AUDIO.COLOR_GAIN': 0.40, 'AUDIO.SPLAT_FORCE': 3000, 'config.DENSITY_DISSIPATION': 1, 'config.SPLAT_RADIUS': 0.1, 'config.VELOCITY_DISSIPATION': 0.3 },
    };
    // factory values of everything the look-book touches, so switching looks never leaks settings
    K.BASE = { 'AUDIO.COLOR_GAIN': 0.41, 'AUDIO.ENERGY_CURVE': 1.15, 'AUDIO.SPLAT_FORCE': 1500 };
    K.TABS = () => K.pose(1.7, 1280, 0);         // the punch-in on the three tab rows (top right)
    K.look = (mode, extra) => { FILM.app.set(K.BASE); FILM.app.preset(mode); FILM.app.set(Object.assign({}, K.LOOKS[mode] || {}, extra || {})); };

    K.MODES = [
        ['SMOKE', '烟雾', 'mono plumes'], ['INK', '墨色', 'indigo wisps'], ['RAINBOW', '彩虹', 'full spectrum'],
        ['AQUA', '水母', 'rising bubbles'], ['BLINK', '涟漪', 'raindrop rings'], ['VORTEX', '漩涡', 'whirlpool'],
        ['KALEIDO', '万花筒', '6-fold mandala'], ['COMET', '流星', 'meteor streams'], ['PULSE', '脉冲', 'beat rings'],
    ];

    // ------------------------------------------------------------ small maths
    K.hsv = (h, s, v) => {
        const i = Math.floor(h * 6), f = h * 6 - i, pp = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        const [r, g, b] = [[v, t, pp], [q, v, pp], [pp, v, t], [pp, q, v], [t, pp, v], [v, pp, q]][i % 6];
        return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    };
    K.hash = (a, b = 0) => { let x = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 1, 0xC2B2AE35); x ^= x >>> 15; x = Math.imul(x, 0x2C1B3C6D); x ^= x >>> 12; return (x >>> 0) / 4294967296; };
    // kick envelope 1 -> 0 after every beat (the track is four-on-the-floor at 120 BPM)
    K.beat = g => Math.exp(-((g % FILM.BEAT) / 60) / 0.13);
    K.mix = (a, b, x) => a + (b - a) * x;
    // envelope 1 -> 0 after each kick drum hit of the soundtrack (0 where there is no kick, e.g. the breakdown)
    K.kick = g => {
        const t = g / 60, k = FILM.kicks || []; let lo = 0, hi = k.length - 1, i = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (k[m] <= t + 1e-6) { i = m; lo = m + 1; } else hi = m - 1; }
        return i < 0 ? 0 : Math.exp(-(t - k[i]) / 0.1);
    };

    // ------------------------------------------------------------ text
    // split into per-character spans so reveals can stagger
    K.chars = (e, text) => {
        e.textContent = '';
        return [...text].map(ch => { const s = document.createElement('span'); s.textContent = ch; s.style.display = 'inline-block'; if (ch === ' ') s.style.width = '0.5em'; e.appendChild(s); return s; });
    };
    // staggered rise: progress x in 0..1 over all chars
    K.rise = (spans, x, dy = 14) => {
        const n = spans.length;
        spans.forEach((s, i) => {
            const q = E.outCubic(clamp((x * (n + 4) - i) / 5));
            s.style.opacity = q; s.style.transform = `translateY(${(1 - q) * dy}px)`;
        });
    };
    // typewriter: shows the first round(x * n) characters
    K.type = (spans, x) => { const k = Math.round(clamp(x) * spans.length); spans.forEach((s, i) => { s.style.opacity = i < k ? 1 : 0; }); };
    // decode effect: characters settle left to right, unsettled ones flicker through glyphs
    const GLYPHS = '#%*+=-:./<>[]{}01';
    K.decode = (e, text, x, frame) => {
        const n = text.length, k = Math.floor(clamp(x) * (n + 1));
        let out = '';
        for (let i = 0; i < n; i++) out += i < k || text[i] === ' ' ? text[i] : GLYPHS[Math.floor(K.hash(i, Math.floor(frame / 2)) * GLYPHS.length)];
        e.textContent = out;
    };

    // ------------------------------------------------------------ components
    // Section header: "02 / 06" + big Chinese title + English mono label + hairline + note
    K.header = (num, zh, en, note) => {
        const root = K.el('div', 'hdr');
        const idx = K.el('div', 'hdr-idx', root); idx.textContent = '';
        const row = K.el('div', 'hdr-row', root);
        const big = K.el('div', 'hdr-zh', row); const zs = K.chars(big, zh);
        const lab = K.el('div', 'hdr-en', row); lab.textContent = en;
        const rule = K.el('div', 'hdr-rule', root);
        const nt = K.el('div', 'hdr-note', root); const ns = note ? K.chars(nt, note) : [];
        return {
            root,
            // a: frames since the header started appearing, out: 0..1 exit progress
            update (a, out = 0, frame = 0) {
                const o = 1 - E.inCubic(clamp(out));
                root.style.opacity = o;
                root.style.transform = `translateY(${-10 * E.inCubic(clamp(out))}px)`;
                K.decode(idx, `${num} / 06`, p(a, 0, 14), frame);
                idx.style.opacity = p(a, 0, 6);
                K.rise(zs, p(a, 4, 30), 26);
                lab.style.opacity = p(a, 16, 30); lab.style.transform = `translateX(${(1 - p(a, 16, 34, E.outCubic)) * -10}px)`;
                rule.style.transform = `scaleX(${p(a, 10, 44, E.outExpo)})`;
                K.rise(ns, p(a, 24, 60), 10);
            },
        };
    };

    // Caption: Chinese line + English mono line, bottom-left
    K.caption = (zh, en, cls = '') => {
        const root = K.el('div', 'cap ' + cls);
        const a = K.el('div', 'cap-zh', root); const as = K.chars(a, zh);
        const b = K.el('div', 'cap-en', root); b.textContent = en || '';
        return {
            root,
            update (t, out = 0) {
                root.style.opacity = 1 - E.inCubic(clamp(out));
                K.rise(as, p(t, 0, 26), 12);
                b.style.opacity = p(t, 14, 30) * 0.9;
            },
        };
    };

    // ------------------------------------------------------------ camera on the app window
    // K.cam(s, cx, cy): app point (cx, cy) sits at the centre of the frame at scale s. While s >= 1
    // the window always covers the frame.
    K.cam = (s, cx = 640, cy = 360) => {
        let tx = 640 - cx * s, ty = 360 - cy * s;
        if (s >= 1) { tx = clamp(tx, 1280 - 1280 * s, 0); ty = clamp(ty, 720 - 720 * s, 0); }
        document.getElementById('win').style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)})`;
        K.camS = s;
    };
    // K.pose(s, cx, cy) -> [s, left, top] for K.place: app point (cx, cy) at the frame centre (clamped so the window covers the frame)
    K.pose = (s, cx = 640, cy = 360) => [s, s >= 1 ? clamp(640 - cx * s, 1280 - 1280 * s, 0) : 640 - cx * s, s >= 1 ? clamp(360 - cy * s, 720 - 720 * s, 0) : 360 - cy * s];
    K.place = (s, left, top) => { document.getElementById('win').style.transform = `translate(${left.toFixed(2)}px, ${top.toFixed(2)}px) scale(${s.toFixed(4)})`; K.camS = s; };
    // K.track([s, cx, cy], [[f0, f1, s, cx, cy, ease], ...]) -> f => [s, cx, cy]; scale is interpolated in log space
    K.track = (init, segs) => f => {
        let pose = init;
        for (const [f0, f1, s, cx, cy, ease] of segs) {
            if (f >= f1) { pose = [s, cx, cy]; continue; }
            if (f > f0) { const q = (ease || E.ioCubic)((f - f0) / (f1 - f0)); pose = [Math.exp(lerp(Math.log(pose[0]), Math.log(s), q)), lerp(pose[1], cx, q), lerp(pose[2], cy, q)]; }
            break;
        }
        return pose;
    };

    // ------------------------------------------------------------ pointer (lives in app coordinates)
    // It follows the camera, lights up :hover styles through their .film-hover twins and fires the
    // tooltip's mouseenter / mouseleave, so the real UI reacts to it.
    K.pointer = () => {
        const host = document.getElementById('inapp');
        const c = K.el('div', 'cursor', host, `<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 20 L7 15.5 L10.6 23.6 L13.8 22.2 L10.3 14.2 L17 14 Z" fill="#fdfcfc" stroke="#0f0000" stroke-width="1.6" stroke-linejoin="round"/></svg>`);
        const ring = K.el('div', 'cursor-ring', host);
        const keys = [], clicks = [];
        let hov = [], tipEl = null, tipSince = 0, tipShown = null;
        // Tooltips: the app shows one the instant a control is entered. On film a pointer in transit would
        // flash every tooltip it crosses, so one is only raised after the pointer has rested on a control
        // for DWELL frames. api.tipsFrom / api.tipsUntil limit them to a frame window, api.tips = false turns them off.
        const DWELL = 8;
        const syncTips = f => {
            const on = api.tips !== false && (api.tipsFrom == null || f >= api.tipsFrom) && (api.tipsUntil == null || f < api.tipsUntil);
            const now = hov.find(e => e.classList.contains('has-tip')) || null;
            if (now !== tipEl) { tipEl = now; tipSince = f; }
            const want = on && tipEl && f - tipSince >= DWELL ? tipEl : null;
            if (want === tipShown) return;
            if (tipShown) tipShown.dispatchEvent(new FILM.w.MouseEvent('mouseleave'));
            if (want) want.dispatchEvent(new FILM.w.MouseEvent('mouseenter'));
            tipShown = want;
        };
        const pos = k => typeof k.pos === 'function' ? k.pos() : k.pos;
        const setHover = el => {
            const chain = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) chain.push(e);
            for (const e of hov) if (!chain.includes(e)) e.classList.remove('film-hover');
            for (const e of chain) if (!hov.includes(e)) e.classList.add('film-hover');
            hov = chain;
        };
        const api = {
            el: c, x: 0, y: 0,
            // the pointer rests at `pos` ([x, y] or () => [x, y], app px) from `frame` on and travels there during the `move` frames before
            key (frame, p2, move = 30) { keys.push({ frame, pos: p2, move }); return api; },
            click (frame) { clicks.push(frame); return api; },
            hideFrom (frame) { api.hideAt = frame; return api; },
            at (f) {
                let [x, y] = pos(keys[0]);
                for (let i = 1; i < keys.length; i++) {
                    const k = keys[i]; if (f < k.frame - k.move) break;
                    const [px, py] = pos(keys[i - 1]), [kx, ky] = pos(k);
                    const q = E.ioCubic(clamp((f - (k.frame - k.move)) / k.move));
                    const dx = kx - px, dy = ky - py, bow = Math.sin(Math.PI * q) * 0.06;
                    x = px + dx * q - dy * bow; y = py + dy * q + dx * bow;
                }
                return [x, y];
            },
            update (f) {
                const first = keys.length ? keys[0].frame - keys[0].move : Infinity;
                if (f < first || (api.hideAt != null && f >= api.hideAt + 10)) { c.style.opacity = 0; ring.style.opacity = 0; setHover(null); syncTips(f); return; }
                const [x, y] = api.at(f);
                let press = 0, rp = -1;
                for (const cf of clicks) { const d = f - cf; if (d >= -3 && d < 9) press = Math.max(press, 1 - Math.abs(d - 1) / 6); if (d >= 0 && d < 24) rp = d / 24; }
                const cs = 1 / Math.pow(K.camS || 1, 0.55);          // the pointer grows a little with a punch-in, not all the way
                c.style.opacity = p(f, first, first + 8) * (api.hideAt != null ? 1 - p(f, api.hideAt, api.hideAt + 10) : 1);
                c.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(cs * (1 - 0.14 * clamp(press))).toFixed(4)}) translate(-2px, -2px)`;
                ring.style.opacity = rp < 0 ? 0 : (1 - rp) * 0.95;
                ring.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(cs * (0.3 + E.outCubic(Math.max(0, rp)) * 2.2)).toFixed(4)})`;
                api.x = x; api.y = y;
                setHover(FILM.d.elementFromPoint(x, y));
                syncTips(f);
            },
        };
        return api;
    };
    // bounding box of a tab row's buttons (the row containers themselves are wider than what they show)
    K.rowRect = sel => {
        const rs = [...FILM.d.querySelectorAll(sel + ' button')].map(b => b.getBoundingClientRect());
        const x0 = Math.min(...rs.map(r => r.left)), x1 = Math.max(...rs.map(r => r.right)), y0 = Math.min(...rs.map(r => r.top)), y1 = Math.max(...rs.map(r => r.bottom));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    // centre of an app element, optionally offset; evaluated lazily so it follows layout changes
    K.at = (sel, dx = 0, dy = 0) => () => { const r = FILM.app.rect(sel); return [r.cx + dx, r.cy + dy]; };

    // ------------------------------------------------------------ real panel controls
    const zh = k => (FILM.w.eval('STRINGS').zh[k]) || k;
    K.zh = zh;
    // the .ctrl row of the settings panel whose label is `label` (English key, as in PANEL_SCHEMA)
    K.ctrl = label => { const t = zh(label); return [...FILM.d.querySelectorAll('#panel .ctrl')].find(c => c.textContent.trim().startsWith(t)); };
    K.range = label => K.ctrl(label).querySelector('input[type=range]');
    K.setRange = (input, v) => { input.value = v; input.dispatchEvent(new FILM.w.Event('input', { bubbles: true })); };
    K.setSelect = (sel, v) => { sel.value = v; sel.dispatchEvent(new FILM.w.Event('change', { bubbles: true })); };
    // where the thumb of a range input is right now (app px)
    K.thumb = (input, tw = 12) => () => { const r = input.getBoundingClientRect(), q = (input.value - input.min) / (input.max - input.min); return [r.left + tw / 2 + (r.width - tw) * q, r.top + r.height / 2]; };
    // panel slide (the app's own 0.32 s curve; its CSS transitions are off in the film)
    K.panelSlide = (f, openAt, closeAt = Infinity) => {
        const panel = FILM.app.el('#panel');
        const q = f >= closeAt ? 1 - E.panel(clamp((f - closeAt) / 19.2)) : E.panel(clamp((f - openAt) / 19.2));
        panel.style.transform = `translateX(${(-(1 - q) * 100).toFixed(3)}%)`;
        return q;
    };

    // ------------------------------------------------------------ several renders of one simulation frame
    // A 2D canvas inside the app, right above its WebGL canvas and below its UI.
    K.fx = () => {
        if (FILM.fx && FILM.fx.ownerDocument === FILM.d) return FILM.fx;
        const gl = FILM.d.querySelector('canvas'), c = FILM.d.createElement('canvas');
        c.width = gl.width; c.height = gl.height; c.id = 'film-fx';
        c.style.cssText = 'pointer-events:none;display:none';
        gl.insertAdjacentElement('afterend', c);
        FILM.glCanvas = gl; FILM.fx = c; FILM.fxc = c.getContext('2d');
        return c;
    };
    // copy what the app just rendered into the fx canvas, optionally through a clip path (canvas px, 1920 x 1080)
    K.snap = clip => {
        const x = FILM.fxc; x.save();
        if (clip) { x.beginPath(); clip(x); x.clip(); }
        x.drawImage(FILM.glCanvas, 0, 0); x.restore();
    };
    // re-render the current simulation frame with other display settings (config keys), then restore them
    K.renderAs = over => {
        const cfg = FILM.w.eval('config'), keep = {};
        for (const k in over) { keep[k] = cfg[k]; cfg[k] = over[k]; }
        FILM.w.render(null);
        for (const k in keep) cfg[k] = keep[k];
    };

    // ------------------------------------------------------------ big type
    // Giant name block, bottom-left: index, Chinese name, mono English name, descriptor
    K.big = () => {
        const shade = K.el('div', 'big-shade');          // a soft dark corner behind the type, for busy pictures
        const root = K.el('div', 'big');
        const idx = K.el('div', 'big-idx', root), zhE = K.el('div', 'big-zh', root), en = K.el('div', 'big-en', root), desc = K.el('div', 'big-desc', root);
        let cur = null, spans = [];
        return {
            root,
            // a: frames since this name appeared; len: frames it stays (for the exit); set() swaps the text
            set (key, i, n, zhName, enName, d) { if (cur === key) return; cur = key; spans = K.chars(zhE, zhName); spans.forEach(s2 => { s2.style.willChange = 'transform'; }); this.i = i; this.n = n; this.en = enName; desc.textContent = d || ''; },
            update (a, frame, vis = 1) {
                root.style.opacity = vis; shade.style.opacity = vis * p(a, 0, 12);
                K.decode(idx, `${String(this.i).padStart(2, '0')} / ${String(this.n).padStart(2, '0')}`, p(a, 0, 10), frame);
                const n = spans.length;
                spans.forEach((s2, k) => { const q = E.outExpo(clamp((a - k * 2.2) / 16)); s2.style.transform = `translateY(${((1 - q) * 105).toFixed(2)}%)`; });
                zhE.style.transform = `scale(${(1 + 0.014 * K.kick(frame)).toFixed(5)})`;     // the name thumps with the kick
                K.decode(en, this.en, p(a, 3, 17), frame);
                en.style.opacity = p(a, 2, 8);
                desc.style.opacity = p(a, 12, 24) * 0.9; desc.style.transform = `translateX(${((1 - p(a, 12, 26, E.outCubic)) * -8).toFixed(2)}px)`;
            },
        };
    };

    // Hairline callout around an app element (app coordinates, so it follows the camera)
    K.callout = (label, side = 'left') => {
        const host = document.getElementById('inapp');
        const box = K.el('div', 'callout', host, `<i></i><i></i><i></i><i></i><span class="${side}">${label}</span>`);
        return {
            el: box,
            // q: 0..1 draw-on, r: {x, y, w, h} rect in app px (padded here)
            update (q, r, pad = 6) {
                box.style.opacity = clamp(q * 3);
                const e = E.outCubic(clamp(q));
                const w = (r.w + pad * 2), h = (r.h + pad * 2);
                box.style.left = (r.x - pad) + 'px'; box.style.top = (r.y - pad) + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
                box.style.clipPath = `inset(-40px ${((1 - e) * 100).toFixed(2)}% -40px -400px)`;
                box.querySelector('span').style.opacity = clamp(q * 2 - 0.6);
            },
        };
    };

    // Six-step progress ticks, bottom-right ("01 … 06")
    K.steps = (current) => {
        const root = K.el('div', 'steps');
        const items = [1, 2, 3, 4, 5, 6].map(n => { const e = K.el('span', n === current ? 'on' : '', root); e.textContent = String(n).padStart(2, '0'); return e; });
        return { root, update (a, out = 0) { root.style.opacity = p(a, 0, 20) * (1 - clamp(out)); } };
    };
})();
