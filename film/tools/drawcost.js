// How much does a mode draw? Runs one mode over a stretch of the soundtrack and counts, per frame,
// the draw calls the app makes and the pixels they cover (each call is a full-buffer blit, so this is
// what the GPU has to fill and copy). For catching a mode that got expensive.
//   node tools/drawcost.js <MODE> [--start 1440] [--frames 240] [--app <dir>]
const path = require('path');
const FILM = path.resolve(__dirname, '..');
const args = process.argv.slice(2), mode = args[0];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const first = +opt('start', 1440), frames = +opt('frames', 240);
if (opt('app', null)) process.env.SWIRL_APP = path.resolve(opt('app'));          // before tools/serve.js is loaded: it reads this once
const { chromium } = require('playwright');
(async () => {
    const srv = await require('./serve').start();
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb', '--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, permissions: ['microphone'] });
    await context.addInitScript({ path: path.join(FILM, 'stage/appinit.js') });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await context.newPage();
    await page.goto(srv.url + '/stage/index.html', { waitUntil: 'load' });
    await page.evaluate(c => { window.SHOTCFG = c; }, { mode, raw: true, start: first, frames, preroll: 120 });
    await page.evaluate(() => FILM.init('look', 0));
    await page.evaluate(() => {
        const gl = FILM.w.eval('gl'), draw = gl.drawElements.bind(gl);
        window.__cost = { calls: 0, pixels: 0 };
        gl.drawElements = (...a) => { const v = gl.getParameter(gl.VIEWPORT); window.__cost.calls++; window.__cost.pixels += v[2] * v[3]; return draw(...a); };
    });
    let calls = 0, pixels = 0, worst = 0;
    for (let f = 0; f < frames; f++) {
        const c = await page.evaluate(f => { window.__cost.calls = 0; window.__cost.pixels = 0; FILM.frame(f); return window.__cost; }, f);
        calls += c.calls; pixels += c.pixels; worst = Math.max(worst, c.pixels);
    }
    await browser.close(); srv.close();
    console.log(JSON.stringify({ mode, app: process.env.SWIRL_APP || 'public', frames, drawsPerFrame: +(calls / frames).toFixed(1), megapixelsPerFrame: +(pixels / frames / 1e6).toFixed(1), worstFrameMegapixels: +(worst / 1e6).toFixed(1) }));
})().catch(e => { console.error(e); process.exit(1); });
