// Smoke test of the app on its own (no film stage): loads ../public in WebGL 2, in WebGL 1 and as
// a phone in portrait, clicks through every mode with the browser's fake microphone playing, and
// reports page errors, shaders that failed to compile or link, and modes that draw nothing.
//   node tools/appcheck.js [--shots]      --shots keeps a screenshot per mode in out/stills/check_*.png
const { chromium, devices } = require('playwright');
const { PNG } = require('pngjs');
const fs = require('fs'), path = require('path');
const FILM = path.resolve(__dirname, '..');
const keep = process.argv.includes('--shots');
const MODES = ['SMOKE', 'INK', 'RAINBOW', 'AQUA', 'BLINK', 'VORTEX', 'KALEIDO', 'COMET', 'PULSE'];
const CONFIGS = [
    { name: 'webgl2', context: { viewport: { width: 1280, height: 720 } } },
    { name: 'webgl1', context: { viewport: { width: 1280, height: 720 } }, webgl1: true },
    { name: 'phone', context: { ...devices['Pixel 5'] } },
];
(async () => {
    const srv = await require('./serve').start();
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
    let failed = false;
    for (const cfg of CONFIGS) {
        const context = await browser.newContext({ ...cfg.context, permissions: ['microphone'] });
        if (cfg.webgl1) await context.addInitScript(() => {
            const get = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : get.call(this, type, ...rest); };
        });
        await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
        const page = await context.newPage();
        const logs = [];
        page.on('console', m => { if (['error', 'warning', 'trace'].includes(m.type()) && !/ReadPixels|Failed to load resource|GPU stall/.test(m.text())) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
        page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
        await page.goto(srv.url + '/app/index.html', { waitUntil: 'load' });
        await page.waitForTimeout(1200);
        const info = await page.evaluate(() => ({
            gl: eval('gl') instanceof (window.WebGL2RenderingContext || function () {}) ? 'WebGL 2' : 'WebGL 1',
            audio: !!(window.__audio && window.__audio.ready), rhythm: !!(window.__audio && window.__audio.rhythm),
            stamps: typeof stampsLinked === 'undefined' ? null : eval('stampsLinked'), batch: typeof STAMP_BATCH === 'undefined' ? null : eval('STAMP_BATCH'),
            canvas: [eval('canvas').width, eval('canvas').height], dye: eval('config.DYE_RESOLUTION'),
        }));
        const row = [];
        for (const mode of MODES) {
            await page.evaluate(m => applyPreset(m), mode);
            await page.waitForTimeout(1500);
            const shot = await page.screenshot();
            if (keep) { fs.mkdirSync(path.join(FILM, 'out/stills'), { recursive: true }); fs.writeFileSync(path.join(FILM, 'out/stills', `check_${cfg.name}_${mode}.png`), shot); }
            const png = PNG.sync.read(shot);
            let sum = 0; for (let i = 0; i < png.data.length; i += 4) sum += png.data[i] + png.data[i + 1] + png.data[i + 2];
            const light = sum / (png.data.length / 4 * 3 * 255);
            const rig = await page.evaluate(() => typeof RIGS !== 'undefined' && !!eval('RIGS')[eval('currentTrajectory')]);
            row.push(`${mode}${rig ? '*' : ''} ${light.toFixed(3)}`);
            if (light < 0.004) { failed = true; row[row.length - 1] += ' (DARK)'; }
        }
        if (logs.length) failed = true;
        console.log(`${cfg.name}: ${JSON.stringify(info)}`);
        console.log('   brightness per mode (* = choreographed): ' + row.join('  '));
        console.log('   ' + (logs.length ? [...new Set(logs)].join('\n   ') : 'no errors'));
        await context.close();
    }
    await browser.close(); srv.close();
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
