"""SWIRL film soundtrack — synthesised from scratch.

120 BPM, 48 bars (96 s), A minor.  | Fmaj7 | Gadd9 | Am7 | Em7 |
Everything is generated here: drums, bass, pad, pluck arp, FM bell lead, FX.
Output: music.wav (48 kHz stereo float32) + music_meta.json (bar/beat/kick times).
"""
import json, sys, time
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
BPM = 120.0
BEAT = 60.0 / BPM            # 0.5 s
BAR = 4 * BEAT               # 2 s
S16 = BEAT / 4               # one 16th note
BARS = 48
N = int(round(BARS * BAR * SR))
rng = np.random.default_rng(20261127)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12.0)
def bar_t(bar, step=0): return (bar - 1) * BAR + step * S16      # bar is 1-indexed, step in 16ths

# ----------------------------------------------------------------------------- arrangement
CHORDS = {                       # pad voicings (MIDI), bass root
    'F':  ([53, 60, 64, 69], 41),
    'G':  ([55, 59, 62, 69], 43),
    'Am': ([57, 60, 64, 67], 45),
    'Em': ([52, 59, 62, 67], 40),
}
def chord_of(bar):
    i = (bar - 1) % 8
    return ['F', 'G', 'Am', 'Em', 'F', 'G', 'Am', 'G'][i]

def in_(bar, *ranges): return any(a <= bar <= b for a, b in ranges)
KICK   = lambda b: in_(b, (5, 20), (25, 44))
CLAP   = lambda b: in_(b, (5, 20), (29, 44))
HATS   = lambda b: in_(b, (5, 20), (27, 44))
OHAT   = lambda b: in_(b, (7, 20), (29, 44))
SHAKER = lambda b: in_(b, (13, 20), (29, 36), (41, 44))
BASS   = lambda b: in_(b, (5, 20), (27, 44))
LEAD   = lambda b: in_(b, (13, 20), (29, 36), (41, 44))

# ----------------------------------------------------------------------------- helpers
class Mix:
    def __init__(self): self.b = np.zeros((2, N + SR * 6))
    def add(self, sig, t, gain=1.0, pan=0.0):
        """sig mono (n,) or stereo (2,n); pan -1..1 equal-power for mono."""
        i = int(round(t * SR))
        if i < 0: sig = sig[..., -i:]; i = 0
        n = sig.shape[-1]
        if i >= self.b.shape[1]: return
        n = min(n, self.b.shape[1] - i)
        if sig.ndim == 1:
            a = (pan + 1) * np.pi / 4
            self.b[0, i:i + n] += sig[:n] * gain * np.cos(a) * 1.41421356
            self.b[1, i:i + n] += sig[:n] * gain * np.sin(a) * 1.41421356
        else:
            self.b[:, i:i + n] += sig[:, :n] * gain

def sos_filt(x, kind, fc, order=2):
    sos = signal.butter(order, np.asarray(fc) / (SR / 2), btype=kind, output='sos')
    return signal.sosfilt(sos, x)

