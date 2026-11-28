#!/usr/bin/env python3
"""UI sound effects for the film: quiet pointer clicks and soft transition whooshes.
They go into the final mix only; the picture is driven by music.wav alone.
Writes audio/sfx.wav and audio/mix.wav (music + sfx, normalised to -14 LUFS by a fixed gain)."""
import numpy as np, os, sys, subprocess, json
from scipy import signal
from scipy.io import wavfile
F = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR, FPS = 48000, 60
N = SR * 96
rng = np.random.default_rng(7)
out = np.zeros((N, 2))

def place(x, frame, pan=0.0, gain_db=0.0):
    """x: mono array; pan -1..1 (equal power)"""
    i = int(round(frame / FPS * SR)); n = min(len(x), N - i)
    if n <= 0: return
    g = 10 ** (gain_db / 20); a = (pan + 1) * np.pi / 4
    out[i:i + n, 0] += x[:n] * g * np.cos(a); out[i:i + n, 1] += x[:n] * g * np.sin(a)

def bp(x, lo, hi):
    sos = signal.butter(2, [lo, hi], btype='band', fs=SR, output='sos'); return signal.sosfilt(sos, x)

def click():
    """a mouse click: press + release, each a tiny band-limited tick over a soft thump"""
    def tick(f0, dur, amp):
        n = int(SR * dur); t = np.arange(n) / SR
        noise = bp(rng.standard_normal(n + 200), 1800, 5200)[200:] * np.exp(-t / 0.0016)
        body = np.sin(2 * np.pi * f0 * t) * np.exp(-t / 0.007)
        return amp * (0.55 * noise / (np.abs(noise).max() + 1e-9) + 0.45 * body)
    x = np.zeros(int(SR * 0.12))
    a = tick(210, 0.03, 1.0); x[:len(a)] += a
    b = tick(260, 0.03, 0.6); j = int(SR * 0.062); x[j:j + len(b)] += b
    return x

def whoosh(dur, f0=350, f1=2600, peak=0.62):
    """filtered noise with a rising (or falling) centre frequency and a bell envelope peaking at `peak`"""
    n = int(SR * dur); t = np.arange(n) / n
    env = np.where(t < peak, np.abs(np.sin(0.5 * np.pi * t / peak)) ** 2.2, np.cos(0.5 * np.pi * (t - peak) / (1 - peak)) ** 2)
    noise = rng.standard_normal(n)
    # time-varying band-pass: mix of a few fixed bands cross-faded along the sweep
    centres = np.geomspace(min(f0, f1), max(f0, f1), 7); pos = np.log(np.exp(np.log(f0) + (np.log(f1) - np.log(f0)) * t))
    y = np.zeros(n)
    for c in centres:
        w = np.exp(-0.5 * ((pos - np.log(c)) / 0.42) ** 2)
        y += bp(noise, c / 1.5, c * 1.5) * w
    y *= env
    return y / (np.abs(y).max() + 1e-9)

CLICK = click()
def clicks(frames, pans=None, db=-25.0):
    for k, f in enumerate(frames): place(CLICK, f, 0.0 if pans is None else pans[k], db)

# ---- pointer clicks (global frames; pan follows where the control sits in the frame)
clicks([1080], [0.0]); clicks([1200], [-0.7]); clicks([1282], [-0.6]); clicks([1368], [-0.5])                  # sources
clicks([1440, 1560, 1680, 1800, 1920, 1980, 2040, 2160, 2280], [0.5] * 9)                                       # modes
clicks([2400, 2460, 2640, 2760, 2880, 3120], [0.6] * 6); clicks([2926, 3092], [-0.7, -0.6])                     # materials
clicks([3360, 3420, 3480, 3540, 3600, 3660, 3720, 3780, 3840, 3870, 3900, 3930], [0.5] * 12)                    # filters
clicks([4320, 4672, 4748], [-0.7, -0.6, -0.5]); clicks([4800], [0.7])                                           # panel, present
# slot-machine reels landing on each combination: three soft ticks
for c in [3960, 4020, 4080, 4140, 4200, 4260]:
    for k in range(3): place(CLICK[:int(SR * 0.04)], c + 5 + k * 3, -0.35 + 0.35 * k, -29.0)

# ---- whooshes
W = -30.0
place(whoosh(1.75, 300, 3200, 0.9), 602, 0.0, W + 2)                 # flying through the "I"
place(whoosh(0.42, 2400, 300, 0.25), 934, 0.0, W)                    # aperture shuts
place(whoosh(0.70, 320, 1500, 0.6), 1036, 0.0, W - 2)                # push into the window
# the wipe travels left to right
wipe = whoosh(0.90, 500, 2600, 0.55); i0 = int(round(2460 / FPS * SR)); n = len(wipe); pan = np.linspace(-0.8, 0.8, n); a = (pan + 1) * np.pi / 4
out[i0:i0 + n, 0] += wipe * 10 ** (W / 20) * np.cos(a); out[i0:i0 + n, 1] += wipe * 10 ** (W / 20) * np.sin(a)
place(whoosh(0.85, 300, 2200, 0.5), 2760, 0.0, W)                    # iris
place(whoosh(0.75, 500, 2600, 0.5), 3120, 0.3, W)                    # triptych panels sweep in
place(whoosh(0.40, 2400, 300, 0.25), 3334, 0.0, W + 1)               # aperture shuts before the drop
place(whoosh(0.80, 2600, 320, 0.2), 5280, 0.0, W + 1)                # end card: frame closes to the band
place(whoosh(1.00, 1800, 260, 0.3), 5652, 0.0, W - 3)                # band becomes the line

peak = np.abs(out).max()
print('sfx peak dBFS', round(20 * np.log10(peak + 1e-12), 1))
wavfile.write(os.path.join(F, 'audio/sfx.wav'), SR, out.astype(np.float32))

sr, music = wavfile.read(os.path.join(F, 'audio/music.wav')); assert sr == SR
music = music.astype(np.float64)[:N]
GAIN_DB = float(os.environ.get('MIX_GAIN_DB', '-1.6'))
mix = (music + out[:len(music)]) * 10 ** (GAIN_DB / 20)
print('mix peak dBFS', round(20 * np.log10(np.abs(mix).max()), 2))
wavfile.write(os.path.join(F, 'audio/mix.wav'), SR, mix.astype(np.float32))
r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', os.path.join(F, 'audio/mix.wav'), '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True)
tail = r.stderr[r.stderr.rfind('Summary:'):]
print(tail)
