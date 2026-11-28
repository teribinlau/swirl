// Runs the app's Rhythm analyser (public/script.js) over a soundtrack's per-frame rhythm spectra and
// compares what it hears with the drum hits the soundtrack generator actually placed.
//   node tools/rhythm_eval.js [features_beat.bin] [music_meta.json] [--bars 13-14] [--sens 1.3] [--cool 365]
// The class is lifted out of the app's source as text, so this checks the code that ships.
const fs = require('fs'), path = require('path');
const FILM = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const featFile = pos[0] || path.join(FILM, 'audio/features_beat.bin');
const metaFile = pos[1] || path.join(FILM, 'audio/music_meta.json');

const src = fs.readFileSync(path.join(FILM, '../public/script.js'), 'utf8');
const a = src.indexOf('const RHYTHM_RANGES'), b = src.indexOf('class AudioAnalyzer');
if (a < 0 || b < a) throw new Error('Rhythm class not found in public/script.js');
const Rhythm = new Function(src.slice(a, b) + '\nreturn Rhythm;')();

const feat = fs.readFileSync(featFile), frames = feat.length / 1024;
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const sens = +opt('sens', 1.3), cool = +opt('cool', 365), fps = +opt('fps', 60);
const R = new Rhythm(48000 / 2048, 1024);
const hits = { low: [], mid: [], high: [], snare: [] }, strength = { low: [], mid: [], high: [], snare: [] };
const step = 60 / fps;                                   // --fps 30 / 120 feeds every 2nd frame / each frame twice as fast
for (let i = 0, n = 0; i < frames; i += step, n++) {
    const f = Math.floor(i);
    R.update(feat.subarray(f * 1024, f * 1024 + 1024), 1e6 + n * 1000 / fps, sens, cool);
    for (const k of ['low', 'mid', 'high']) {
        if (R[k].struck) { hits[k].push(i); strength[k].push(R[k].strength); }
        else if (R[k].hit > 0) strength[k][strength[k].length - 1] = R[k].strength;       // the hit grew to its real size
    }
    if (R.snare > 0) { hits.snare.push(i); strength.snare.push(R.snare); }
}

// ---- against the ground truth: how many true hits were heard, and how late
const frameOf = t => t * 60;
function score (name, truth, heard, lo = -1, hi = 4.5) {
    let found = 0, lat = 0; const used = new Set();
    for (const t of truth) {
        const f = frameOf(t);
        const j = heard.findIndex((h, idx) => !used.has(idx) && h - f >= lo && h - f <= hi);
        if (j >= 0) { found++; lat += heard[j] + 1 - f; used.add(j); }      // frame h holds the sound up to (h + 1) / 60 s
    }
    console.log(`${name.padEnd(14)} heard ${found}/${truth.length} (${(100 * found / Math.max(1, truth.length)).toFixed(0)}%)  mean latency ${(lat / Math.max(1, found) * 1000 / 60).toFixed(0)} ms  other hits in the range: ${heard.length - used.size}`);
}
console.log(`frames ${frames}, sensitivity ${sens}, cooldown ${cool} ms, ${fps} fps`);
if (meta.kicks) score('kick -> low', meta.kicks, hits.low);
if (meta.snares) score('snare -> snare', meta.snares, hits.snare);
if (meta.claps) score('clap -> snare', meta.claps, hits.snare);
if (meta.hats) score('hat -> high', meta.hats, hits.high);
const avg = x => x.length ? (x.reduce((p, c) => p + c, 0) / x.length).toFixed(2) : '-';
console.log(`strength  low ${avg(strength.low)}  mid ${avg(strength.mid)}  high ${avg(strength.high)}  snare ${avg(strength.snare)}   totals  low ${hits.low.length}  mid ${hits.mid.length}  high ${hits.high.length}  snare ${hits.snare.length}`);

// ---- a readable timeline: one row per bar, one column per 32nd note
const bpm = meta.bpm || 120, barFrames = 4 * 60 / bpm * 60;
const [b0, b1] = opt('bars', '13-14').split('-').map(Number);
for (let bar = b0; bar <= (b1 || b0); bar++) {
    console.log(`bar ${bar}   (| = beat, columns are 32nd notes)`);
    for (const k of ['low', 'snare', 'mid', 'high']) {
        let row = '';
        for (let s = 0; s < 32; s++) {
            const f0 = (bar - 1) * barFrames + s * barFrames / 32, f1 = f0 + barFrames / 32;
            const idx = hits[k].findIndex(h => h >= f0 - 0.01 && h < f1 - 0.01);
            row += (s % 8 === 0 ? '|' : '') + (idx < 0 ? '.' : strength[k][idx] >= 1 ? '#' : strength[k][idx] >= 0.7 ? 'o' : '·');
        }
        console.log('  ' + k.padEnd(6) + row);
    }
}
