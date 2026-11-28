// Renders one shot frame by frame.
//   node render.js <shot> --video out.mkv [--from A] [--to B]   lossless intermediate (x264 RGB, CRF 0)
//   node render.js <shot> --stills 0,30,60 [--dir d] [--tag t]  PNG stills only (still steps every frame)
//   --cfg '{json}' is handed to the shot as window.SHOTCFG (used by the look-development shots)
const { chromium } = require('playwright');
const { start } = require('./serve');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const FILM = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const shot = args[0];
const opt = k => { const i = args.indexOf('--' + k); return i < 0 ? null : args[i + 1]; };
const stills = opt('stills') ? opt('stills').split(',').map(Number) : null;
const video = opt('video');
const dir = opt('dir') || path.join(FILM, 'out/stills');
const maxFrame = opt('to') != null ? +opt('to') : null;
const from = opt('from') != null ? +opt('from') : 0;
const SCALE = +(process.env.SWIRL_SCALE || 1.5), OW = Math.round(1280 * SCALE), OH = Math.round(720 * SCALE);   // 1.5 -> 1920x1080
const t0 = Date.now();
(async () => {
    const srv = await start();
    if (stills) fs.mkdirSync(dir, { recursive: true });
    if (video) fs.mkdirSync(path.dirname(path.resolve(video)), { recursive: true });
    const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--force-color-profile=srgb', '--hide-scrollbars'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: SCALE, permissions: ['microphone'] });
    await context.addInitScript({ path: path.join(FILM, 'stage/appinit.js') });
    await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const page = await context.newPage();
    const logs = [];
    page.on('console', m => { if (!/ReadPixels|Failed to load resource/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    // The capture session must own the device-metrics override: a screenshot taken through a session
    // that has none resets the page to devicePixelRatio 1, and the app would then resize its WebGL
    // canvas to 1280x720 from the next frame on.
    const client = await context.newCDPSession(page);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: SCALE, mobile: false });
    await page.goto(srv.url + '/stage/index.html', { waitUntil: 'load' });
    await page.mouse.move(640, 2);                 // park the real mouse where the app has nothing to hover
    if (opt('cfg')) await page.evaluate(c => { window.SHOTCFG = c; }, JSON.parse(opt('cfg')));
    const info = await page.evaluate(([n, a]) => FILM.init(n, a), [shot, from]);
    const total = maxFrame != null ? Math.min(info.frames, maxFrame + 1) : (stills ? Math.min(info.frames, Math.max(...stills) + 1) : info.frames);
    let ff = null;
    if (video) {
        ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'png', '-i', '-', '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-crf', '0', '-r', '60', video], { stdio: ['pipe', 'inherit', 'inherit'] });
    }
    const tInit = Date.now();
    for (let f = from; f < total; f++) {
        await page.evaluate(f => FILM.frame(f), f);
        if (ff || (stills && stills.includes(f))) {
            const { data } = await client.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
            const buf = Buffer.from(data, 'base64');
            if (buf.readUInt32BE(16) !== OW || buf.readUInt32BE(20) !== OH) throw new Error(`frame ${f}: captured ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}, expected ${OW}x${OH}`);
            if (ff && !ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
            if (stills && stills.includes(f)) fs.writeFileSync(path.join(dir, `${opt('tag') || shot}_${String(f).padStart(4, '0')}.png`), buf);
        }
        if (f % 60 === 59) process.stderr.write(`  ${shot} ${f + 1}/${total}  ${((Date.now() - tInit) / (f - from + 1)).toFixed(0)} ms/frame\n`);
    }
    if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); }
    const chk = await page.evaluate(() => { const c = FILM.d && FILM.d.querySelector('canvas'); return c ? [c.width, c.height, FILM.w.devicePixelRatio] : null; });
    const size = opt('cfg') && JSON.parse(opt('cfg')).size;           // a look-development shot may give the app another window shape
    const CW = size ? Math.round(size[0] * SCALE) : OW, CH = size ? Math.round(size[1] * SCALE) : OH;
    if (chk && (Math.abs(chk[0] - CW) > 1 || Math.abs(chk[1] - CH) > 1 || chk[2] !== SCALE)) throw new Error('app canvas ended at ' + chk.join(' x '));
    console.log(JSON.stringify({ shot, from, frames: total - from, initSec: +((tInit - t0) / 1000).toFixed(1), renderSec: +((Date.now() - tInit) / 1000).toFixed(1), msPerFrame: +((Date.now() - tInit) / Math.max(1, total - from)).toFixed(0) }));
    if (logs.length) console.log('page logs:\n' + [...new Set(logs)].join('\n'));
    await browser.close();
    srv.close();
})().catch(e => { console.error(e); process.exit(1); });
