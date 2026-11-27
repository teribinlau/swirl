// Per-frame analysis of the soundtrack with Chrome's own AnalyserNode (same settings as the app:
// fftSize 2048, smoothingTimeConstant 0.7), rendered offline and sampled every 1/60 s.
// Output: audio/features.bin = frames x (1024 frequency bytes + 2048 time-domain bytes).
const { chromium } = require('playwright');
const { start } = require('./serve');
const fs = require('fs'), path = require('path');
const FILM = path.resolve(__dirname, '..');
const LEVEL = +(process.argv[2] || 1);          // the app's mixer fader for this source
(async () => {
    const srv = await start();
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(srv.url + '/tools/blank.html');
    const meta = await page.evaluate(async (LEVEL) => {
        const ab = await (await fetch('/audio/music.wav')).arrayBuffer();
        const probe = new OfflineAudioContext(2, 48000, 48000);
        const buf = await probe.decodeAudioData(ab);
        const FPS = 60, frames = Math.floor(buf.duration * FPS);
        const off = new OfflineAudioContext(2, buf.length, 48000);
        const src = off.createBufferSource(); src.buffer = buf;
        const gain = off.createGain(); gain.gain.value = LEVEL;
        const an = off.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.7;
        const mute = off.createGain(); mute.gain.value = 0;
        src.connect(gain); gain.connect(an); an.connect(mute); mute.connect(off.destination);
        const out = new Uint8Array(frames * 3072);
        const f = new Uint8Array(1024), t = new Uint8Array(2048);
        for (let i = 0; i < frames; i++) {
            const when = (i + 1) / FPS;
            if (when >= buf.duration) break;
            off.suspend(when).then(() => {
                an.getByteFrequencyData(f); an.getByteTimeDomainData(t);
                out.set(f, i * 3072); out.set(t, i * 3072 + 1024);
                off.resume();
            });
        }
        src.start();
        await off.startRendering();
        window.__out = out;
        return { frames, duration: buf.duration, sampleRate: buf.sampleRate, bytes: out.length };
    }, LEVEL);
    const chunks = [];
    const CH = 3072 * 600;
    for (let o = 0; o < meta.bytes; o += CH) {
        const b64 = await page.evaluate(([o, n]) => { const s = window.__out.subarray(o, o + n); let bin = ''; for (let i = 0; i < s.length; i += 32768) bin += String.fromCharCode.apply(null, s.subarray(i, i + 32768)); return btoa(bin); }, [o, CH]);
        chunks.push(Buffer.from(b64, 'base64'));
    }
    fs.writeFileSync(path.join(FILM, 'audio/features.bin'), Buffer.concat(chunks));
    fs.writeFileSync(path.join(FILM, 'audio/features.json'), JSON.stringify({ ...meta, level: LEVEL, fps: 60, perFrame: 3072 }));
    console.log(JSON.stringify(meta));
    await browser.close();
    srv.close();
})().catch(e => { console.error(e); process.exit(1); });
