// Runs inside the app iframe before the app's own script (Playwright init script).
(() => {
    if (!location.pathname.startsWith('/app/')) return;
    let s = 12345;
    window.__seed = v => { s = v | 0; };
    Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    window.__now = 1e6;
    Date.now = () => window.__now;
    performance.now = () => window.__now;
    // Timers: real until the film takes over (window.__filmTimers = true), then driven by the fake clock
    const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
    let timers = [], tid = 1e7;
    window.__filmTimers = false;
    window.setTimeout = (fn, ms = 0, ...a) => {
        if (!window.__filmTimers) return realST(fn, ms, ...a);
        const id = ++tid; timers.push({ id, due: window.__now + (+ms || 0), fn, a }); return id;
    };
    window.clearTimeout = id => { if (id > 1e7) timers = timers.filter(t => t.id !== id); else realCT(id); };
    window.__runTimers = () => {
        const due = timers.filter(t => t.due <= window.__now).sort((x, y) => x.due - y.due);
        timers = timers.filter(t => t.due > window.__now);
        for (const t of due) { try { t.fn(...t.a); } catch (e) { console.error(e); } }
    };
    const AC = window.AudioContext;
    window.AudioContext = class extends AC { constructor (o) { super(Object.assign({}, o, { sampleRate: 48000 })); } };
})();