def tv_lowpass(x, fc, order=4, block=256):
    """Time-varying Butterworth low-pass, coefficients refreshed every block, state carried over."""
    out = np.empty_like(x)
    zi = None
    for s in range(0, x.shape[-1], block):
        e = min(s + block, x.shape[-1])
        f = float(np.clip(fc[(s + e) // 2 if (s + e) // 2 < len(fc) else -1], 40.0, SR * 0.45))
        sos = signal.butter(order, f / (SR / 2), output='sos')
        if zi is None: zi = np.zeros((sos.shape[0], 2) if x.ndim == 1 else (sos.shape[0], x.shape[0], 2))
        if x.ndim == 1:
            out[s:e], zi = signal.sosfilt(sos, x[s:e], zi=zi)
        else:
            out[:, s:e], zi = signal.sosfilt(sos, x[:, s:e], axis=-1, zi=zi)
    return out

def additive(f0, n, fc, amp, order=4, res=0.0, kmax=40, shape='saw', phase0=0.0):
    """Band-limited harmonic tone whose spectrum follows a time-varying low-pass (fc array, Hz)."""
    t = np.arange(n) / SR
    K = int(min(kmax, np.floor(0.45 * SR / f0)))
    y = np.zeros(n)
    fcm = np.max(fc)
    for k in range(1, K + 1):
        if shape == 'square' and k % 2 == 0: continue
        fk = k * f0
        if fk > 3.2 * fcm: break
        h = 1.0 / np.sqrt(1.0 + (fk / fc) ** (2 * order))
        if res: h = h * (1.0 + res * np.exp(-((fk - fc) / (0.3 * fc)) ** 2))
        y += (np.sin(2 * np.pi * fk * t + phase0 * k) / k) * h
    return y * amp

_wt_cache = {}
def saw_table(f0):
    """Single-cycle band-limited saw for a pitch class (table per ~semitone)."""
    key = int(round(12 * np.log2(f0 / 16.35)))
    if key not in _wt_cache:
        K = int(np.floor(0.42 * SR / (16.35 * 2 ** (key / 12))))
        ph = np.arange(2048) / 2048.0
        k = np.arange(1, K + 1)[:, None]
        _wt_cache[key] = np.sum(np.sin(2 * np.pi * k * ph[None, :]) / k, axis=0) * 0.6
    return _wt_cache[key]

def wt_osc(f0, n, phase=0.0):
    tab = saw_table(f0)
    idx = (phase + np.arange(n) * (f0 / SR)) % 1.0 * 2048
    i0 = idx.astype(np.int64); fr = idx - i0
    return tab[i0 % 2048] * (1 - fr) + tab[(i0 + 1) % 2048] * fr

def env_ar(n, a, r, hold=None):
    """attack / (hold) / release envelope in samples-space; a, r in seconds."""
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(a, 1e-4))
    rel_start = (n / SR - r) if hold is None else hold
    e *= np.clip(1.0 - (t - rel_start) / max(r, 1e-4), 0.0, 1.0)
    return e

def noise(n): return rng.standard_normal(n)

# ----------------------------------------------------------------------------- drums
def make_kick():
    n = int(0.5 * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * (46.0 * t + 150.0 * 0.034 * (1 - np.exp(-t / 0.034)) + 60.0 * 0.007 * (1 - np.exp(-t / 0.007)))
    amp = np.exp(-t / 0.19) * (1 - np.exp(-t / 0.0015)) * np.clip(1 - (t - 0.38) / 0.12, 0, 1)
    body = np.tanh(2.0 * np.sin(ph) * amp) / np.tanh(2.0)
    click = sos_filt(noise(n), 'high', 2500) * np.exp(-t / 0.0035) * 0.22
    return body + click

def make_clap():
    n = int(0.42 * SR); t = np.arange(n) / SR
    env = np.zeros(n)
    for d in (0.0, 0.011, 0.023):
        env += np.where(t >= d, np.exp(-(t - d) / 0.007), 0.0) * 0.75
    env += np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.085), 0.0)
    out = np.stack([sos_filt(noise(n), 'band', [950, 5200], 2) for _ in range(2)]) * env
    return out

def make_hat(decay, lo=7200.0):
    n = int((decay * 7 + 0.01) * SR); t = np.arange(n) / SR
    x = sos_filt(noise(n), 'high', lo, 4)
    x += 0.5 * sos_filt(noise(n), 'band', [9000, 12500], 2)
    return x * np.exp(-t / decay) * (1 - np.exp(-t / 0.0006))

def make_shaker():
    n = int(0.11 * SR); t = np.arange(n) / SR
    return sos_filt(noise(n), 'band', [4800, 9500], 2) * (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.035)

def make_crash(decay=1.1):
    n = int(decay * 5 * SR); t = np.arange(n) / SR
    out = []
    for _ in range(2):
        x = sos_filt(noise(n), 'high', 3800, 2)
        for f in (4210.0, 5377.0, 6791.0, 8120.0, 9433.0):          # a few inharmonic partials for metal
            x += 0.35 * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * noise(n).clip(-1, 1) * 0.5
        out.append(x * np.exp(-t / decay) * (1 - np.exp(-t / 0.002)))
    return np.stack(out)

def make_snare():
    n = int(0.22 * SR); t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * (185 * t + 60 * 0.02 * (1 - np.exp(-t / 0.02)))) * np.exp(-t / 0.06)
    nz = sos_filt(noise(n), 'band', [1400, 7500], 2) * np.exp(-t / 0.075)
    return 0.55 * tone + 0.9 * nz

