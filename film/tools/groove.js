// How tightly does a mode move with the music? Runs one mode over a stretch of a soundtrack, watches
// the picture the way a beat detector listens to sound, and lines the result up with the drum hits
// the soundtrack generator placed.
//   node tools/groove.js <MODE> [--start 1440] [--frames 480] [--app <dir>] [--audio audio/test/x] [--json out.json]
//   node tools/groove.js --read a.json [b.json ...]        the figures of earlier runs again
// Every frame, a 96x54 copy of the picture gives (see the `look` shot's probe in stage/shots.js)
//   light    its mean brightness
//   rise     the light that was not there on the frame before - the visual twin of spectral flux
//   snap     the same, squared: a sudden bright shape dominates it, a slow drift barely shows
//   motion   how much it changed at all
// and per run, around the kick drums:
//   snap     the most snap in the 50 ms after a kick, over the 50 ms before it
//   punch    the same for rise
//   motion   the same for motion (within 70 ms)
//   breath   how far the brightness swings over a beat, as a share of its mean
// 1 means a kick changes nothing. Snares and hats that fall clear of a kick get their own line.
// The figures say how hard the picture hits on the beat, not whether it looks good: a mode that
// scatters a burst on a black screen scores high. Read them next to tools/beatstrip.py.
const fs = require('fs'), path = require('path');
const FILM = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const mean = a => a.reduce((p, c) => p + c, 0) / Math.max(1, a.length);

function figures (run) {
    const { first, frames, series: P } = run;
    const events = t => (t || []).map(x => Math.round(x * 60) - first).filter(k => k >= 8 && k < frames - 32);
    const kicks = events(P.kicks), clear = t => events(t).filter(h => !kicks.some(k => h - k > -8 && h - k < 5));
    const at = (s, ev, d) => mean(ev.map(k => s[k + d]));
    const after = (s, n) => Math.max(...Array.from({ length: n }, (_, d) => at(s, kicks, d + (s === P.motion ? 1 : 0)))) / mean([at(s, kicks, -3), at(s, kicks, -2), at(s, kicks, -1)]);
    const light = []; for (let d = -6; d < 30; d++) light.push(at(P.light, kicks, d));
    const profile = (ev, a, b) => { const base = mean(P.rise.slice(1)) || 1e-9, o = []; for (let d = a; d < b; d++) o.push((at(P.rise, ev, d) / base).toFixed(2)); return o.join(' '); };
    const out = { mode: run.mode, app: run.app, audio: run.audio, frames, kicks: kicks.length,
                  snap: +after(P.snap, 4).toFixed(1), punch: +after(P.rise, 4).toFixed(2), motion: +after(P.motion, 4).toFixed(2),
                  breath: +((Math.max(...light) - Math.min(...light)) / (mean(P.light) || 1e-9)).toFixed(2), light: +mean(P.light).toFixed(3) };
    const lines = ['  new light around a kick, frames -6..+29 (1 = the run\'s average): ' + profile(kicks, -6, 30)];
    for (const [name, t] of [['snare', P.claps], ['hat', P.hats]]) {
        const e = clear(t);
        if (e.length) lines.push(`  new light around a ${name} clear of the kicks (${e.length} of them), frames -4..+11: ` + profile(e, -4, 12));
    }
    return { out, lines };
}
const show = run => { const f = figures(run); console.log(JSON.stringify(f.out)); f.lines.forEach(l => console.log(l)); };

if (args[0] === '--read') { for (const f of args.slice(1)) show(JSON.parse(fs.readFileSync(f, 'utf8'))); process.exit(0); }

const mode = args[0], first = +opt('start', 1440), frames = +opt('frames', 480), audio = opt('audio', null);
if (opt('app', null)) process.env.SWIRL_APP = path.resolve(opt('app'));          // before tools/serve.js is loaded: it reads this once
const { chromium } = require('playwright');
(async () => {
    const srv = await require('./serve').start();
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb', '--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 0.5, permissions: ['microphone'] });
    await context.addInitScript({ path: path.join(FILM, 'stage/appinit.js') });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(srv.url + '/stage/index.html', { waitUntil: 'load' });
    const cfg = { mode, raw: true, start: first, frames, preroll: 240, probe: true };
    if (audio) cfg.audio = audio;
    await page.evaluate(c => { window.SHOTCFG = c; }, cfg);
    await page.evaluate(() => FILM.init('look', 0));
    for (let f = 0; f < frames; f++) await page.evaluate(f => FILM.frame(f), f);
    const series = await page.evaluate(() => { const p = window.__probe; return { motion: p.motion, rise: p.rise, snap: p.snap, light: p.light, low: p.low, mid: p.mid, high: p.high, snare: p.snare, kicks: FILM.kicks, hats: FILM.meta.hats, claps: FILM.meta.claps || FILM.meta.snares }; });
    await browser.close(); srv.close();
    if (errors.length) console.error('page errors: ' + [...new Set(errors)].join(' | '));
    for (const k of ['motion', 'rise', 'snap']) series[k][0] = series[k][1];     // the first frame has nothing to be compared with
    const run = { mode, app: process.env.SWIRL_APP || 'public', audio: audio || 'audio/features', first, frames, series };
    if (opt('json', null)) fs.writeFileSync(opt('json'), JSON.stringify(run));
    show(run);
})().catch(e => { console.error(e); process.exit(1); });