def make_boom():
    n = int(2.6 * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * (36.0 * t + 34.0 * 0.12 * (1 - np.exp(-t / 0.12)))
    return np.tanh(1.6 * np.sin(ph) * np.exp(-t / 0.75)) * (1 - np.exp(-t / 0.004))

def make_riser(dur, f_lo=350.0, f_hi=9000.0):
    n = int(dur * SR); t = np.arange(n) / SR; u = t / dur
    fc = f_lo * (f_hi / f_lo) ** (u ** 1.3)
    out = []
    for _ in range(2):
        x = noise(n)
        y = tv_lowpass(x, fc * 1.6, order=2) - tv_lowpass(x, fc * 0.6, order=2)
        out.append(y * (u ** 2.2) * (1 - np.clip((u - 0.985) / 0.015, 0, 1)))
    return np.stack(out)

def make_downlifter(dur=1.6):
    n = int(dur * SR); t = np.arange(n) / SR; u = t / dur
    fc = 7000.0 * (300.0 / 7000.0) ** u
    out = [tv_lowpass(noise(n), fc, order=2) * (1 - u) ** 1.8 * (1 - np.exp(-t / 0.01)) for _ in range(2)]
    return np.stack(out)

# ----------------------------------------------------------------------------- pitched voices
def bass_note(m, dur, vel=1.0):
    n = int((dur + 0.05) * SR); t = np.arange(n) / SR
    fc = 170.0 + (700.0 + 500.0 * vel) * np.exp(-t / 0.085)
    amp = np.minimum(1, t / 0.004) * (0.65 + 0.35 * np.exp(-t / 0.12)) * np.clip(1 - (t - dur) / 0.04, 0, 1)
    f0 = mtof(m)
    y = additive(f0, n, fc, amp, order=4, res=0.5, kmax=18)
    y += 0.55 * np.sin(2 * np.pi * f0 * t) * amp                  # solid fundamental
    return np.tanh(1.5 * y) * vel

def pluck_note(m, vel=1.0, dur=0.55, bright=1.0):
    n = int(dur * SR); t = np.arange(n) / SR
    fc = 500.0 + (7500.0 * bright * (0.45 + 0.55 * vel)) * np.exp(-t / 0.085) + 1100.0 * bright
    amp = (1 - np.exp(-t / 0.0015)) * np.exp(-t / 0.17) * np.clip(1 - (t - (dur - 0.03)) / 0.03, 0, 1)
    y = additive(mtof(m), n, fc, amp, order=3, res=0.9, kmax=30)
    y += 0.5 * additive(mtof(m) * 1.004, n, fc, amp, order=3, res=0.9, kmax=30, shape='square')
    return y * vel

def bell_note(m, dur, vel=1.0):
    n = int((dur + 1.1) * SR); t = np.arange(n) / SR
    f0 = mtof(m)
    vib = 1.0 + 0.0025 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / 0.3, 0, 1)
    ph = 2 * np.pi * f0 * np.cumsum(vib) / SR
    body = np.sin(ph + 1.35 * np.exp(-t / 0.28) * np.sin(ph))                       # 1:1 FM, warm
    tine = np.sin(3.5 * ph + 2.2 * np.exp(-t / 0.07) * np.sin(7.0 * ph)) * np.exp(-t / 0.09) * 0.33
    air = np.sin(2 * ph) * np.exp(-t / 0.4) * 0.18
    amp = (1 - np.exp(-t / 0.003)) * np.exp(-t / 0.62) * np.clip(1 - (t - (dur + 0.9)) / 0.2, 0, 1)
    return (body + tine + air) * amp * vel

# ----------------------------------------------------------------------------- build
def build():
    t0 = time.time()
    drums, bassb, padb, arpb, leadb, fxb = Mix(), Mix(), Mix(), Mix(), Mix(), Mix()
    rev_send, dly_send = Mix(), Mix()
    kick_times = []

    kick, clap, snare = make_kick(), make_clap(), make_snare()
    chat, ohat, shaker = make_hat(0.017), make_hat(0.085, 6500.0), make_shaker()
    crash, boom = make_crash(), make_boom()

    for bar in range(1, BARS + 1):
        # ---- kick
        if KICK(bar):
            for beat in range(4):
                if bar in (12, 20, 28, 36, 40, 44) and beat == 3: continue      # air before the next section
                t = bar_t(bar, beat * 4)
                g = 0.62 if bar in (25, 26) else 0.9
                drums.add(kick, t, g); kick_times.append(t)
        # ---- clap
        if CLAP(bar):
            for beat in (1, 3):
                t = bar_t(bar, beat * 4)
                g = 0.27 if in_(bar, (9, 12), (37, 40)) else 0.40
                drums.add(clap, t, g); rev_send.add(clap, t, g * 0.35)
        # ---- hats
        if HATS(bar):
            for s in range(16):
                vel = [0.55, 0.28, 0.8, 0.3][s % 4] * (0.85 + 0.3 * rng.random())
                if OHAT(bar) and s % 4 == 2:
                    drums.add(ohat, bar_t(bar, s), 0.21 * (0.9 + 0.2 * rng.random()), pan=0.18)
                else:
                    drums.add(chat, bar_t(bar, s) + (0.004 if s % 2 else 0.0), 0.19 * vel, pan=0.22)
        if SHAKER(bar):
            for s in range(16):
                vel = [0.5, 0.75, 0.6, 1.0][s % 4]
                drums.add(shaker, bar_t(bar, s) - 0.006, 0.11 * vel, pan=-0.35)
        # ---- bass: off-beat pump with pick-ups
        if BASS(bar):
            root = CHORDS[chord_of(bar)][1]
            pat = [(2, 0, 1.0, 1.7), (6, 0, 0.9, 1.7), (7, 12, 0.55, 0.8), (10, 0, 1.0, 1.7), (13, 7, 0.6, 0.8), (14, 0, 0.9, 1.5)]
            if bar % 4 == 0: pat = pat[:5] + [(14, 12, 0.8, 0.9), (15, 7, 0.7, 0.9)]
            for s, off, vel, ln in pat:
                bassb.add(bass_note(root + off, ln * S16, vel), bar_t(bar, s), 0.34)
        # ---- sub drone in the breakdown / start of the build
        if in_(bar, (21, 26)) or in_(bar, (45, 46)):
            root = CHORDS[chord_of(bar)][1]
            n = int(BAR * SR); t = np.arange(n) / SR
            e = env_ar(n, 0.25, 0.3)
            sub = (np.sin(2 * np.pi * mtof(root) * t) + 0.25 * np.sin(2 * np.pi * mtof(root + 12) * t)) * e
            bassb.add(sub, bar_t(bar), 0.26 if bar < 45 else 0.2)

    # ---- pad: raw detuned saws for the whole song, one shared filter (paraphonic)
    raw = np.zeros((2, N + SR * 2))
    for bar in range(1, BARS + 1):
        notes = CHORDS[chord_of(bar)][0]
        if bar >= 45: notes = CHORDS['F'][0] if bar < 47 else CHORDS['Am'][0]
        n = int((BAR + 0.9) * SR)
        e = env_ar(n, 0.35 if bar < 5 or in_(bar, (21, 24)) else 0.09, 0.9, hold=BAR - 0.05)
        i = int(bar_t(bar) * SR)
        for j, m in enumerate(notes + [notes[0] - 12]):
            for d, pan in ((-7.0, -0.8), (0.0, 0.0), (7.5, 0.8)):
                f = mtof(m) * 2 ** (d / 1200.0)
                o = wt_osc(f, n, rng.random()) * e * (0.6 if j == 4 else 1.0)
                a = (pan + 1) * np.pi / 4
                raw[0, i:i + n] += o * np.cos(a); raw[1, i:i + n] += o * np.sin(a)
    tt = np.arange(raw.shape[1]) / SR
    bars_f = tt / BAR + 1
    cut = np.interp(bars_f, [1, 5, 5.01, 13, 21, 25, 29, 37, 41, 45, 49],
                    [260, 1700, 1500, 2100, 520, 2400, 2500, 1900, 2700, 1500, 380])
    cut *= 1.0 + 0.22 * np.sin(2 * np.pi * tt / (BAR * 2.0))            # slow breathing
    pad = tv_lowpass(raw, cut, order=4)
    # chorus
    def mod_delay(x, base, depth, rate, ph):
        d = (base + depth * np.sin(2 * np.pi * rate * tt + ph)) * SR
        idx = np.arange(len(x)) - d
        return np.interp(idx, np.arange(len(x)), x, left=0.0)
    pad = np.stack([0.7 * pad[0] + 0.5 * mod_delay(pad[1], 0.013, 0.004, 0.23, 0.0),
                    0.7 * pad[1] + 0.5 * mod_delay(pad[0], 0.017, 0.005, 0.31, 1.7)])
    pad_gain = np.interp(bars_f, [1, 2, 5, 9, 13, 21, 25, 29, 37, 41, 45, 47, 49], [0.0, 0.8, 1.0, 0.85, 1.0, 1.25, 1.1, 1.0, 0.9, 1.05, 1.2, 0.9, 0.0])
    pad *= pad_gain
    pad = np.stack([sos_filt(pad[0], 'high', 170), sos_filt(pad[1], 'high', 170)])
    padb.b[:, :pad.shape[1]] += pad * 0.105
    rev_send.b[:, :pad.shape[1]] += pad * 0.105 * np.interp(bars_f, [1, 5, 21, 25, 29, 45, 49], [0.7, 0.3, 0.75, 0.45, 0.3, 0.7, 0.8])

    # ---- arp (pluck): 16ths, tresillo accents, tones climb through the chord
    ACC = {0, 3, 6, 8, 11, 14}
    for bar in range(3, 47):
        notes = CHORDS[chord_of(bar)][0]
        tones = [m + 12 for m in notes] + [notes[0] + 24, notes[1] + 24]
        seq = [0, 2, 4, 1, 3, 5, 2, 4, 0, 3, 5, 1, 4, 2, 5, 3]
        if in_(bar, (21, 24)): steps = [0, 3, 6, 8, 11, 14]              # breakdown: only the accents ring
        elif bar in (3, 4, 45, 46): steps = range(0, 16, 2)
        else: steps = range(16)
        level = np.interp(bar, [3, 5, 9, 13, 21, 25, 29, 37, 41, 45, 46], [0.25, 1.0, 0.75, 1.0, 0.9, 0.8, 1.05, 0.85, 1.05, 0.6, 0.3])
        bright = np.interp(bar, [3, 5, 9, 13, 21, 25, 29, 37, 41, 45], [0.25, 0.9, 0.7, 1.0, 0.75, 0.6, 1.1, 0.85, 1.1, 0.6])
        if in_(bar, (25, 28)): bright *= np.interp(bar, [25, 28], [0.7, 1.5])
        for s in steps:
            vel = (1.0 if s in ACC else 0.55) * (0.9 + 0.2 * rng.random())
            y = pluck_note(tones[seq[s]], vel, bright=bright)
            t = bar_t(bar, s)
            pan = 0.45 * (1 if (s % 2 == 0) else -1)
            arpb.add(y, t, 0.105 * level, pan=pan)
            dly_send.add(y, t, 0.105 * level * (0.75 if in_(bar, (21, 24)) else 0.42), pan=-pan)
            rev_send.add(y, t, 0.105 * level * (0.8 if in_(bar, (21, 24)) else 0.22))

    # ---- lead bell: 4-bar motif
    MOTIF = [
        [(0, 76, 3), (3, 74, 3), (6, 72, 2), (8, 69, 6), (14, 72, 2)],
        [(0, 74, 3), (3, 72, 3), (6, 69, 2), (8, 67, 8)],
        [(0, 72, 3), (3, 76, 3), (6, 79, 2), (8, 76, 6), (14, 74, 2)],
        [(0, 71, 3), (3, 74, 3), (6, 67, 2), (8, 64, 8)],
    ]
    for bar in range(1, BARS + 1):
        if not LEAD(bar): continue
        phrase = MOTIF[(bar - 1) % 4]
        up = 12 if in_(bar, (33, 36), (41, 44)) else 0
        for s, m, ln in phrase:
            if (bar - 1) % 8 == 7 and s >= 8: m = 67 if m == 64 else m          # phrase ends on G over the G chord
            y = bell_note(m + up, ln * S16, 0.85 if up else 1.0)
            t = bar_t(bar, s)
            leadb.add(y, t, 0.125, pan=-0.1)
            dly_send.add(y, t, 0.125 * 0.5, pan=0.3)
            rev_send.add(y, t, 0.125 * 0.45)
    # sparse bells answering in the breakdown
    for bar, s, m in [(21, 4, 81), (21, 12, 76), (22, 6, 79), (23, 4, 84), (23, 12, 79), (24, 6, 76), (24, 12, 74)]:
        y = bell_note(m, 6 * S16, 0.7)
        leadb.add(y, bar_t(bar, s), 0.10, pan=0.25); rev_send.add(y, bar_t(bar, s), 0.10 * 0.9); dly_send.add(y, bar_t(bar, s), 0.06, pan=-0.3)

    # ---- FX: impacts, risers, fills
    for bar, g_boom, g_crash in [(5, 0.75, 0.30), (13, 0.5, 0.26), (21, 0.0, 0.16), (29, 0.8, 0.32), (37, 0.0, 0.16), (41, 0.55, 0.28), (45, 0.9, 0.34)]:
        t = bar_t(bar)
        if g_boom: fxb.add(boom, t, g_boom * 0.5)
        fxb.add(crash, t, g_crash); rev_send.add(crash, t, g_crash * 0.5)
        if bar in (5, 13, 29, 45): fxb.add(make_downlifter(), t + 0.02, 0.10)
    for start, dur, g in [(bar_t(4), BAR, 0.20), (bar_t(27), 2 * BAR, 0.24), (bar_t(12, 8), BEAT * 2, 0.13), (bar_t(40, 8), BEAT * 2, 0.14), (bar_t(44), BAR, 0.20), (bar_t(20, 8), BEAT * 2, 0.14)]:
        fxb.add(make_riser(dur), start, g)
    rc = make_crash(0.5)[:, ::-1]                                                   # reverse cymbal swell
    rc = rc[:, -int(1.2 * SR):] * np.linspace(0, 1, int(1.2 * SR)) ** 2
    for bar in (5, 13, 29, 41, 45):
        fxb.add(rc, bar_t(bar) - 1.2, 0.20)
    # snare roll through bar 28: 8ths -> 16ths -> 32nds, rising
    roll = [(s, 0.35 + 0.02 * s) for s in range(0, 8, 2)] + [(s, 0.5 + 0.03 * (s - 8)) for s in range(8, 12)] + [(12 + k / 2, 0.62 + 0.04 * k) for k in range(8)]
    for s, v in roll:
        drums.add(snare, bar_t(28, s), 0.30 * v); rev_send.add(snare, bar_t(28, s), 0.05 * v)
    for s, v in [(12, 0.5), (13, 0.6), (14, 0.75), (15, 0.9)]:                      # short fills
        for bar in (12, 20, 36, 44):
            drums.add(snare, bar_t(bar, s), 0.26 * v)
    # soft air bed in the intro and outro
    n_air = int(4 * BAR * SR)
    air = np.stack([sos_filt(noise(n_air), 'band', [1800, 9000], 2) for _ in range(2)])
    fxb.add(air * np.interp(np.arange(n_air) / SR, [0, 1.5, 6, 8], [0, 0.6, 1.0, 0.0]), 0.0, 0.012)
    fxb.add(air * np.interp(np.arange(n_air) / SR, [0, 1, 6, 8], [0.8, 0.6, 0.3, 0.0]), bar_t(45), 0.010)

    # ---- sidechain pump from the kick
    sc = np.ones(drums.b.shape[1])
    tau = 0.11
    for kt in kick_times:
        i = int(kt * SR); n = int(0.45 * SR)
        e = 1.0 - 0.62 * np.exp(-np.arange(n) / SR / tau)
        e[:int(0.003 * SR)] = np.linspace(1.0, e[int(0.003 * SR)], int(0.003 * SR))
        sc[i:i + n] = np.minimum(sc[i:i + n], e)
    bassb.b *= 0.55 + 0.45 * sc
    padb.b *= sc
    arpb.b *= 0.75 + 0.25 * sc
    rev_send.b *= 0.8 + 0.2 * sc

    # ---- ping-pong delay (dotted 8th)
    d = int(0.375 * SR); x = dly_send.b
    dly = np.zeros_like(x)
    g = 1.0
    for k in range(1, 7):
        g *= 0.52
        src = x if k % 2 == 1 else x[::-1]
        dly[:, k * d:] += src[:, :x.shape[1] - k * d] * g
    dly = np.stack([sos_filt(dly[0], 'high', 350), sos_filt(dly[1], 'high', 350)])
    dly = np.stack([sos_filt(dly[0], 'low', 5200), sos_filt(dly[1], 'low', 5200)])

    # ---- reverb: decaying noise IR, darker tail, 25 ms pre-delay
    n_ir = int(3.0 * SR); ti = np.arange(n_ir) / SR
    ir = []
    for _ in range(2):
        lo = sos_filt(noise(n_ir), 'low', 900) * np.exp(-ti / 0.62)
        mid = sos_filt(noise(n_ir), 'band', [900, 4500]) * np.exp(-ti / 0.48)
        hi = sos_filt(noise(n_ir), 'high', 4500) * np.exp(-ti / 0.24)
        h = (lo * 1.1 + mid + hi * 0.8) * (1 - np.exp(-ti / 0.012))
        ir.append(np.concatenate([np.zeros(int(0.025 * SR)), h]))
    ir = np.stack(ir); ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
    rin = rev_send.b + 0.35 * dly
    rev = np.stack([signal.fftconvolve(rin[c], ir[c])[:rin.shape[1]] for c in range(2)])
    rev = np.stack([sos_filt(rev[0], 'high', 220), sos_filt(rev[1], 'high', 220)])

    # ---- mix by numbers: every bus is levelled against its RMS in the fullest section (bars 13-20)
    stems = {'drums': drums.b, 'bass': bassb.b, 'pad': padb.b, 'arp': arpb.b, 'lead': leadb.b, 'delay': dly, 'reverb': rev}
    a, b = int(bar_t(13) * SR), int(bar_t(21) * SR)
    def rms_db(x): return 10 * np.log10(np.mean(x ** 2) + 1e-20)
    TARGET = {'drums': -17.0, 'bass': -20.5, 'pad': -24.0, 'arp': -22.5, 'lead': -23.5, 'delay': -31.0, 'reverb': -27.5}
    music = np.zeros((2, N))
    gains = {}
    for name, x in stems.items():
        g = 10 ** ((TARGET[name] - rms_db(x[:, a:b])) / 20)
        gains[name] = g
        stems[name] = x[:, :N] * g
        music += stems[name]
    fx = fxb.b[:, :N]
    gfx = 0.30 / np.max(np.abs(fx))                      # impacts peak around -10 dBFS
    stems['fx'] = fx * gfx; gains['fx'] = gfx
    music += stems['fx']

    # ---- master: sub-sonic filter, a little saturation, look-ahead limiter to -1 dBFS, fades
    music = np.stack([sos_filt(music[c], 'high', 27) for c in range(2)])
    music = music + 0.42 * np.stack([sos_filt(music[c], 'high', 4500, 1) for c in range(2)])      # +3 dB air shelf
    music *= 10 ** (MASTER_GAIN_DB / 20)
    music = np.tanh(1.15 * music) / 1.15
    from scipy.ndimage import maximum_filter1d, uniform_filter1d
    la = int(0.003 * SR)
    peak = maximum_filter1d(np.max(np.abs(music), axis=0), size=2 * la + 1)
    thr = 10 ** (-1.0 / 20)
    gain = np.minimum(1.0, thr / np.maximum(peak, 1e-9))
    rel = int(0.09 * SR)                                   # release: hold the minimum, then ease back
    gain = -maximum_filter1d(-gain, size=rel, origin=-(rel // 2))
    gain = uniform_filter1d(gain, size=la * 2 + 1)
    gain = np.minimum(gain, thr / np.maximum(peak, 1e-9))
    music *= gain
    tt = np.arange(N) / SR
    fade = np.clip(tt / 0.6, 0, 1) * np.clip((BARS * BAR - 0.15 - tt) / 3.6, 0, 1) ** 1.3
    music *= fade
    print('built in %.1fs; limiter: max reduction %.1f dB, active %.1f%% of the time' % (time.time() - t0, -20 * np.log10(gain.min()), 100 * np.mean(gain < 0.999)))
    return music, stems, kick_times

MASTER_GAIN_DB = 0.6

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    music, stems, kicks = build()
    wavfile.write(out + '/music.wav', SR, music.T.astype(np.float32))
    json.dump({'sr': SR, 'bpm': BPM, 'bars': BARS, 'bar': BAR, 'beat': BEAT, 'kicks': [round(k, 4) for k in kicks]}, open(out + '/music_meta.json', 'w'))
    def db(x): return 20 * np.log10(max(x, 1e-9))
    print('peak %.2f dBFS  rms %.2f dBFS' % (db(np.max(np.abs(music))), db(np.sqrt(np.mean(music ** 2)))))
    for name, s in stems.items():
        print('  %-7s peak %6.1f dB  rms %6.1f dB' % (name, db(np.max(np.abs(s))), db(np.sqrt(np.mean(s ** 2)))))
    for a, b, label in [(1, 4, 'intro'), (5, 12, 'groove A'), (13, 20, 'modes'), (21, 24, 'breakdown'), (25, 28, 'build'), (29, 36, 'peak'), (37, 40, 'panel'), (41, 44, 'finale'), (45, 48, 'outro')]:
        seg = music[:, int((a - 1) * BAR * SR):int(b * BAR * SR)]
        print('  bars %2d-%2d %-10s rms %6.1f dB  peak %6.1f dB' % (a, b, label, db(np.sqrt(np.mean(seg ** 2))), db(np.max(np.abs(seg)))))
